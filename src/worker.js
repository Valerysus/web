'use strict';

/**
 * Сервер застосунку (application server).
 * Отримує задачу від балансувальника, виконує її у окремому робочому потоці
 * (worker_threads) і надсилає прогрес назад у балансувальник.
 */

const http = require('node:http');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { LIMITS, INTERNAL_SECRET } = require('./config');

const WORKER_ID = process.env.WORKER_ID || `app-${process.env.PORT}`;
const PORT = Number(process.env.PORT);
const LB_INTERNAL = process.env.LB_INTERNAL || 'http://127.0.0.1:8444';

const active = new Map(); // jobId -> { thread, cancelled }

function post(pathname, body) {
  return new Promise((resolve) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request(
      `${LB_INTERNAL}${pathname}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
          'x-internal-secret': INTERNAL_SECRET
        }
      },
      (res) => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', () => resolve());
    req.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 8 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  const data = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': data.length });
  res.end(data);
}

function startJob(job) {
  const { id, n, maxIter, tol, seed, omega } = job;
  if (active.has(job.id)) return;

  const thread = new Worker(path.join(__dirname, 'compute-thread.js'), {
    workerData: { n, maxIter, tol, seed, omega, maxSeconds: LIMITS.maxSeconds }
  });

  const entry = { thread, cancelled: false };
  active.set(id, entry);

  let lastSent = 0;
  thread.on('message', (msg) => {
    if (msg.type === 'progress') {
      const now = Date.now();
      if (now - lastSent < 250 && msg.progress < 100) return;
      lastSent = now;
      post('/internal/progress', { jobId: id, workerId: WORKER_ID, ...msg });
    } else if (msg.type === 'done') {
      post('/internal/complete', { jobId: id, workerId: WORKER_ID, result: msg.result });
    } else if (msg.type === 'error') {
      post('/internal/fail', { jobId: id, workerId: WORKER_ID, error: msg.error });
    }
  });

  thread.on('error', (err) => {
    post('/internal/fail', { jobId: id, workerId: WORKER_ID, error: String(err && err.message) });
  });

  thread.on('exit', () => { active.delete(id); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    return json(res, 200, {
      workerId: WORKER_ID,
      port: PORT,
      active: active.size,
      capacity: Number(process.env.CAPACITY || 2),
      uptime: process.uptime()
    });
  }

  if (req.method === 'POST' && req.headers['x-internal-token'] !== 'worker') {
    return json(res, 403, { error: 'forbidden' });
  }

  if (url.pathname === '/run') {
    const job = await readBody(req);
    if (!job.id) return json(res, 400, { error: 'job id required' });
    startJob(job);
    return json(res, 202, { accepted: true, workerId: WORKER_ID });
  }

  if (url.pathname === '/cancel') {
    const { id } = await readBody(req);
    const entry = active.get(id);
    if (entry) {
      entry.cancelled = true;
      entry.thread.postMessage({ type: 'cancel' });
      setTimeout(() => { if (active.has(id)) entry.thread.terminate(); }, 3000);
    }
    return json(res, 200, { cancelled: Boolean(entry) });
  }

  if (url.pathname === '/shutdown') {
    for (const [, e] of active) e.thread.terminate();
    json(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 100);
    return;
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[${WORKER_ID}] application server слухає 127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
