'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { solve } = require('../shared/solver');

const { n, maxIter, tol, seed, omega, maxSeconds } = workerData;
let cancelled = false;

parentPort.on('message', (msg) => {
  if (msg && msg.type === 'cancel') cancelled = true;
});

try {
  const result = solve({
    n, maxIter, tol, seed, omega,
    deadline: Date.now() + maxSeconds * 1000,
    shouldStop: () => cancelled,
    onProgress: (p) => parentPort.postMessage({ type: 'progress', ...p })
  });
  parentPort.postMessage({ type: 'done', result });
} catch (err) {
  parentPort.postMessage({ type: 'error', error: String(err && err.message || err) });
}
