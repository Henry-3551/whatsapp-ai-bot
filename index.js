// file: server.js
import express from "express";
import session from "express-session";
import Redis from "ioredis";
import { RedisStore } from "connect-redis"; // <-- ✅ use named import
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";

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
    store: new RedisStore({
      client: redisClient,
      prefix: "sess:", // optional
    }),
    secret: process.env.SESSION_SECRET || "henrify_secret_key_2025",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 }, // 1 hour/ 60 minutes
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
  "🍽 BREAKFAST": [
    { name: "Yam & Egg Sauce", description: "Boiled or fried yam served with spicy tomato & egg sauce", price: "₦1,800" },
    { name: "Plantain & Beans (Ewa Agoyin)", description: "Sweet fried plantain with spicy mashed beans", price: "₦1,500" },
    { name: "Akara & Pap", description: "Fried bean cakes served with custard or pap (ogi)", price: "₦1,200" },
    { name: "Moi Moi & Bread", description: "Steamed bean pudding served with soft bread", price: "₦1,300" },
    { name: "Noodles & Fried Egg", description: "Indomie-style noodles with vegetables & fried egg", price: "₦1,500" },
  ],
  "🍢 SNACKS & LIGHT MEALS": [
    { name: "Meat Pie", description: "Flaky pastry stuffed with minced meat & vegetables", price: "₦800" },
    { name: "Sausage Roll", description: "Pastry roll filled with sausage meat", price: "₦700" },
    { name: "Puff-Puff (5 pcs)", description: "Sweet fried dough balls", price: "₦600" },
    { name: "Chin Chin (Small Pack)", description: "Crunchy fried dough snack", price: "₦500" },
    { name: "Suya (Beef / Chicken)", description: "Spicy skewered meat served with onions and peppers", price: "₦1,000-₦2,000" },
  ],
  "🥤 DRINKS & BEVERAGES": [
    { name: "Soft Drinks", Size: "50cl", price: "₦500" },
    { name: "Bottled Water", Size: "75cl", price: "₦300" },
    { name: "Zobo Drink", Size: "cup", price: "₦600" },
    { name: "Chapman", Size: "Glass", price: "₦1,200" },
    { name: "Palm Wine", Size: "Calabash", price: "₦1,000" },
    { name: "Smoothie", Size: "Glass", price: "₦1,800" },
    { name: "Beer / Malt / Energy Drink", Size: "Bottle", price: "₦1,200–₦1,800" },
  ],
  "🍛 MAIN COURSES (LUNCH & DINNER)": [
    { name: "Jollof Rice & Chicken", description: "Classic Nigerian jollof with fried or grilled chicken", price: "₦2,500" },
    { name: "Fried Rice & Dodo", description: "Fried rice with plantain and peppered chicken or beef", price: "₦2,700" },
    { name: "Ofada Rice & Ayamase Sauce", description: "Local rice with spicy green ofada stew and assorted meat", price: "₦3,000" },
    { name: "Egusi Soup & Pounded Yam", description: "Melon seed soup with beef, fish, and vegetable", price: "₦2,800" },
    { name: "Efo Riro & Amala/Fufu", description: "Rich spinach stew with assorted meat", price: "₦2,500" },
    { name: "Bitterleaf Soup & Fufu", description: "Traditional onugbu soup with meat and stockfish", price: "₦2,700" },
    { name: "Oha Soup & Semovita", description: "Eastern Nigerian delicacy with oha leaves and proteins", price: "₦2,800" },
    { name: "Okra Soup & Eba", description: "Fresh okra soup with fish or beef", price: "₦2,500" },
    { name: "Pepper Soup (Goat / Catfish)", description: "Spicy broth with your choice of meat or fish", price: "₦2,500 / ₦3,000" },
    { name: "Native Jollof (Palm Oil Rice)", description: "Local-style rice with smoked fish, crayfish, and traditional seasonings", price: "₦2,600" },
  ],
  "🍰 DESSERTS": [
    { name: "Fruit Salad", description: "Mixed tropical fruits", price: "₦1,200" },
    { name: "Parfait", description: "Yogurt layered with granola and fruits", price: "₦2,000" },
    { name: "Ice Cream (Vanilla / Chocolate)", description: "Scoop or cup", price: "₦1,500" },
  ],
  "💡 Special Combos": [
    { name: "FreshBites Special", Includes: "Jollof Rice + Chicken + Dodo + Drink", price: "₦3,000" },
    { name: "Naija Combo", Includes: "Pounded Yam + Egusi + Goat Meat + Water", price: "₦3,200" },
    { name: "Quick Lunch Pack", Includes: "Fried Rice + Plantain + Beef", price: "₦2,500" },
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
  if (!to || !text) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: text },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        },
      }
    );
    console.log(`✅ Message sent to ${to}`);
  } catch (err) {
    console.error("❌ Error sending message:", err.response?.data || err.message);
  }
}

