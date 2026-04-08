const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readTable(name) {
  const filePath = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(filePath)) {
    writeTable(name, []);
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

function writeTable(name, data) {
  const filePath = path.join(DATA_DIR, name + '.json');
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function nextId(table) {
  const rows = readTable(table);
  return rows.length === 0 ? 1 : Math.max(...rows.map(r => r.id)) + 1;
}

function hashPassword(plain) {
  return crypto.createHash('sha256').update(plain).digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ── Seed data (only on first run) ─────────────────────────────────
function seed() {
  if (fs.existsSync(path.join(DATA_DIR, 'seeded'))) return;

  const users = [
    { id: 1, name: 'James', email: 'jm@x.se', password: hashPassword('jm1'), role: 'manager', gender: 'man', last_login: null },
    { id: 2, name: 'Sara', email: 'sa@x.se', password: hashPassword('sa1'), role: 'worker', gender: 'women', last_login: null },
    { id: 3, name: 'Erik', email: 'er@x.se', password: hashPassword('er1'), role: 'worker', gender: 'man', last_login: null },
    { id: 4, name: 'Linda', email: 'li@x.se', password: hashPassword('li1'), role: 'worker', gender: 'women', last_login: null },
  ];

  writeTable('users', users);
  writeTable('assignments', []);
  writeTable('notes', []);
  writeTable('sessions', []);
  writeTable('login_logs', []);
  fs.writeFileSync(path.join(DATA_DIR, 'seeded'), 'true');
}

seed();

module.exports = {
  readTable,
  writeTable,
  nextId,
  hashPassword,
  generateToken,
  DATA_DIR,
};
