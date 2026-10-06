const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Secure admin token: Uses Render Environment Variable or falls back to 'tavisqala'
const ADMIN_SECRET = process.env.ADMIN_SECRET || "tavisqala";

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
    return res.status(401).json({ error: "Unauthorized: Invalid admin token." });
  }
  next();
}

// ---------------------------------------------------------
// NEW: Public / User Authentication & Data Routes
// ---------------------------------------------------------

// User Sign-In route: matches existing accounts without losing data
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required." });
  }

  const db = readDB();
  const account = db.accounts[username];

  // Check if account exists and password matches
  if (!account || account.password !== password) {
    return res.status(401).json({ error: "Invalid username or password." });
  }

  // Return safe account data (excluding sensitive internal fields if needed)
  res.json({ 
    success: true, 
    username: username,
    balance: account.balance || 0,
    // Include any other user properties needed by index.html
  });
});

// Safe public route for checking account existence or basic stats if needed
app.get("/api/public-stats", (req, res) => {
  const db = readDB();
  const accountCount = Object.keys(db.accounts).length;
  res.json({ totalAccounts: accountCount });
});

// ---------------------------------------------------------
// Existing Admin Routes
// ---------------------------------------------------------

// Read the whole database with valid admin token
app.get("/api/db", verifyAdminToken, (req, res) => {
  res.json(readDB());
});

// Replace the whole accounts database safely
app.put("/api/db", verifyAdminToken, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || !body.accounts || typeof body.accounts !== "object") {
    return res.status(400).json({ error: "Invalid payload: expected { accounts: {...} }" });
  }

  writeDB(body);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Aster Vault server running on port ${PORT}`);
  console.log(`Data file: ${DB_FILE}`);
});