async function sendButtonMessage(recipient, text, buttons) {
  if (!recipient || !buttons?.length) return;
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: recipient,
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
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Button message sent to ${recipient}`);
  } catch (err) {
    console.error("❌ Error sending button message:", err.response?.data || err.message);
  }
}

/* ---------- SEND IMAGE MESSAGE ---------- */
async function sendImageMessage(to, imageUrlOrId, caption = "") {
  if (!to) return;
  try {
    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: imageUrlOrId.startsWith("http")
        ? { link: imageUrlOrId, caption }
        : { id: imageUrlOrId, caption },
    };

    await axios.post(
      `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log(`✅ Image menu sent to ${to}`);
  } catch (err) {
    console.error("❌ Error sending image menu:", err.response?.data || err.message);
  }
}

/* ---------- USER MEMORY HELPERS ---------- */
async function getUserMemory(userId) {
  const data = await redisClient.get(`user:${userId}`);
  return data ? JSON.parse(data) : { greeted: false, chat: [], intent: null, lastGreetedAt: null };
}

async function saveUserMemory(userId, memory) {
  await redisClient.set(`user:${userId}`, JSON.stringify(memory), "EX", 60 * 60 * 24 * 7); // keep for 7 days
}


// 👇 add at the top of index.js (above app.post("/webhook", ...))
const greetedUsers = new Map(); // Store users who have been greeted

/* ---------- WEBHOOK ---------- */
app.post("/webhook", async (req, res) => {
  const data = req.body;
  const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = message?.from;
  const msgBody =
    message?.text?.body ||
    message?.interactive?.button_reply?.title ||
    "";

  if (!message || !from || !msgBody) {
    console.log("⚠️ No text message or sender found, skipping event.");
    return res.sendStatus(200);
  }

  console.log(`📩 [${from}] ${msgBody}`);

  /* ===== Load memory from Redis ===== */
  let memory = await getUserMemory(from);
  const now = Date.now();
  const shouldGreetAgain =
    !memory.lastGreetedAt || now - memory.lastGreetedAt > 24 * 60 * 60 * 1000;

  /* ===== FIRST-TIME GREETING ===== */
  if (!memory.greeted || shouldGreetAgain) {
    memory.greeted = true;
    memory.lastGreetedAt = now;
    memory.chat = [];
    memory.intent = "intro";

    // send brand images
    await sendImageMessage(
      from,
      "https://i.imgur.com/6qCXNkR_d.jpeg",
      "🍽️ *Welcome to FreshBites Kitchen!* — Where every meal tells a delicious story."
    );

    await sendImageMessage(
      from,
      "https://i.imgur.com/XHLXHLR_d.jpeg",
      "✨ *Experience the taste, aroma, and warmth of our kitchen* — freshly made for you ❤️"
    );

    // intro buttons
    await sendButtonMessage(
      from,
      "👋 Hi there! Welcome to *FreshBites Kitchen*.\nI’m your friendly assistant — what would you like to do today?",
      ["📋 View Menu", "🚚 Delivery Info", "💰 Pricing"]
    );

    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

  /* ===== MENU REQUEST ===== */
  if (msgBody.toLowerCase().includes("menu")) {
    memory.intent = "menu";

    await sendImageMessage(
      from,
      "https://i.imgur.com/2TcH7d6_d.png",
      "📋 *FreshBites Kitchen Menu* — Here’s what’s cooking today!"
    );

    const formattedMenu = Object.entries(MENU)
      .map(([cat, items]) =>
        `🍽️ *${cat.toUpperCase()}*\n${items
          .map((i) => `• ${i.name} – ${i.price}\n  _${i.description}_`)
          .join("\n")}`
      )
      .join("\n\n");

    await sendMessage(from, formattedMenu);
    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

  /* ===== ORDER DETECTION ===== */
  const order = detectOrder(msgBody);
  if (order) {
    memory.intent = "order";
    await sendMessage(
      from,
      `🧾 *Order Summary:*\n${order.quantity} × ${order.name}\n💵 Unit: ₦${order.unitPrice.toLocaleString()}\n💰 Total: ₦${order.totalPrice.toLocaleString()}\nWould you like *pickup* or *delivery*?`
    );
    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

  /* ===== GREETINGS ===== */
  if (
    ["hi", "hello", "hey", "good morning", "good afternoon", "good evening"].includes(
      msgBody.toLowerCase()
    )
  ) {
    await sendButtonMessage(
      from,
      "👋 Welcome back to *FreshBites Kitchen!* How can we help you today?",
      ["📋 View Menu", "🚚 Delivery Info", "💰 Pricing"]
    );
    return res.sendStatus(200);
  }

  /* ===== AI CHAT LOGIC (CONTEXT AWARE) ===== */
  const systemPrompt = `
You are *FreshBites Kitchen's WhatsApp Assistant*, a warm, conversational Nigerian restaurant bot.
You already know the customer's current intent is "${memory.intent || "general"}".
If the user says "sure", "yes", or similar, respond based on that intent.
If intent = "menu", show menu again or recommend best dishes.
If intent = "order", guide them to confirm pickup or delivery.
If intent = "intro", guide them to menu or delivery info.
If unclear, politely clarify.
Always be friendly and concise.`;

  memory.chat.push({ role: "user", content: msgBody });
  const conversation = [
    { role: "system", content: systemPrompt },
    ...memory.chat.slice(-6), // keep last few messages only
  ];

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: conversation,
  });

  const reply = completion.choices[0].message.content.trim();
  memory.chat.push({ role: "assistant", content: reply });

  await sendMessage(from, reply);
  await saveUserMemory(from, memory);
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
