// Shared price rules. The server always recalculates totals with these,
// so prices sent from the browser are never trusted.
const FREE_SHIP_MIN = 499, SHIP_FEE = 49, EXPRESS_FEE = 79, WRAP_FEE = 30, MAX_POINTS_SHARE = 0.2;
const STATUSES = ["Confirmed", "Packed", "Shipped", "Out for delivery", "Delivered"];

function couponDiscount(c, sub) {
  if (!c || (c.min && sub < c.min)) return 0;
  if (c.type === "percent") return Math.round(sub * c.value / 100);
  if (c.type === "flat") return c.value;
  return 0;
}

function computeTotals({ lines, coupon, express, gift, usePoints, availablePoints }) {
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const mrp = lines.reduce((s, l) => s + l.qty * l.mrp, 0);
  const discount = couponDiscount(coupon, sub);
  const shipping = !count || sub >= FREE_SHIP_MIN || coupon?.type === "freeship" ? 0 : SHIP_FEE;
  const exp = count && express ? EXPRESS_FEE : 0;
  const wrap = count && gift ? WRAP_FEE : 0;
  const maxPts = Math.floor((sub - discount) * MAX_POINTS_SHARE);
  const points = count && usePoints ? Math.min(availablePoints || 0, maxPts) : 0;
  const total = sub - discount + shipping + exp + wrap - points;
  return { count, sub, mrp, discount, shipping, express: exp, wrap, points, maxPts, total };
}

function deliveryDate(pin, express, from = new Date()) {
  const days = (String(pin).startsWith("56") ? 2 : 4) - (express ? 1 : 0);
  const d = new Date(from); d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

module.exports = { FREE_SHIP_MIN, STATUSES, couponDiscount, computeTotals, deliveryDate };
