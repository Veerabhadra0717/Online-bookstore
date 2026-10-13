// A tiny JSON-file database. Data lives in data/db.json and is written
// safely (to a temp file first, then renamed) after every change.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const buildSeed = require("./seed");

const DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DIR, "db.json");
let data = null;

function load() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } else {
    data = buildSeed();
    save();
    console.log("Created a new database with sample books at", FILE);
  }
}

function save() {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

// A secret for signing login tokens, created once and kept in the data folder.
function secret() {
  const f = path.join(DIR, "secret.key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString("hex"));
  return fs.readFileSync(f, "utf8").trim();
}

module.exports = { load, save, secret, get data() { return data; }, DIR, FILE };
