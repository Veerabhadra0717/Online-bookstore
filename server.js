// Pagewise Books — backend server
// Run with: npm start   then open http://localhost:3000
const express = require("express");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const db = require("./db");
const { STATUSES, computeTotals, deliveryDate } = require("./pricing");

db.load();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || db.secret();
const IS_PROD = process.env.NODE_ENV === "production";
const GENRES = ["Fiction", "Mystery", "Self-help", "Science", "History", "Kids", "Business", "Fantasy"];

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

/* ---------------- helpers ---------------- */
const D = () => db.data;
const fail = (res, status, error) => res.status(status).json({ error });
const isEmail = v => typeof v === "string" && /^\S+@\S+\.\S+$/.test(v) && v.length <= 120;
const text = (v, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = v => (Number.isInteger(Number(v)) ? Number(v) : NaN);
const findBook = id => D().books.find(b => b.id === Number(id));

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

function bookView(b) {
  const rs = D().reviews.filter(r => r.bookId === b.id);
  const n = b.baseVotes + rs.length;
  const rating = n ? (b.baseRating * b.baseVotes + rs.reduce((s, r) => s + r.stars, 0)) / n : 0;
  // rating breakdown (5★ first)
  const a = b.baseRating || 4;
  const w = [Math.max(a - 3, .2) * 3, 1.4, Math.max(5 - a, .1) * 1.2, Math.max(5 - a, .1) * .5, Math.max(5 - a, .1) * .3];
  const ws = w.reduce((x, y) => x + y, 0);
  const dist = w.map(x => Math.round(x / ws * b.baseVotes));
  rs.forEach(r => dist[5 - r.stars]++);
  const { baseRating, baseVotes, ...pub } = b;
  return { ...pub, rating: Math.round(rating * 100) / 100, ratingCount: n, dist };
}

function reviewView(r, userId) {
  const { voters, ...pub } = r;
  return { ...pub, votedByMe: !!userId && voters.includes(userId) };
}

/* ---------------- auth ---------------- */
function setLogin(res, user) {
  const token = jwt.sign({ sub: user.id }, SECRET, { expiresIn: "7d" });
  res.cookie("token", token, { httpOnly: true, sameSite: "lax", secure: IS_PROD, maxAge: 7 * 24 * 3600 * 1000 });
}
app.use((req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    try { req.user = D().users.find(u => u.id === jwt.verify(token, SECRET).sub) || null; }
    catch { req.user = null; }
  }
  next();
});
const requireAuth = (req, res, next) => (req.user ? next() : fail(res, 401, "Please sign in first."));
const requireAdmin = (req, res, next) => (req.user?.role === "admin" ? next() : fail(res, 403, "Admins only."));

// simple brute-force protection for login
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), a = attempts.get(ip) || { n: 0, t: now };
  if (now - a.t > 15 * 60 * 1000) { a.n = 0; a.t = now; }
  a.n++; attempts.set(ip, a);
  return a.n > 10;
}

app.post("/api/auth/register", async (req, res) => {
  const name = text(req.body?.name, 60), email = text(req.body?.email, 120).toLowerCase(), password = String(req.body?.password || "");
  if (!name) return fail(res, 400, "Enter your name.");
  if (!isEmail(email)) return fail(res, 400, "Enter a valid email.");
  if (password.length < 6) return fail(res, 400, "Use at least 6 characters for your password.");
  if (D().users.some(u => u.email === email)) return fail(res, 409, "This email already has an account. Sign in instead.");
  const user = {
    id: "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name, email, passwordHash: await bcrypt.hash(password, 10), role: "customer",
    createdAt: new Date().toISOString(), points: 50, goal: 12, read: [], wishlist: [], addresses: []
  };
  D().users.push(user); db.save();
  setLogin(res, user);
  res.status(201).json({ user: publicUser(user) });
});

app.post("/api/auth/login", async (req, res) => {
  if (tooMany(req.ip)) return fail(res, 429, "Too many attempts. Try again in 15 minutes.");
  const email = text(req.body?.email, 120).toLowerCase(), password = String(req.body?.password || "");
  const user = D().users.find(u => u.email === email);
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) return fail(res, 401, "Email or password is incorrect.");
  attempts.delete(req.ip);
  setLogin(res, user);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ ok: true }); });
app.get("/api/auth/me", (req, res) => res.json({ user: publicUser(req.user) }));

/* ---------------- books & reviews ---------------- */
app.get("/api/books", (req, res) => res.json({ books: D().books.map(bookView) }));

app.get("/api/books/:id", (req, res) => {
  const b = findBook(req.params.id);
  if (!b) return fail(res, 404, "Book not found.");
  const reviews = D().reviews.filter(r => r.bookId === b.id).map(r => reviewView(r, req.user?.id));
  res.json({ book: bookView(b), reviews });
});

