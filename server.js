const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

function seedAccounts() {
  return {}; // real deployments start empty — only accounts people actually register with will exist
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
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(express.json({ limit: "10mb" }));
app.use(express.static(__dirname));

// Read the whole accounts database
app.get("/api/db", (req, res) => {
  res.json(readDB());
});

// Replace the whole accounts database (the client sends the full object
// after mutating it in memory — simplest possible contract, mirrors how
// the old localStorage version worked, just persisted server-side now).
app.put("/api/db", (req, res) => {
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
