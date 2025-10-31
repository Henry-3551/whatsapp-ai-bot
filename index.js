// file: server.js
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import axios from "axios";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.json());

app.use(
  session({
    secret: "henrify_secret_key_2025",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 20 },
  })
);

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
    { name: "Native Jollof (Palm Oil Rice)", description: "Local-style rice with smoked fish, crayfish & scent leaf", price: "₦2,500" },
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

/* ---------- WEBHOOK ---------- */
app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;
    const type = message?.type;

    if (!message || !from) {
      console.log("⚠️ No message or sender found, skipping event.");
      return res.sendStatus(200);
    }

    let msgBody = message?.text?.body || message?.interactive?.button_reply?.title || "";

    // 🎧 Handle voice notes
    if (type === "audio") {
      console.log("🎧 Voice message detected — downloading...");
      const audioId = message.audio.id;

      // Step 1: Get the media URL
      const mediaUrlRes = await axios.get(
        `https://graph.facebook.com/v21.0/${audioId}`,
        { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
      );

      const audioUrl = mediaUrlRes.data.url;

      // Step 2: Download the audio file
      const audioRes = await axios.get(audioUrl, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
        responseType: "arraybuffer",
      });

      const audioPath = path.join(__dirname, "voice_note.ogg");
      fs.writeFileSync(audioPath, audioRes.data);

      // Step 3: Transcribe with Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "gpt-4o-mini-transcribe",
      });

      msgBody = transcription.text;
      console.log(`🗣️ Transcribed voice: ${msgBody}`);
      fs.unlinkSync(audioPath); // Clean up
    }

    if (!msgBody) {
      console.log("⚠️ No valid text/transcription found.");
      return res.sendStatus(200);
    }

    console.log(`📩 [${from}] ${msgBody}`);

    /* ---------- Handle greetings ---------- */
    if (["hi", "hello", "hey", "good morning", "good evening"].includes(msgBody.toLowerCase())) {
      await sendButtonMessage(from, "👋 Welcome to FoodBites Kitchen! How can we help you today?", [
        "📋 View Menu",
        "🚚 Delivery Time",
        "💰 Pricing",
      ]);
      return res.sendStatus(200);
    }

    /* ---------- Handle menu ---------- */
    if (msgBody.toLowerCase().includes("menu")) {
      const formattedMenu = Object.entries(MENU)
        .map(([cat, items]) =>
          `🍽️ *${cat.toUpperCase()}*\n${items
            .map((i) => `• ${i.name} – ${i.price}\n  _${i.description}_`)
            .join("\n")}`
        )
        .join("\n\n");
      await sendMessage(from, formattedMenu);
      return res.sendStatus(200);
    }

    /* ---------- Handle orders ---------- */
    const order = detectOrder(msgBody);
    if (order) {
      await sendMessage(
        from,
        `🧾 *Order Summary:*\n${order.quantity} × ${order.name}\n💵 Unit: ₦${order.unitPrice.toLocaleString()}\n💰 Total: ₦${order.totalPrice.toLocaleString()}\nWould you like *pickup* or *delivery*?`
      );
      return res.sendStatus(200);
    }

    /* ---------- Memory chat ---------- */
    if (!req.session.memory) req.session.memory = {};
    if (!req.session.memory[from])
      req.session.memory[from] = { chat: [], intent: null, lastQuestion: null };

    const memory = req.session.memory[from];

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
You are *FoodBites Kitchen Customer Support Bot*, the official WhatsApp assistant for FoodBites Restaurants.
Be friendly, helpful, and concise.
Provide accurate responses about menu, delivery, and pricing.
Avoid generic AI disclaimers.
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
  } catch (err) {
    console.error("❌ Webhook error:", err.message);
    res.sendStatus(500);
  }
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

app.listen(3000, () => console.log("✅ WhatsApp + AI bot running on port 3000"));