app.post("/api/books/:id/reviews", requireAuth, (req, res) => {
  const b = findBook(req.params.id);
  if (!b || b.comingSoon) return fail(res, 404, "You can't review this book yet.");
  const stars = int(req.body?.stars), body = text(req.body?.text, 1000);
  if (!(stars >= 1 && stars <= 5)) return fail(res, 400, "Choose a star rating.");
  if (body.length < 10) return fail(res, 400, "Write at least 10 characters.");
  if (D().reviews.some(r => r.bookId === b.id && r.userId === req.user.id)) return fail(res, 409, "You've already reviewed this book.");
  const r = { id: D().counters.review++, bookId: b.id, userId: req.user.id, name: req.user.name, stars, text: body,
              date: new Date().toISOString().slice(0, 10), helpful: 0, voters: [] };
  D().reviews.push(r); db.save();
  res.status(201).json({ review: reviewView(r, req.user.id), book: bookView(b) });
});

app.post("/api/reviews/:id/helpful", requireAuth, (req, res) => {
  const r = D().reviews.find(x => x.id === Number(req.params.id));
  if (!r) return fail(res, 404, "Review not found.");
  if (!r.voters.includes(req.user.id)) { r.voters.push(req.user.id); r.helpful++; db.save(); }
  res.json({ helpful: r.helpful });
});

app.post("/api/books/:id/notify", (req, res) => {
  const b = findBook(req.params.id), email = text(req.body?.email, 120).toLowerCase();
  if (!b) return fail(res, 404, "Book not found.");
  if (!isEmail(email)) return fail(res, 400, "Enter a valid email.");
  if (!D().notify.some(n => n.bookId === b.id && n.email === email)) { D().notify.push({ bookId: b.id, email, at: new Date().toISOString() }); db.save(); }
  res.json({ ok: true });
});

app.get("/api/coupons", (req, res) => res.json({ coupons: D().coupons }));

app.post("/api/newsletter", (req, res) => {
  const email = text(req.body?.email, 120).toLowerCase();
  if (!isEmail(email)) return fail(res, 400, "Enter a valid email to subscribe.");
  if (!D().newsletter.some(n => n.email === email)) { D().newsletter.push({ email, at: new Date().toISOString() }); db.save(); }
  res.json({ ok: true });
});

/* ---------------- my account ---------------- */
app.patch("/api/me", requireAuth, (req, res) => {
  const name = text(req.body?.name, 60);
  if (!name) return fail(res, 400, "Enter your name.");
  req.user.name = name; db.save();
  res.json({ user: publicUser(req.user) });
});

const validIds = ids => Array.isArray(ids) ? [...new Set(ids.map(Number))].filter(id => findBook(id)).slice(0, 200) : null;
app.put("/api/me/wishlist", requireAuth, (req, res) => {
  const ids = validIds(req.body?.ids); if (!ids) return fail(res, 400, "Invalid list.");
  req.user.wishlist = ids; db.save(); res.json({ user: publicUser(req.user) });
});
app.put("/api/me/read", requireAuth, (req, res) => {
  const ids = validIds(req.body?.ids); if (!ids) return fail(res, 400, "Invalid list.");
  req.user.read = ids; db.save(); res.json({ user: publicUser(req.user) });
});
app.put("/api/me/goal", requireAuth, (req, res) => {
  const goal = int(req.body?.goal);
  if (!(goal >= 1 && goal <= 365)) return fail(res, 400, "Pick a goal between 1 and 365.");
  req.user.goal = goal; db.save(); res.json({ user: publicUser(req.user) });
});
app.delete("/api/me/addresses/:i", requireAuth, (req, res) => {
  req.user.addresses.splice(Number(req.params.i), 1); db.save(); res.json({ user: publicUser(req.user) });
});

/* ---------------- orders ---------------- */
function validateShip(s = {}) {
  const ship = { name: text(s.name, 60), phone: text(s.phone, 10), addr: text(s.addr, 200), city: text(s.city, 60), pin: text(s.pin, 6) };
  if (!ship.name) return [null, "Enter the delivery name."];
  if (!/^[6-9]\d{9}$/.test(ship.phone)) return [null, "Enter a 10-digit mobile number."];
  if (ship.addr.length < 8) return [null, "Enter the full delivery address."];
  if (!ship.city) return [null, "Enter the city."];
  if (!/^\d{6}$/.test(ship.pin)) return [null, "Enter a 6-digit PIN code."];
  return [ship, null];
}
function validatePayment(p = {}) {
  if (p.method === "upi" && /^[\w.-]+@[a-zA-Z]+$/.test(p.upi || "")) return ["UPI · " + p.upi, null];
  if (p.method === "card" && /^\d{4}$/.test(p.last4 || "")) return ["Card ending " + p.last4, null];
  if (p.method === "cod") return ["Cash on delivery", null];
  return [null, "Check your payment details."];
}
// put stock and points back when an order is cancelled
function undoOrder(o) {
  o.items.forEach(i => { const b = findBook(i.id); if (b) b.stock += i.qty; });
  const u = D().users.find(x => x.id === o.userId);
  if (u) u.points = Math.max(0, u.points + o.totals.points - o.earned);
}

