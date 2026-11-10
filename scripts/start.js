'use strict';

/**
 * Єдина команда запуску: npm start
 * 1) генерує TLS-сертифікат (якщо немає)
 * 2) створює облікові записи за замовчуванням
 * 3) піднімає балансувальник + мінімум 2 сервери застосунків
 */

const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { CERT_DIR } = require('../src/config');
const { db } = require('../src/db');

if (!fs.existsSync(path.join(CERT_DIR, 'cert.pem'))) {
  require('./gen-cert-lib').generate();
  console.log('[setup] TLS-сертифікат згенеровано (certs/)');
}

async function seed() {
  const accounts = [
    { email: 'admin@local', password: 'admin123', role: 'admin' },
    { email: 'user@local', password: 'user123', role: 'user' }
  ];
  for (const acc of accounts) {
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(acc.email);
    if (!exists) {
      const hash = await bcrypt.hash(acc.password, 10);
      db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)')
        .run(acc.email, hash, acc.role);
      console.log(`[setup] створено ${acc.role}: ${acc.email} / ${acc.password}`);
    }
  }
}

seed().then(() => {
  require('../src/lb');
});
