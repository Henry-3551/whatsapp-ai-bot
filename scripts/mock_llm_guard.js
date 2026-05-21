import { MENU } from "../orderLogic.js";

const PRICING_TEXT =
  "💰 *Pricing Packages:*\n- Small: ₦2,500\n- Medium: ₦8,000\n- Large: ₦20,000";
const DELIVERY_TEXT =
  "🚚 *Delivery Times:*\n- Within city: 1–2 hours\n- Nearby cities: 3–5 hours\n- Nationwide: 24–48 hours\n\n✅ Pickup: free for orders over ₦10,000\n✅ Drop-off: free for orders over ₦15,000\n📍 Tracking: available via WhatsApp or website";
const CONTACT_TEXT =
  "📞 *Support:* 080-7237-8767\n🕒 *Support hours:* 8am–8pm daily (Sun 2pm–8pm, Mon 9am–8pm, Sat 10am–8pm)";

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

function guardReply(rawReply) {
  let replyText = null;
  let replyType = null;

  try {
    const parsed = JSON.parse(rawReply);
    if (parsed && typeof parsed.type === "string" && typeof parsed.text === "string") {
      replyType = parsed.type;
      replyText = parsed.text.trim();
    }
  } catch {
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

  return { replyType, replyText };
}

const samples = [
  "{\"type\":\"pricing_info\",\"text\":\"Small pack is 2,500\"}",
  "{\"type\":\"delivery_info\",\"text\":\"Within city is 2 hours\"}",
  "{\"type\":\"menu_request\",\"text\":\"Try Jollof Rice\"}",
  "{\"type\":\"faq\",\"text\":\"We are open daily.\"}",
  "not json at all",
];

for (const raw of samples) {
  const { replyType, replyText } = guardReply(raw);
  console.log("Raw:", raw);
  console.log("Type:", replyType);
  console.log("Reply:", replyText);
  console.log("---");
}
