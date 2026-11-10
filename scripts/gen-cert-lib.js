'use strict';

const fs = require('node:fs');
const path = require('node:path');
const selfsigned = require('selfsigned');
const { CERT_DIR } = require('../src/config');

function generate() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' }
          ]
        }
      ]
    }
  );
  fs.writeFileSync(path.join(CERT_DIR, 'key.pem'), pems.private);
  fs.writeFileSync(path.join(CERT_DIR, 'cert.pem'), pems.cert);
  return pems;
}

module.exports = { generate };

if (require.main === module) {
  generate();
  console.log('Сертифікат створено у', CERT_DIR);
}
