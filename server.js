const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// Admin token: set ADMIN_SECRET in Render's Environment tab (falls back to the old value)
const ADMIN_SECRET = process.env.ADMIN_SECRET || "tavisqala";
// Key used to sign user session tokens (derived from the admin secret, never sent to clients)
const SESSION_KEY = crypto.createHash("sha256").update("session-key:" + ADMIN_SECRET).digest();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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

/* ---------------- static files (whitelist only) ----------------
   Previously express.static(__dirname) exposed server.js and data/db.json
   to anyone. Now only the pages and logo are public. */
const PUBLIC_FILES = new Set(["index.html", "alexmartin3316.html", "logo.png"]);
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/:file", (req, res, next) => {
  if (!PUBLIC_FILES.has(req.params.file)) return next();
  res.sendFile(path.join(__dirname, req.params.file));
});

/* ---------------- admin API (unchanged behaviour) ---------------- */
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifyAdminToken(req, res, next) {
  if (!safeEqual(req.headers["x-admin-token"], ADMIN_SECRET)) {
    console.warn(`[SECURITY WARNING] Blocked unauthorized request from IP: ${req.ip}`);
    return res.status(401).json({ error: "Unauthorized: Invalid admin token." });
  }
  next();
}

app.get("/api/db", verifyAdminToken, (req, res) => {
  res.json(readDB());
});

app.put("/api/db", verifyAdminToken, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || !body.accounts || typeof body.accounts !== "object") {
    return res.status(400).json({ error: "Invalid payload: expected { accounts: {...} }" });
  }
  writeDB(body);
  res.json({ ok: true });
});

/* ---------------- user API (used by index.html) ----------------
   Users never see the whole database: they can only register, log in,
   and read/update their own account. */
const hmac = (s) => crypto.createHmac("sha256", SESSION_KEY).update(s).digest("hex");
const isHex = (s, min, max) => typeof s === "string" && new RegExp(`^[0-9a-f]{${min},${max}}$`).test(s);
const toAccountId = (email) =>
  (email || "guest").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "guest";

function signToken(id) {
  const body = `${id}.${Date.now() + SESSION_TTL_MS}`;
  return `${body}.${hmac(body)}`;
}

function publicAccount(a) {
  const { passwordHash, passwordSalt, ...rest } = a;
  return rest;
}

function requireUser(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  const parts = m ? m[1].split(".") : [];
  if (parts.length !== 3) return res.status(401).json({ error: "Not signed in." });
  const [id, exp, sig] = parts;
  if (!safeEqual(sig, hmac(`${id}.${exp}`)) || Number(exp) < Date.now()) {
    return res.status(401).json({ error: "Session expired." });
  }
  const db = readDB();
  if (!db.accounts[id]) return res.status(401).json({ error: "Account not found." });
  req.userId = id;
  req.db = db;
  next();
}

// Simple brute-force limiter for login attempts
const attempts = new Map();
function tooMany(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 10;
}
function noteAttempt(key) {
  attempts.set(key, [...(attempts.get(key) || []), Date.now()]);
}

// The client needs the salt to hash the password before logging in.
app.get("/api/salt", (req, res) => {
  const id = toAccountId(String(req.query.id || ""));
  const acct = readDB().accounts[id];
  // Unknown ids get a stable fake salt so this can't be used to list accounts.
  res.json({ salt: acct && acct.passwordSalt ? acct.passwordSalt : hmac("fake-salt:" + id).slice(0, 32), exists: !!acct });
});

app.post("/api/register", (req, res) => {
  const { email, name, passwordHash, passwordSalt, refCode, account } = req.body || {};
  const id = toAccountId(email);
  if (!email || String(email).trim().length < 4 || !name || !isHex(passwordHash, 64, 64) || !isHex(passwordSalt, 8, 64)) {
    return res.status(400).json({ error: "Invalid registration data." });
  }
  const db = readDB();
  if (db.accounts[id]) return res.status(409).json({ error: "An account with this email already exists. Log in instead." });

  const a = account && typeof account === "object" ? account : {};
  const cleanName = String(name).trim().slice(0, 80);
  const newAcct = {
    name: cleanName,
    email: String(email).trim().slice(0, 120),
    assets: { btc: 0, eth: 0, usdc: 0 }, // new accounts always start empty; only the admin credits balances
    addresses: a.addresses && typeof a.addresses === "object" ? a.addresses : {},
    qrImages: a.qrImages && typeof a.qrImages === "object" ? a.qrImages : {},
    referralCode: typeof a.referralCode === "string" ? a.referralCode.slice(0, 12) : "",
    referrals: [],
    activity: [],
    lastStreakAt: null,
    passwordHash,
    passwordSalt,
    createdAt: Date.now(),
  };
  const code = String(refCode || "").trim().toUpperCase();
  if (code) {
    const referrer = Object.values(db.accounts).find((x) => x.referralCode === code);
    if (referrer) {
      referrer.referrals = referrer.referrals || [];
      referrer.referrals.push({ name: cleanName, ts: Date.now() });
      newAcct.referredBy = { name: referrer.name, code };
    }
  }
  db.accounts[id] = newAcct;
  writeDB(db);
  res.json({ id, token: signToken(id), account: publicAccount(newAcct) });
});

app.post("/api/login", (req, res) => {
  const { email, passwordHash } = req.body || {};
  const id = toAccountId(email);
  const key = `${req.ip}|${id}`;
  if (tooMany(key)) return res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
  const acct = readDB().accounts[id];
  if (!acct) {
    noteAttempt(key);
    return res.status(404).json({ error: "No account found for that email. Create one instead." });
  }
  if (!acct.passwordHash) return res.status(400).json({ error: "This account can't sign in this way. Contact support." });
  if (!safeEqual(passwordHash, acct.passwordHash)) {
    noteAttempt(key);
    return res.status(401).json({ error: "Incorrect password." });
  }
  res.json({ id, token: signToken(id), account: publicAccount(acct) });
});

app.get("/api/me", requireUser, (req, res) => {
  res.json({ id: req.userId, account: publicAccount(req.db.accounts[req.userId]) });
});

// A user may only update their own activity log, streak timer, referral code,
// and LOWER their balances (sending funds). Raising balances is admin-only.
app.put("/api/me", requireUser, (req, res) => {
  const acct = req.db.accounts[req.userId];
  const b = req.body || {};
  if (Array.isArray(b.activity)) acct.activity = b.activity.slice(0, 50);
  if (b.lastStreakAt === null || typeof b.lastStreakAt === "number") acct.lastStreakAt = b.lastStreakAt;
  if (!acct.referralCode && typeof b.referralCode === "string") acct.referralCode = b.referralCode.slice(0, 12);
  if (b.assets && typeof b.assets === "object") {
    acct.assets = acct.assets || {};
    for (const k of Object.keys(acct.assets)) {
      const v = b.assets[k];
      if (typeof v === "number" && v >= 0 && v <= acct.assets[k]) acct.assets[k] = v;
    }
  }
  writeDB(req.db);
  res.json({ ok: true, account: publicAccount(acct) });
});

app.listen(PORT, () => {
  console.log(`Aster Vault server running on port ${PORT}`);
  console.log(`Data file: ${DB_FILE}`);
});
