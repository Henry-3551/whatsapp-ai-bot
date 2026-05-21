/* ---------- MENU ---------- */
export const MENU = {
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
    {
      name: "Suya (Beef / Chicken)",
      description: "Spicy skewered meat served with onions and peppers",
      price: "₦1,000-₦2,000",
      variants: [
        { label: "Beef", price: 1000 },
        { label: "Chicken", price: 2000 },
      ],
    },
  ],
  "🥤 DRINKS & BEVERAGES": [
    { name: "Soft Drinks", Size: "50cl", price: "₦500" },
    { name: "Bottled Water", Size: "75cl", price: "₦300" },
    { name: "Zobo Drink", Size: "cup", price: "₦600" },
    { name: "Chapman", Size: "Glass", price: "₦1,200" },
    { name: "Palm Wine", Size: "Calabash", price: "₦1,000" },
    { name: "Smoothie", Size: "Glass", price: "₦1,800" },
    {
      name: "Beer / Malt / Energy Drink",
      Size: "Bottle",
      price: "₦1,200–₦1,800",
      variants: [
        { label: "Beer", price: 1200 },
        { label: "Malt", price: 1200 },
        { label: "Energy Drink", price: 1800 },
      ],
    },
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
    {
      name: "Pepper Soup (Goat / Catfish)",
      description: "Spicy broth with your choice of meat or fish",
      price: "₦2,500 / ₦3,000",
      variants: [
        { label: "Goat", price: 2500 },
        { label: "Catfish", price: 3000 },
      ],
    },
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
export function parsePriceRange(rawPrice) {
  if (!rawPrice) return null;
  const parts = rawPrice
    .replace(/[₦,]/g, "")
    .split(/\s*(?:-|–|\/|to)\s*/i)
    .map((p) => parseInt(p.replace(/[^\d]/g, ""), 10))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return null;
  return { min: Math.min(...parts), max: Math.max(...parts) };
}

export function parseVariantsFromName(name) {
  if (!name) return [];
  const match = name.match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1]
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function detectOrder(message) {
  if (!message || typeof message !== "string") return null;
  const msg = message.toLowerCase();
  const orderMatch = msg.match(/(\d+)?\s*(.*)/);
  if (!orderMatch) return null;

  const quantity = parseInt(orderMatch[1]) || 1;
  const mealName = orderMatch[2]?.trim() || "";
  const normalized = mealName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const category of Object.values(MENU)) {
    for (const item of category) {
      const itemName = item.name.toLowerCase();
      const itemNameNoParen = itemName.replace(/\s*\([^)]*\)/g, "").trim();
      const firstWord = itemName.split(" ")[0];
      const itemTokens = itemNameNoParen
        .split(/\s+/)
        .filter((token) => token.length > 2);
      const variantLabels = Array.isArray(item.variants)
        ? item.variants.map((variant) => variant.label.toLowerCase())
        : [];
      const variantLabelTokens = variantLabels.map((label) =>
        label.split(/\s+/).filter((token) => token.length > 2)
      );
      const matchesVariant = variantLabelTokens.some((tokens) =>
        tokens.every((token) => normalized.includes(token))
      );
      const tokenMatches = itemTokens.filter((token) => normalized.includes(token));
      const matchesItem =
        normalized.includes(itemNameNoParen) ||
        normalized.includes(firstWord) ||
        tokenMatches.length >= 2;

      if (matchesItem || matchesVariant) {
        if (Array.isArray(item.variants) && item.variants.length) {
          const variantPrices = Object.fromEntries(
            item.variants.map((variant) => [variant.label, variant.price])
          );
          const prices = Object.values(variantPrices);
          const range = { min: Math.min(...prices), max: Math.max(...prices) };
          return {
            name: item.name,
            quantity,
            priceRange: range.min !== range.max ? range : null,
            variantPrices,
          };
        }

        const range = parsePriceRange(item.price);
        if (!range) return null;
        const unitPrice = range.min;
        return {
          name: item.name,
          quantity,
          unitPrice,
          totalPrice: unitPrice * quantity,
          priceRange: range.max !== range.min ? range : null,
        };
      }
    }
  }
  return null;
}