app.post("/api/orders", requireAuth, (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.items) || !body.items.length) return fail(res, 400, "Your cart is empty.");
  const qtyById = new Map();
  for (const it of body.items) {
    const id = Number(it.id), qty = int(it.qty);
    if (!(qty >= 1 && qty <= 20)) return fail(res, 400, "Quantities must be between 1 and 20.");
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  const lines = [];
  for (const [id, qty] of qtyById) {
    const b = findBook(id);
    if (!b || b.comingSoon) return fail(res, 409, "A book in your cart is no longer available. Please refresh your cart.");
    if (b.stock < qty) return fail(res, 409, b.stock ? `Only ${b.stock} ${b.stock === 1 ? "copy" : "copies"} of “${b.title}” ${b.stock === 1 ? "is" : "are"} left. Please update your cart.` : `“${b.title}” just sold out. Please remove it from your cart.`);
    lines.push({ b, qty, price: b.price, mrp: b.mrp });
  }
  const [ship, shipErr] = validateShip(body.ship); if (shipErr) return fail(res, 400, shipErr);
  const [payment, payErr] = validatePayment(body.payment); if (payErr) return fail(res, 400, payErr);
  let coupon = null, code = text(body.coupon, 20).toUpperCase();
  if (code) {
    coupon = D().coupons[code];
    if (!coupon) return fail(res, 400, "That coupon code isn't valid.");
    const sub = lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (coupon.min && sub < coupon.min) return fail(res, 400, `${code} needs ₹${coupon.min} or more in your cart.`);
  }
  const u = req.user;
  const totals = computeTotals({ lines, coupon, express: !!body.express, gift: !!body.gift, usePoints: !!body.usePoints, availablePoints: u.points });
  const earned = Math.floor(totals.total / 10);
  const now = new Date();

  lines.forEach(l => { l.b.stock -= l.qty; });
  u.points = u.points - totals.points + earned;
  if (!u.addresses.some(a => a.addr === ship.addr && a.pin === ship.pin)) u.addresses.unshift(ship);
  u.addresses = u.addresses.slice(0, 5);

  const order = {
    id: "PW" + D().counters.order++, userId: u.id, customer: u.name, email: u.email, createdAt: now.toISOString(),
    items: lines.map(l => ({ id: l.b.id, title: l.b.title, author: l.b.author, qty: l.qty, price: l.price })),
    totals, coupon: coupon ? code : "", ship, payment, express: !!body.express, gift: !!body.gift,
    giftMsg: body.gift ? text(body.giftMsg, 150) : "", eta: deliveryDate(ship.pin, !!body.express, now), earned,
    status: "Confirmed", history: [{ status: "Confirmed", at: now.toISOString() }]
  };
  D().orders.unshift(order);
  db.save();
  res.status(201).json({ order, user: publicUser(u) });
});

app.get("/api/orders", requireAuth, (req, res) => res.json({ orders: D().orders.filter(o => o.userId === req.user.id) }));

app.post("/api/orders/:id/cancel", requireAuth, (req, res) => {
  const o = D().orders.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!o) return fail(res, 404, "Order not found.");
  if (!["Confirmed", "Packed"].includes(o.status)) return fail(res, 409, "This order has already shipped and can't be cancelled.");
  undoOrder(o);
  o.status = "Cancelled"; o.history.push({ status: "Cancelled", at: new Date().toISOString() });
  db.save();
  res.json({ order: o, user: publicUser(req.user) });
});

/* ---------------- admin ---------------- */
app.get("/api/admin/stats", requireAuth, requireAdmin, (req, res) => {
  const live = D().orders.filter(o => o.status !== "Cancelled");
  const today = new Date().toISOString().slice(0, 10);
  const sold = {};
  live.forEach(o => o.items.forEach(i => { sold[i.id] = (sold[i.id] || 0) + i.qty; }));
  const byStatus = Object.fromEntries([...STATUSES, "Cancelled"].map(s => [s, D().orders.filter(o => o.status === s).length]));
  res.json({
    revenue: live.reduce((s, o) => s + o.totals.total, 0),
    orders: D().orders.length,
    ordersToday: D().orders.filter(o => o.createdAt.startsWith(today)).length,
    customers: D().users.filter(u => u.role !== "admin").length,
    avgOrder: live.length ? Math.round(live.reduce((s, o) => s + o.totals.total, 0) / live.length) : 0,
    byStatus,
    lowStock: D().books.filter(b => !b.comingSoon && b.stock <= 3).map(b => ({ id: b.id, title: b.title, stock: b.stock })),
    topSellers: Object.entries(sold).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, qty]) => ({ id: Number(id), title: findBook(id)?.title || "Deleted book", qty })),
    subscribers: D().newsletter.length,
    notifyRequests: D().notify.length
  });
});

