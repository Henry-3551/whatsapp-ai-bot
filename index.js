// file: server.js
import express from "express";
import session from "express-session";
import Redis from "ioredis";
import { RedisStore } from "connect-redis"; // <-- ✅ use named import
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";
import OpenAI from "openai";
import { MENU, detectOrder, parseVariantsFromName } from "./orderLogic.js";

dotenv.config();

// --- Redis client ---
const redisClient = new Redis(process.env.REDIS_URL);

// --- Express app setup ---
const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

// --- Sessions using connect-redis v8 syntax ---
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  console.error("❌ Missing SESSION_SECRET in environment.");
  process.exit(1);
}

app.use(
  session({
    store: new RedisStore({
      client: redisClient,
      prefix: "sess:", // optional
    }),
    secret: SESSION_SECRET,
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
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const PRICING_TEXT =
  "💰 *Pricing Packages:*\n- Small: ₦2,500\n- Medium: ₦8,000\n- Large: ₦20,000";
const DELIVERY_TEXT =
  "🚚 *Delivery Times:*\n- Within city: 1–2 hours\n- Nearby cities: 3–5 hours\n- Nationwide: 24–48 hours\n\n✅ Pickup: free for orders over ₦10,000\n✅ Drop-off: free for orders over ₦15,000\n📍 Tracking: available via WhatsApp or website";
const CONTACT_TEXT =
  "📞 *Support:* 080-7237-8767\n🕒 *Support hours:* 8am–8pm daily (Sun 2pm–8pm, Mon 9am–8pm, Sat 10am–8pm)";

async function sendPickupDeliveryPrompt(to, text) {
  await sendButtonMessage(to, text, ["🛍️ Pickup", "🚚 Delivery"]);
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

function containsMenuReference(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const category of Object.values(MENU)) {
    for (const item of category) {
      if (lower.includes(item.name.toLowerCase())) return true;
      if (Array.isArray(item.variants)) {
        for (const variant of item.variants) {
          if (lower.includes(variant.label.toLowerCase())) return true;
        }
      }
    }
  }
  return false;
}

function isPriceLike(text) {
  if (!text) return false;
  return /₦|\b\d{1,3}(?:,\d{3})+\b/.test(text);
}

/* ---------- USER MEMORY HELPERS ---------- */
async function getUserMemory(userId) {
  const data = await redisClient.get(`user:${userId}`);
  return data
    ? JSON.parse(data)
    : { greeted: false, chat: [], intent: null, lastGreetedAt: null, pendingOrder: null };
}

async function saveUserMemory(userId, memory) {
  await redisClient.set(`user:${userId}`, JSON.stringify(memory), "EX", 60 * 60 * 24 * 7); // keep for 7 days
}


/* ---------- WEBHOOK ---------- */
app.post("/webhook", async (req, res) => {
  if (WHATSAPP_APP_SECRET) {
    const signature = req.get("x-hub-signature-256") || "";
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", WHATSAPP_APP_SECRET)
        .update(req.rawBody || Buffer.from(""))
        .digest("hex");

    const isValid =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

    if (!isValid) {
      console.warn("⚠️ Invalid webhook signature");
      return res.sendStatus(403);
    }
  }

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

  // ✅ Load user memory from Redis
  let memory = await getUserMemory(from);
  const now = Date.now();
  const shouldGreetAgain =
    !memory.lastGreetedAt || now - memory.lastGreetedAt > 24 * 60 * 60 * 1000;

  // ✅ First-time or new-day greeting
  if (!memory.greeted || shouldGreetAgain) {
    memory.greeted = true;
    memory.lastGreetedAt = now;
    memory.chat = [];
    memory.intent = "intro";
    memory.pendingOrder = null;

    // 1️⃣ Send brand logo
    await sendImageMessage(
      from,
      "https://i.imgur.com/6qCXNkR_d.jpeg?maxwidth=520&shape=thumb&fidelity=high",
      "🍽️ *Welcome to FreshBites Kitchen!* — Where every meal tells a delicious story."
    );

    // 2️⃣ Send restaurant photo
    await sendImageMessage(
      from,
      "https://i.imgur.com/XHLXHLR_d.jpeg?maxwidth=520&shape=thumb&fidelity=high",
      "✨ *Experience the taste, aroma, and warmth of our kitchen* — freshly made for you ❤️"
    );

    // 3️⃣ Send interactive buttons
    await sendButtonMessage(
      from,
      "👋 Hi there! It’s great to have you here at *FreshBites Kitchen*.\n\nI’m your friendly assistant. What would you like to do today?",
      ["📋 View Menu", "🚚 Delivery Info", "💰 Pricing"]
    );

    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

  // ✅ Handle greetings
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

  // ✅ Handle pending variant selection for ranged prices
  if (memory.intent === "order_variant" && memory.pendingOrder) {
    const { name, quantity, variantPrices, priceRange } = memory.pendingOrder;
    const lower = msgBody.toLowerCase();
    const picked = variantPrices
      ? Object.entries(variantPrices).find(([variant]) =>
          lower.includes(variant.toLowerCase())
        )
      : null;

    if (picked) {
      const [variant, unitPrice] = picked;
      const totalPrice = unitPrice * quantity;

      await sendPickupDeliveryPrompt(
        from,
        `🧾 *Order Summary:*\n${quantity} × ${name} (${variant})\n💵 Unit: ₦${unitPrice.toLocaleString()}\n💰 Total: ₦${totalPrice.toLocaleString()}`
      );

      memory.intent = "order";
      memory.pendingOrder = null;
      await saveUserMemory(from, memory);
      return res.sendStatus(200);
    }

    if (!variantPrices && priceRange) {
      const priceMatch = lower.match(/(\d[\d,]*)/);
      const chosen = priceMatch
        ? parseInt(priceMatch[1].replace(/,/g, ""), 10)
        : NaN;

      if (Number.isFinite(chosen) && chosen >= priceRange.min && chosen <= priceRange.max) {
        const totalPrice = chosen * quantity;
        await sendPickupDeliveryPrompt(
          from,
          `🧾 *Order Summary:*\n${quantity} × ${name}\n💵 Unit: ₦${chosen.toLocaleString()}\n💰 Total: ₦${totalPrice.toLocaleString()}`
        );

        memory.intent = "order";
        memory.pendingOrder = null;
        await saveUserMemory(from, memory);
        return res.sendStatus(200);
      }
    }

    if (variantPrices) {
      const options = Object.entries(variantPrices).map(
        ([variant, price]) => `${variant} (₦${price.toLocaleString()})`
      );
      await sendButtonMessage(
        from,
        "Please choose one option so I can confirm the price:",
        options.slice(0, 3)
      );
    } else if (priceRange) {
      await sendMessage(
        from,
        `Please reply with the exact price you want (₦${priceRange.min.toLocaleString()}–₦${priceRange.max.toLocaleString()}).`
      );
    }
    return res.sendStatus(200);
  }

  // ✅ Handle menu requests
  if (msgBody.toLowerCase().includes("menu")) {
    await sendImageMessage(
      from,
      "https://i.imgur.com/rIMIvng_d.jpeg?maxwidth=520&shape=thumb&fidelity=high",
      "📋 *FreshBites Kitchen Menu* — Here’s what’s cooking today!"
    );

    const formattedMenu = Object.entries(MENU)
      .map(([cat, items]) =>
        `🍽️ *${cat.toUpperCase()}*\n${items
          .map((i) => {
            const detail = i.description || (i.Size ? `Size: ${i.Size}` : "");
            return `• ${i.name} – ${i.price}${detail ? `\n  _${detail}_` : ""}`;
          })
          .join("\n")}`
      )
      .join("\n\n");

    await sendMessage(from, formattedMenu);
    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

  // ✅ Handle delivery/pricing/support without LLM
  const lowerMsg = msgBody.toLowerCase();
  if (lowerMsg.includes("delivery") || lowerMsg.includes("deliver")) {
    await sendMessage(from, DELIVERY_TEXT);
    return res.sendStatus(200);
  }
  if (lowerMsg.includes("price") || lowerMsg.includes("pricing")) {
    await sendMessage(from, PRICING_TEXT);
    return res.sendStatus(200);
  }
  if (
    lowerMsg.includes("support") ||
    lowerMsg.includes("contact") ||
    lowerMsg.includes("help") ||
    lowerMsg.includes("human") ||
    lowerMsg.includes("agent") ||
    lowerMsg.includes("staff") ||
    lowerMsg.includes("representative") ||
    lowerMsg.includes("real person") ||
    lowerMsg.includes("customer care") ||
    lowerMsg.includes("customer service") ||
    lowerMsg.includes("talk to someone") ||
    lowerMsg.includes("talk to a person")
  ) {
    await sendMessage(from, CONTACT_TEXT);
    return res.sendStatus(200);
  }

  // ✅ Detect orders
  const order = detectOrder(msgBody);
  if (order) {
    if (order.variantPrices) {
      memory.intent = "order_variant";
      memory.pendingOrder = {
        name: order.name,
        quantity: order.quantity,
        variantPrices: order.variantPrices,
      };

      await saveUserMemory(from, memory);
      await sendButtonMessage(
        from,
        "Which option would you like?",
        Object.entries(order.variantPrices).map(
          ([variant, price]) => `${variant} (₦${price.toLocaleString()})`
        )
      );
      return res.sendStatus(200);
    }

    if (order.priceRange) {
      const variants = parseVariantsFromName(order.name);
      if (variants.length === 2) {
        const variantPrices = {
          [variants[0]]: order.priceRange.min,
          [variants[1]]: order.priceRange.max,
        };
        memory.intent = "order_variant";
        memory.pendingOrder = {
          name: order.name,
          quantity: order.quantity,
          variantPrices,
        };

        await saveUserMemory(from, memory);
        await sendButtonMessage(
          from,
          "Which option would you like?",
          Object.entries(variantPrices).map(
            ([variant, price]) => `${variant} (₦${price.toLocaleString()})`
          )
        );
        return res.sendStatus(200);
      }

      memory.intent = "order_variant";
      memory.pendingOrder = {
        name: order.name,
        quantity: order.quantity,
        priceRange: order.priceRange,
      };

      await saveUserMemory(from, memory);
      await sendMessage(
        from,
        `Please reply with the exact price you want (₦${order.priceRange.min.toLocaleString()}–₦${order.priceRange.max.toLocaleString()}).`
      );
      return res.sendStatus(200);
    }

    await sendPickupDeliveryPrompt(
      from,
      `🧾 *Order Summary:*\n${order.quantity} × ${order.name}\n💵 Unit: ₦${order.unitPrice.toLocaleString()}\n💰 Total: ₦${order.totalPrice.toLocaleString()}`
    );
    await saveUserMemory(from, memory);
    return res.sendStatus(200);
  }

// ✅ Continue AI chat (you can keep your existing OpenAI logic below)
// proceed to the OpenAI handling below (do not end the request here so memory and msgBody remain available)


// ✅ Continue chat flow
// (Your OpenAI conversation logic remains below unchanged)

// AI Chat memory
  const systemPrompt = `
You are *FreshBites Kitchen Customer Support Bot*, the official WhatsApp assistant for FreshBites Restaurants — a fast, reliable, and affordable food delivery service in Nigeria.
Your job is to answer only general FAQs about delivery times, pricing packages, business hours, and contact.

Never invent dishes, prices, or menu items. If a user asks about menu or prices, respond with a short prompt that directs them to type "menu" or choose a pricing package.
When a user is ordering, the system handles totals. You only guide pickup/delivery and general support info.

Return ONLY valid JSON (no markdown, no extra text) in this schema:
{"type":"faq|delivery_info|pricing_info|menu_request|clarify|handoff","text":"short reply"}

You already know the customer's current intent is "${memory.intent || "general"}".
If unclear, ask a concise clarification.
Tone: friendly, professional, reassuring, Nigerian conversational.`;

  memory.chat.push({ role: "user", content: msgBody });
  const conversation = [
    { role: "system", content: systemPrompt },
    ...memory.chat.slice(-6), // keep last few messages only
  ];

  let rawReply = null;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversation,
      temperature: 0.2,
    });
    rawReply = completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("❌ OpenAI error:", err?.message || err);
    await sendMessage(
      from,
      "Sorry, I’m having trouble right now. Please ask about delivery, pricing, or support."
    );
    return res.sendStatus(200);
  }
  let replyText = null;
  let replyType = null;
  try {
    const parsed = JSON.parse(rawReply);
    if (parsed && typeof parsed.type === "string" && typeof parsed.text === "string") {
      replyType = parsed.type;
      replyText = parsed.text.trim();
    }
  } catch (err) {
    replyType = "clarify";
    replyText = "Sorry, I didn’t catch that. Are you asking about delivery, pricing, or support?";
  }

  if (!replyText) {
    replyType = "clarify";
    replyText = "Sorry, I didn’t catch that. Are you asking about delivery, pricing, or support?";
  }

  const isSafeType = ["pricing_info", "delivery_info", "handoff", "menu_request"].includes(
    replyType
  );

  if (replyType === "pricing_info") replyText = PRICING_TEXT;
  if (replyType === "delivery_info") replyText = DELIVERY_TEXT;
  if (replyType === "handoff") replyText = CONTACT_TEXT;
  if (replyType === "menu_request") {
    replyText = "Please type *menu* or tap *View Menu* to see today’s items.";
  }

  if (!isSafeType && (containsMenuReference(replyText) || isPriceLike(replyText))) {
    replyText = "Please type *menu* or ask about delivery/support.";
  }

  memory.chat.push({ role: "assistant", content: replyText });

  await sendMessage(from, replyText);
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
