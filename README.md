# Pagewise Books — full-stack online bookstore

Node.js + Express backend with a JSON file database, and a single-page frontend.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org
2. Open a terminal in this folder and run:

   ```
   npm start
   ```

3. Open **http://localhost:3000** in your browser.

`node_modules` is already included, so `npm install` isn't needed. If you ever delete it, run `npm install` once.

**Admin login:** `admin@pagewise.com` / `admin123` (change this before putting the site online).

## What the backend does

- **Accounts:** sign up and sign in with hashed passwords (bcrypt) and a secure httpOnly login cookie (JWT, 7 days). Too many wrong passwords are blocked for 15 minutes.
- **Orders:** the server recalculates every price, coupon, delivery fee and points discount itself, so prices can't be changed from the browser. It checks stock, reduces stock, awards reward points and saves the address.
- **Order status:** Confirmed, Packed, Shipped, Out for delivery, Delivered. Admins change the status. Customers can cancel until the order ships, and the stock and points are returned.
- **Reviews:** signed-in customers can post one review per book and mark reviews helpful once.
- **Account data:** wishlist, reading goal, books read and saved addresses are stored per user.
- **Admin dashboard** (`#/admin`): revenue and order stats, low-stock alerts, top sellers, order status updates, add, edit and delete books, and the customer list.
- **Other:** newsletter signups and back-in-stock requests are saved.
- **Payments:** this is a demo, so no real payment is taken. Only the last 4 digits of a card reach the server.

## Files

| File | What it does |
|---|---|
| `server.js` | All API routes and serving the website |
| `db.js` | Reads and writes `data/db.json` |
| `pricing.js` | Price, coupon, delivery and points rules |
| `seed.js` | Sample books, reviews, coupons and the admin account |
| `public/index.html` | The whole frontend (HTML, CSS and JavaScript) |
| `data/` | Created on first run: your database and the login-token secret |

## Useful commands

- `npm start` — start the store
- `npm run reset` — delete all data and start fresh with the sample books

## Settings (optional)

| Variable | Default | Use |
|---|---|---|
| `PORT` | 3000 | Port to run on |
| `JWT_SECRET` | auto-created in `data/secret.key` | Secret for login tokens |
| `DATA_DIR` | `./data` | Where the database is saved |
| `NODE_ENV` | — | Set to `production` online so cookies are HTTPS-only |

## Putting it online (Render)

1. Push this folder to GitHub (`node_modules` and `data` are in `.gitignore`).
2. On Render, create a **Web Service**. Build command: `npm install`. Start command: `npm start`.
3. Add the environment variables `NODE_ENV=production` and a long random `JWT_SECRET`.
4. Add a **persistent disk** mounted at `/var/data` and set `DATA_DIR=/var/data`. Without a disk, orders and accounts are lost each time Render restarts.

## API summary

| Method | Route | Who |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Anyone |
| GET | `/api/auth/me`, `/api/books`, `/api/books/:id`, `/api/coupons` | Anyone |
| POST | `/api/books/:id/notify`, `/api/newsletter` | Anyone |
| POST | `/api/books/:id/reviews`, `/api/reviews/:id/helpful` | Signed in |
| GET, POST | `/api/orders`, `/api/orders/:id/cancel` | Signed in |
| PATCH, PUT, DELETE | `/api/me`, `/api/me/wishlist`, `/api/me/read`, `/api/me/goal`, `/api/me/addresses/:i` | Signed in |
| GET, PATCH, POST, DELETE | `/api/admin/stats`, `/api/admin/orders`, `/api/admin/users`, `/api/admin/books` | Admin |
