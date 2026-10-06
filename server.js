const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Secure admin token: Must be set in Render Environment Variables
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  console.error("[FATAL ERROR] ADMIN_SECRET environment variable is missing!");
  process.exit(1);
}

function seedAccounts() {
  return {}; 
}

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ accounts: seedAccounts() }, null, 2));
  }
}
ensureDB();

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (e) {
    return { accounts: seedAccounts() };
  }
}

function writeDB(db) {
  const tempFile = DB_FILE + ".tmp";
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), "utf8");
  fs.renameSync(tempFile, DB_FILE);
}

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// Middleware to verify secret admin token
function verifyAdminToken(req, res, next) {
  const clientToken = req.headers["x-admin-token"];
  if (!clientToken || clientToken !== ADMIN_SECRET) {
    console.warn(`[SECURITY WARNING] Blocked unauthorized request from IP: ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized: Missing or invalid admin token." });
  }
  next();
}

// LOCKED DOWN: Read the whole database only with valid admin token
app.get("/api/db", verifyAdminToken, (req, res) => {
  res.json(readDB());
});

// Replace the whole accounts database with token protection and safety checks
app.put("/api/db", verifyAdminToken, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || !body.accounts || typeof body.accounts !== "object") {
    return res.status(400).json({ error: "Invalid payload: expected { accounts: {...} }" });
  }

  const currentDB = readDB();
  const currentAccountCount = Object.keys(currentDB.accounts || {}).length;
  const incomingAccountCount = Object.keys(body.accounts || {}).length;

  if (currentAccountCount > 0 && incomingAccountCount === 0) {
    console.warn("[SECURITY WARNING] Blocked an attempt to overwrite active accounts with an empty database!");
    return res.status(400).json({ error: "Safety block: Cannot overwrite existing accounts with an empty dataset." });
  }

  writeDB(body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Aster Vault server running on port ${PORT}`);
  console.log(`Data file: ${DB_FILE}`);
});
