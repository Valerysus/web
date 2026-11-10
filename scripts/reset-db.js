'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('../src/config');

for (const f of ['app.db', 'app.db-wal', 'app.db-shm']) {
  const p = path.join(DATA_DIR, f);
  if (fs.existsSync(p)) { fs.unlinkSync(p); console.log('видалено', f); }
}
console.log('Базу даних скинуто.');
