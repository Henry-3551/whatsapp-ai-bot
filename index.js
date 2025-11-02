// file: server.js
import express from "express";
import session from "express-session";
import Redis from "ioredis";
import { RedisStore } from "connect-redis";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

// --- Redis client ---
const redisClient = new Redis(process.env.REDIS_URL);

// --- Express app setup ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Sessions using connect-redis v8 syntax ---
app.use(
  session({
    store: new RedisStore({ client: redisClient, prefix: "sess:" }),
    secret: process.env.SESSION_SECRET || "henrify_secret_key_2025",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 20 },
  })
);

console.log("✅ Redis session store connected successfully");

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/* ---------- MENU ---------- */
const MENU = {
  "Main Courses (Lunch & Dinner)": [
    { name: "Jollof Rice & Chicken", description: "Classic Nigerian jollof with fried or grilled chicken", price: "₦2,500" },
    { name: "Ofada Rice & Ayamase Sauce", description: "Local rice with spicy green ofada stew and assorted meat", price: "₦3,000" },
    { name: "Egusi Soup & Pounded Yam", description: "Melon seed soup with beef, fish, and vegetable", price: "₦2,800" },
    { name: "Efo Riro & Amala/Fufu", description: "Rich spinach stew with assorted meat", price: "₦2,500" },
  ],
};

/* ---------- HELPERS ---------- */
function detectOrder(message) {
  if (!message || typeof message !== "string") return null;
  const msg = message.toLowerCase();
  const orderMatch = msg.match(/(\d+)?\s*(.*)/);
  if (!orderMatch) return null;

  const quantity = parseInt(orderMatch[1]) || 1;
  const mealName = orderMatch[2]?.trim();

  for (const category of Object.values(MENU)) {
    for (const item of category) {
      if (mealName.includes(item.name.toLowerCase().split(" ")[0])) {
        const numericPrice = parseInt(item.price.replace(/[^\d]/g, ""));
        return {
          name: item.name,
          quantity,
          unitPrice: numericPrice,
          totalPrice: numericPrice * quantity,
        };
      }
    }
  }
  return null;
}

async function sendMessage(to, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, text: { body: text } },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );
    console.log(`✅ Message sent to ${to}`);
  } catch (err) {
    console.error("❌ Error sending message:", err.response?.data || err.message);
  }
}

async function sendButtonMessage(to, text, buttons) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: buttons.map((b, i) => ({
              type: "reply",
              reply: { id: `btn_${i + 1}`, title: b },
            })),
          },
        },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`✅ Button message sent to ${to}`);
  } catch (err) {
    console.error("❌ Error sending button message:", err.response?.data || err.message);
  }
}

async function sendImageMessage(to, imageUrl, caption = "") {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "image",
        image: { link: imageUrl, caption },
      },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log(`✅ Image sent to ${to}`);
  } catch (err) {
    console.error("❌ Error sending image:", err.response?.data || err.message);
  }
}

/* ---------- WEBHOOK ---------- */
app.post("/webhook", async (req, res) => {
  const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = message?.from;
  const msgBody = message?.text?.body || message?.interactive?.button_reply?.title || "";

  if (!message || !from || !msgBody) return res.sendStatus(200);
  console.log(`📩 [${from}] ${msgBody}`);

  // Initialize session memory
  if (!req.session.memory) req.session.memory = {};
  if (!req.session.memory[from]) {
    req.session.memory[from] = { seen: false, chat: [] };
  }

  const userData = req.session.memory[from];

  // 👋 First-time user intro
  if (!userData.seen) {
    userData.seen = true;

    // 1️⃣ Send brand welcome image(s)
    await sendImageMessage(from, "https://i.imgur.com/8Y6tVhT.jpeg", "🍽️ *Welcome to FreshBites Kitchen!*");
    await sendImageMessage(from, "https://i.imgur.com/2TcH7d6_d.png", "🔥 Taste the freshness. Feel the flavor.");

    // 2️⃣ Send warm intro text
    await sendMessage(
      from,
      `👋 Hi there! Welcome to *FreshBites Kitchen* — your go-to spot for delicious, freshly cooked Nigerian meals. 🇳🇬\n\nFrom Jollof to Egusi, our dishes are made with love and delivered hot to your doorstep 🍛❤️`
    );

    // 3️⃣ Send main menu buttons
    await sendButtonMessage(from, "What would you like to do today?", [
      "📋 View Menu",
      "🚚 Delivery Info",
      "💰 Pricing",
    ]);

    return res.sendStatus(200);
  }

  // Menu request
  if (msgBody.toLowerCase().includes("menu")) {
    await sendImageMessage(
      from,
      "https://i.imgur.com/2TcH7d6_d.png",
      "📋 *FreshBites Menu* — Here’s what’s cooking today!"
    );

    const formattedMenu = Object.entries(MENU)
      .map(([cat, items]) =>
        `🍽️ *${cat}*\n${items
          .map((i) => `• ${i.name} – ${i.price}\n  _${i.description}_`)
          .join("\n")}`
      )
      .join("\n\n");

    await sendMessage(from, formattedMenu);
    return res.sendStatus(200);
  }

  // Detect order
  const order = detectOrder(msgBody);
  if (order) {
    await sendMessage(
      from,
      `🧾 *Order Summary:*\n${order.quantity} × ${order.name}\n💵 Unit: ₦${order.unitPrice.toLocaleString()}\n💰 Total: ₦${order.totalPrice.toLocaleString()}\nWould you like *pickup* or *delivery*?`
    );
    return res.sendStatus(200);
  }

  // AI fallback
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are *FreshBites Kitchen Assistant*, the official WhatsApp bot for FreshBites Restaurants in Nigeria.
You are friendly, lively, and helpful. Guide users about menu, delivery, or pricing with accurate info.
If off-topic, politely bring focus back to FreshBites Kitchen services.`,
      },
      ...userData.chat,
      { role: "user", content: msgBody },
    ],
  });

  const reply = completion.choices[0].message.content.trim();
  userData.chat.push({ role: "user", content: msgBody });
  userData.chat.push({ role: "assistant", content: reply });
  await sendMessage(from, reply);
  res.sendStatus(200);
});

/* ---------- VERIFY ---------- */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/* ---------- START SERVER ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ WhatsApp + AI bot running on port ${PORT}`));
