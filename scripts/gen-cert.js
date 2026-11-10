'use strict';

const { generate } = require('./gen-cert-lib');
generate();
console.log('Сертифікат створено у certs/ (key.pem, cert.pem)');
