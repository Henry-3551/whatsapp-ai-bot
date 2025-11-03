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
  "Main Courses (Lunch & Dinner)": [
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

// 👇 add at the top of index.js (above app.post("/webhook", ...))
const greetedUsers = new Map(); // Store users who have been greeted

/* ---------- WEBHOOK ---------- */
app.post("/webhook", async (req, res) => {
  const data = req.body;
  const message = data.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  const from = message?.from;
  const type = message?.type;
  let msgBody =
    message?.text?.body ||
    message?.interactive?.button_reply?.title ||
    "";

  if (!message || !from || !msgBody) {
    console.log("⚠️ No text message or sender found, skipping event.");
    return res.sendStatus(200);
  }

  console.log(`📩 [${from}] ${msgBody}`);

  // ✅ Initialize session memory
  if (!req.session.memory) req.session.memory = {};
  if (!req.session.memory[from]) {
    req.session.memory[from] = {
      chat: [],
      intent: null,
      greeted: false,
      lastGreetedAt: null,
    };
  }

  const memory = req.session.memory[from];
  const now = Date.now();

  // ✅ Check if last greeting was over 24 hours ago
  const shouldGreetAgain =
    !memory.lastGreetedAt || now - memory.lastGreetedAt > 24 * 60 * 60 * 1000;

  // ✅ FIRST-TIME USER OR 24-HR RESET
  if (!memory.greeted || shouldGreetAgain) {
    memory.greeted = true;
    memory.lastGreetedAt = now;

    console.log(`👋 Sending welcome intro to new/returning user: ${from}`);

    // 1️⃣ Send brand logo
    await sendImageMessage(
      from,
      "https://i.imgur.com/6qCXNkR_d.jpeg?maxwidth=520&shape=thumb&fidelity=high",
      "🍽️ *Welcome to FreshBites Kitchen!* — Where every meal tells a delicious story."
    );

    // 2️⃣ Send restaurant image
    await sendImageMessage(
      from,
      "https://i.imgur.com/XHLXHLR_d.jpeg?maxwidth=520&shape=thumb&fidelity=high",
      "✨ *Experience the taste, aroma, and warmth of our kitchen* — freshly made for you ❤️"
    );

    // 3️⃣ Send main button message
    await sendButtonMessage(
      from,
      "👋 Hi there! It’s great to have you here at *FreshBites Kitchen*.\n\nI’m your friendly assistant. What would you like to do today?",
      ["📋 View Menu", "🚚 Delivery Info", "💰 Pricing"]
    );

    return res.sendStatus(200);
  }

  // ✅ Handle greetings
  if (
    ["hi", "hello", "hey", "greetings", "good morning", "good afternoon", "good evening"].includes(
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

  // ✅ Handle menu request
  if (msgBody.toLowerCase().includes("menu")) {
    await sendImageMessage(
      from,
      "https://i.imgur.com/2TcH7d6_d.png?maxwidth=520&shape=thumb&fidelity=high",
      "📋 *FreshBites Kitchen Menu* — Here’s what’s cooking today!"
    );

    const formattedMenu = Object.entries(MENU)
      .map(
        ([cat, items]) =>
          `🍽️ *${cat.toUpperCase()}*\n${items
            .map((i) => `• ${i.name} – ${i.price}\n  _${i.description}_`)
            .join("\n")}`
      )
      .join("\n\n");

    await sendMessage(from, formattedMenu);
    return res.sendStatus(200);
  }

  // ✅ Detect orders
  const order = detectOrder(msgBody);
  if (order) {
    await sendMessage(
      from,
      `🧾 *Order Summary:*\n${order.quantity} × ${order.name}\n💵 Unit: ₦${order.unitPrice.toLocaleString()}\n💰 Total: ₦${order.totalPrice.toLocaleString()}\nWould you like *pickup* or *delivery*?`
    );
    return res.sendStatus(200);
  }

// ✅ Continue chat flow
// (Your OpenAI conversation logic remains below unchanged)

// AI Chat memory
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
You are *FreshBites Kitchen Customer Support Bot*, the official WhatsApp assistant for FreshBites Restaurants — a fast, reliable, and affordable food delivery service in Nigeria. 
Your job is to help customers with questions about: 
- Menu options 
- Delivery times 
- Pricing 
- Business hours 
- Contact and support Details about the business: 
- Small package: ₦2,500 
- Medium package: ₦8,000 
- Large package: ₦20,000 
- Within city: 1–2 hours 
- Nearby cities: 3–5 hours 
- Nationwide: 24–48 hours 
- Pickup: free for orders over ₦10,000 
- Drop-off: free for orders over ₦15,000 
- Tracking: available via WhatsApp or website 
- Support hours: 8am–8pm daily 
- Support hours on Sunday: 2pm–8pm 
- Support hours on Monday: 9am–8pm 
- Support hours on Tuesday: 8am–8pm 
- Support hours on Wednesday: 8am–8pm 
- Support hours on Thursday: 8am–8pm 
- Support hours on Friday: 8am–8pm 
- Support hours on Saturday: 10am–8pm 
- Phone: 080-7237-8767 
- Tone: friendly, professional, reassuring Always give helpful, accurate responses *specific to FreshBites Kitchen* and avoid generic AI phrases. If a customer asks something unrelated, politely bring the focus back to deliveries or menu options. 

When users or customers mention ordering food, the system automatically detects and calculates totals. You only need to handle follow-ups (like confirming pickup/delivery, or giving cooking time). 

Never invent new dishes or prices. Always use a friendly, conversational Nigerian tone. 
Current intent: ${memory.intent || "general"}.

Menu:
${JSON.stringify(MENU, null, 2)}
`,
      },
      ...memory.chat,
      { role: "user", content: msgBody },
    ],
  });

  const reply = completion.choices[0].message.content.trim();
  memory.chat.push({ role: "user", content: msgBody });
  memory.chat.push({ role: "assistant", content: reply });

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
