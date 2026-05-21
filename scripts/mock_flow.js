import { detectOrder } from "../orderLogic.js";

const samples = [
  "2 suya",
  "pepper soup",
  "beer",
  "energy drink",
  "3 jollof",
  "2 chapman",
];

function describeOrder(order) {
  if (!order) return "No order detected.";
  if (order.variantPrices) {
    const options = Object.entries(order.variantPrices)
      .map(([variant, price]) => `${variant} (₦${price.toLocaleString()})`)
      .join(", ");
    return `Variant prompt -> ${options}`;
  }
  if (order.priceRange) {
    return `Price range prompt -> ₦${order.priceRange.min.toLocaleString()}–₦${order.priceRange.max.toLocaleString()}`;
  }
  return `Summary -> ${order.quantity} x ${order.name} = ₦${order.totalPrice.toLocaleString()}`;
}

for (const text of samples) {
  const order = detectOrder(text);
  console.log(`Input: ${text}`);
  console.log(describeOrder(order));
  console.log("---");
}