app.get("/api/admin/orders", requireAuth, requireAdmin, (req, res) => res.json({ orders: D().orders }));

app.patch("/api/admin/orders/:id", requireAuth, requireAdmin, (req, res) => {
  const o = D().orders.find(x => x.id === req.params.id);
  const status = req.body?.status;
  if (!o) return fail(res, 404, "Order not found.");
  if (![...STATUSES, "Cancelled"].includes(status)) return fail(res, 400, "Unknown status.");
  if (o.status === "Cancelled") return fail(res, 409, "Cancelled orders can't be changed.");
  if (status === "Cancelled") undoOrder(o);
  o.status = status; o.history.push({ status, at: new Date().toISOString() });
  db.save();
  res.json({ order: o });
});

app.get("/api/admin/users", requireAuth, requireAdmin, (req, res) => {
  res.json({ users: D().users.map(u => ({ ...publicUser(u), orders: D().orders.filter(o => o.userId === u.id).length })) });
});

function readBookFields(src, existing = {}) {
  const b = {};
  if ("title" in src || !existing.id) { b.title = text(src.title, 120); if (!b.title) return [null, "Enter a title."]; }
  if ("author" in src || !existing.id) { b.author = text(src.author, 80); if (!b.author) return [null, "Enter an author."]; }
  if ("genre" in src || !existing.id) { b.genre = src.genre; if (!GENRES.includes(b.genre)) return [null, "Choose a genre."]; }
  for (const k of ["price", "mrp", "stock", "pages", "year"]) {
    if (k in src || !existing.id) {
      const v = int(src[k] ?? (k === "pages" ? 200 : k === "year" ? new Date().getFullYear() : 0));
      if (!(v >= 0)) return [null, `Enter a whole number for ${k}.`];
      b[k] = v;
    }
  }
  const price = b.price ?? existing.price, mrp = b.mrp ?? existing.mrp;
  if (!(price > 0)) return [null, "Price must be more than 0."];
  if (mrp < price) return [null, "List price (MRP) can't be lower than the selling price."];
  if ("desc" in src) b.desc = text(src.desc, 600);
  if ("comingSoon" in src) b.comingSoon = text(src.comingSoon, 20);
  return [b, null];
}

app.post("/api/admin/books", requireAuth, requireAdmin, (req, res) => {
  const [fields, err] = readBookFields(req.body || {});
  if (err) return fail(res, 400, err);
  const palette = [["#2C6E8F", "#0F2F44"], ["#A12A3B", "#2E0A10"], ["#6A8F3A", "#2F4A18"], ["#B07D2B", "#4C3410"], ["#8C7AB8", "#4B3D78"], ["#E07A2E", "#A33B1E"]];
  const [c1, c2] = palette[Math.floor(Math.random() * palette.length)];
  const b = { id: D().counters.book++, desc: "", opening: "A sample chapter will be added soon.", comingSoon: "", c1, c2, baseRating: 0, baseVotes: 0, ...fields };
  D().books.push(b); db.save();
  res.status(201).json({ book: bookView(b) });
});

app.patch("/api/admin/books/:id", requireAuth, requireAdmin, (req, res) => {
  const b = findBook(req.params.id);
  if (!b) return fail(res, 404, "Book not found.");
  const [fields, err] = readBookFields(req.body || {}, b);
  if (err) return fail(res, 400, err);
  Object.assign(b, fields); db.save();
  res.json({ book: bookView(b) });
});

app.delete("/api/admin/books/:id", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!findBook(id)) return fail(res, 404, "Book not found.");
  D().books = D().books.filter(b => b.id !== id);
  D().reviews = D().reviews.filter(r => r.bookId !== id);
  D().users.forEach(u => { u.wishlist = u.wishlist.filter(x => x !== id); });
  db.save();
  res.json({ ok: true });
});

/* ---------------- frontend + errors ---------------- */
app.use("/api", (req, res) => fail(res, 404, "Unknown API route."));
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return fail(res, 400, "Invalid request.");
  console.error(err);
  fail(res, 500, "Something went wrong on the server. Please try again.");
});

app.listen(PORT, () => {
  console.log(`\n📚 Pagewise Books is running at http://localhost:${PORT}`);
  console.log(`   Admin login: admin@pagewise.com / admin123`);
  console.log(`   Data file:   ${db.FILE}\n`);
});
