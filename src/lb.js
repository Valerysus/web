'use strict';

/**
 * Балансувальник навантаження (load balancer) — єдина точка входу.
 *  - HTTPS (TLS) для клієнтів
 *  - WSS (WebSocket over TLS) для інформування про прогрес
 *  - REST API: авторизація, задачі, історія, скасування
 *  - черга задач + оцінка часу очікування
 *  - автомасштабування пулу серверів застосунків
 *  - панель адміністратора
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

const {
  CERT_DIR, PUBLIC_DIR, LB_PORT, LB_HOST, INTERNAL_PORT, INTERNAL_SECRET,
  LIMITS, MAX_ACTIVE_JOBS_PER_USER, MAX_HISTORY_JOBS_PER_USER,
  JWT_SECRET, JWT_TTL, SCHEDULER_TICK_MS, MIN_WORKERS, MAX_WORKERS, WORKER_CAPACITY
} = require('./config');
const { db, logEvent, logWorker } = require('./db');
const { WorkerPool } = require('./pool');

const pool = new WorkerPool();
const startedAt = Date.now();

/* ------------------------------------------------------------------ TLS */

function loadCertificates() {
  const keyPath = path.join(CERT_DIR, 'key.pem');
  const certPath = path.join(CERT_DIR, 'cert.pem');
  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.log('[lb] сертифікатів немає — генерую самопідписаний...');
    require('../scripts/gen-cert-lib').generate();
  }
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

/* --------------------------------------------------------------- helpers */

const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function jobRow(id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function jobDto(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    n: row.n,
    maxIter: row.max_iter,
    tol: row.tol,
    progress: row.progress,
    stage: row.stage,
    iterations: row.iterations,
    residual: row.residual,
    workerId: row.worker_id,
    error: row.error,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result_json ? JSON.parse(row.result_json) : null
  };
}

/** Оцінка середньої тривалості задачі за історією (сек) */
function averageDuration() {
  const row = db.prepare(`
    SELECT AVG((julianday(finished_at) - julianday(started_at)) * 86400.0) AS avg
    FROM jobs WHERE status = 'done' AND started_at IS NOT NULL AND finished_at IS NOT NULL
  `).get();
  return row && row.avg ? Math.max(1, row.avg) : 8;
}

function queueSnapshot() {
  const queued = db.prepare(
    "SELECT id, user_id, created_at FROM jobs WHERE status = 'queued' ORDER BY created_at ASC"
  ).all();
  const avg = averageDuration();
  const capacity = Math.max(1, pool.totalCapacity);
  const perSlot = avg / capacity;

  return queued.map((j, i) => ({
    id: j.id,
    position: i + 1,
    etaSeconds: Math.max(1, Math.round((i + 1) * perSlot))
  }));
}

function queueEntry(jobId) {
  return queueSnapshot().find((s) => s.id === jobId) || null;
}

/* ------------------------------------------------------------ validation */

function validateJobInput(body) {
  const errors = [];
  const n = Number(body.n);
  const maxIter = Number(body.maxIter);
  const tol = Number(body.tol);
  const omega = body.omega === undefined ? 1 : Number(body.omega);

  if (!Number.isInteger(n) || n < 2) errors.push('Кількість невідомих має бути цілим числом ≥ 2');
  if (n > LIMITS.maxUnknowns) errors.push(`Перевищено ліміт невідомих: максимум ${LIMITS.maxUnknowns}`);
  if (!Number.isInteger(maxIter) || maxIter < 1) errors.push('Кількість ітерацій має бути цілим числом ≥ 1');
  if (maxIter > LIMITS.maxIterations) errors.push(`Перевищено ліміт ітерацій: максимум ${LIMITS.maxIterations}`);
  if (!Number.isFinite(tol) || tol < LIMITS.minTolerance || tol > LIMITS.maxTolerance) {
    errors.push(`Точність має бути в межах ${LIMITS.minTolerance} … ${LIMITS.maxTolerance}`);
  }
  if (!Number.isFinite(omega) || omega <= 0 || omega >= 2) errors.push('Параметр релаксації ω має бути в межах (0; 2)');

  const workUnits = (Number.isFinite(n) ? n : 0) * (Number.isFinite(maxIter) ? maxIter : 0);
  if (workUnits > LIMITS.maxWorkUnits) {
    errors.push(
      `Трудомісткість задачі (${workUnits.toLocaleString('uk-UA')} операцій) перевищує бюджет ` +
      `${LIMITS.maxWorkUnits.toLocaleString('uk-UA')}. Зменште n або кількість ітерацій.`
    );
  }

  return { errors, value: { n, maxIter, tol, omega, workUnits } };
}

/* ---------------------------------------------------------------- express */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss:"
  );
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

/** Express 4 не перехоплює відхилені проміси — обгортаємо async-обробники. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Потрібна авторизація' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Сесія недійсна або прострочена' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Доступ лише для адміністратора' });
  next();
}

/* ------------------------------------------------------------------- auth */

app.post('/api/auth/register', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Некоректний email' });
  if (password.length < 6) return res.status(400).json({ error: 'Пароль має містити щонайменше 6 символів' });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (exists) return res.status(409).json({ error: 'Користувач з таким email вже існує' });

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  const user = { id: Number(info.lastInsertRowid), email, role: 'user' };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_TTL });
  res.status(201).json({ token, user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    return res.status(401).json({ error: 'Невірний email або пароль' });
  }
  const user = { id: row.id, email: row.email, role: row.role };
  const token = jwt.sign(user, JWT_SECRET, { expiresIn: JWT_TTL });
  res.json({ token, user });
}));

app.get('/api/auth/me', auth, (req, res) => res.json({ user: req.user }));

/* ------------------------------------------------------------------- jobs */

app.get('/api/limits', (req, res) => {
  res.json({
    limits: LIMITS,
    maxActiveJobs: MAX_ACTIVE_JOBS_PER_USER,
    maxHistoryJobs: MAX_HISTORY_JOBS_PER_USER,
    servers: { min: MIN_WORKERS, max: MAX_WORKERS, capacity: WORKER_CAPACITY }
  });
});

app.post('/api/jobs', auth, (req, res) => {
  const { errors, value } = validateJobInput(req.body);
  if (errors.length) return res.status(422).json({ error: errors[0], errors });

  const active = db.prepare(
    "SELECT COUNT(*) AS c FROM jobs WHERE user_id = ? AND status IN ('queued','running')"
  ).get(req.user.id).c;
  if (active >= MAX_ACTIVE_JOBS_PER_USER) {
    return res.status(429).json({
      error: `Досягнуто ліміт одночасних задач (${MAX_ACTIVE_JOBS_PER_USER}). Дочекайтесь завершення або скасуйте задачу.`
    });
  }

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO jobs (id, user_id, status, n, max_iter, tol, stage)
    VALUES (?, ?, 'queued', ?, ?, ?, 'у черзі')
  `).run(id, req.user.id, value.n, value.maxIter, value.tol);

  db.prepare('UPDATE jobs SET result_json = ? WHERE id = ?')
    .run(JSON.stringify({ omega: value.omega, workUnits: value.workUnits }), id);

  logEvent(id, `Задачу створено: n=${value.n}, ітерацій=${value.maxIter}, точність=${value.tol}`);

  // Обрізаємо історію користувача
  const extra = db.prepare(`
    SELECT id FROM jobs WHERE user_id = ? AND status IN ('done','failed','cancelled')
    ORDER BY created_at DESC LIMIT -1 OFFSET ?
  `).all(req.user.id, MAX_HISTORY_JOBS_PER_USER);
  for (const row of extra) db.prepare('DELETE FROM jobs WHERE id = ?').run(row.id);

  const entry = queueEntry(id);
  res.status(201).json({
    job: jobDto(jobRow(id)),
    queue: entry
      ? { position: entry.position, etaSeconds: entry.etaSeconds }
      : { position: 0, etaSeconds: 0 }
  });
});

app.get('/api/jobs', auth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
  ).all(req.user.id);
  const snap = queueSnapshot();
  res.json({
    jobs: rows.map((r) => {
      const dto = jobDto(r);
      const q = snap.find((s) => s.id === r.id);
      if (q) { dto.queuePosition = q.position; dto.etaSeconds = q.etaSeconds; }
      return dto;
    })
  });
});

app.get('/api/jobs/:id', auth, (req, res) => {
  const row = jobRow(req.params.id);
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Задачу не знайдено' });
  const events = db.prepare('SELECT * FROM job_events WHERE job_id = ? ORDER BY id').all(row.id);
  res.json({ job: jobDto(row), events });
});

app.post('/api/jobs/:id/cancel', auth, wrap(async (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row || row.user_id !== req.user.id) return res.status(404).json({ error: 'Задачу не знайдено' });
  if (!['queued', 'running'].includes(row.status)) {
    return res.status(409).json({ error: 'Задача вже завершена' });
  }

  db.prepare('UPDATE jobs SET cancel_flag = 1 WHERE id = ?').run(row.id);
  if (row.status === 'running') await pool.cancel(row.id);

  db.prepare(`
    UPDATE jobs SET status = 'cancelled', stage = 'скасовано користувачем',
      finished_at = datetime('now') WHERE id = ?
  `).run(row.id);
  logEvent(row.id, 'Задачу скасовано користувачем');
  broadcastJob(jobDto(jobRow(row.id)));
  res.json({ ok: true });
}));

/* ---------------------------------------------------------------- admin */

app.get('/api/admin/overview', auth, adminOnly, (req, res) => {
  const counts = db.prepare(`
    SELECT status, COUNT(*) AS c FROM jobs GROUP BY status
  `).all();
  const byStatus = Object.fromEntries(counts.map((r) => [r.status, r.c]));
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

  res.json({
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    users,
    jobs: {
      queued: byStatus.queued || 0,
      running: byStatus.running || 0,
      done: byStatus.done || 0,
      failed: byStatus.failed || 0,
      cancelled: byStatus.cancelled || 0
    },
    pool: {
      size: pool.size,
      min: MIN_WORKERS,
      max: MAX_WORKERS,
      capacity: pool.totalCapacity,
      active: pool.activeCount,
      loadPercent: pool.totalCapacity ? Math.round((pool.activeCount / pool.totalCapacity) * 100) : 0,
      servers: pool.list()
    },
    queue: queueSnapshot(),
    averageDurationSec: Math.round(averageDuration())
  });
});

app.get('/api/admin/jobs', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT j.*, u.email FROM jobs j JOIN users u ON u.id = j.user_id
    ORDER BY j.created_at DESC LIMIT 200
  `).all();
  res.json({ jobs: rows.map((r) => ({ ...jobDto(r), email: r.email })) });
});

app.get('/api/admin/log', auth, adminOnly, (req, res) => {
  res.json({
    workers: db.prepare('SELECT * FROM worker_log ORDER BY id DESC LIMIT 100').all(),
    events: db.prepare(`
      SELECT e.*, j.n FROM job_events e JOIN jobs j ON j.id = e.job_id
      ORDER BY e.id DESC LIMIT 100
    `).all()
  });
});

app.post('/api/admin/scale', auth, adminOnly, wrap(async (req, res) => {
  const action = req.body.action;
  if (action === 'up') {
    if (pool.size >= MAX_WORKERS) return res.status(409).json({ error: `Максимум серверів: ${MAX_WORKERS}` });
    await pool.startWorker();
  } else if (action === 'down') {
    if (pool.size <= MIN_WORKERS) return res.status(409).json({ error: `Мінімум серверів: ${MIN_WORKERS}` });
    const servers = pool.list();
    const target = servers.filter((s) => s.active === 0).pop() || servers[servers.length - 1];
    await pool.stopWorker(target.id);
  } else {
    return res.status(400).json({ error: 'action має бути up або down' });
  }
  pool.holdAutoscale(60_000);
  res.json({ ok: true, size: pool.size });
}));

/* ------------------------------------------------------- internal channel */

const internal = http.createServer((req, res) => {
  if (req.headers['x-internal-secret'] !== INTERNAL_SECRET) {
    res.writeHead(403); return res.end();
  }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { /* ignore */ }
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/internal/progress') {
      const row = jobRow(body.jobId);
      if (row && row.status === 'running') {
        db.prepare(`
          UPDATE jobs SET progress = ?, stage = ?, iterations = ?, residual = ? WHERE id = ?
        `).run(body.progress ?? row.progress, body.stage ?? row.stage,
               body.iterations ?? row.iterations, body.residual ?? row.residual, body.jobId);
        broadcastJob(jobDto(jobRow(body.jobId)));
      }
    } else if (url.pathname === '/internal/complete') {
      const row = jobRow(body.jobId);
      if (row) {
        const result = body.result || {};
        const cancelled = row.cancel_flag === 1 || result.stopped === 'cancelled';
        const status = cancelled ? 'cancelled' : (result.stopped === 'timeout' ? 'failed' : 'done');
        db.prepare(`
          UPDATE jobs SET status = ?, progress = ?, stage = ?, iterations = ?, residual = ?,
            result_json = ?, error = ?, finished_at = datetime('now') WHERE id = ?
        `).run(
          status,
          cancelled ? row.progress : 100,
          cancelled ? 'скасовано' : (status === 'done' ? 'завершено' : 'перевищено ліміт часу'),
          result.iterations ?? row.iterations,
          result.residual ?? row.residual,
          JSON.stringify(result),
          status === 'failed' ? 'Перевищено ліміт часу виконання' : null,
          body.jobId
        );
        logEvent(body.jobId, status === 'done'
          ? `Завершено: ітерацій ${result.iterations}, норма ${Number(result.solutionNorm).toFixed(4)}`
          : `Задача завершилась зі статусом ${status}`);
        pool.release(body.jobId);
        broadcastJob(jobDto(jobRow(body.jobId)));
      }
    } else if (url.pathname === '/internal/fail') {
      db.prepare(`
        UPDATE jobs SET status = 'failed', stage = 'помилка', error = ?,
          finished_at = datetime('now') WHERE id = ?
      `).run(String(body.error || 'Невідома помилка'), body.jobId);
      logEvent(body.jobId, `Помилка: ${body.error}`);
      pool.release(body.jobId);
      broadcastJob(jobDto(jobRow(body.jobId)));
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});

/* ------------------------------------------------------- error handling */

// Має бути після всіх маршрутів: жоден збій не повинен валити процес
app.use((err, req, res, next) => {
  console.error('[lb] помилка запиту:', err && err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

process.on('unhandledRejection', (err) => {
  console.error('[lb] необроблена відмова промісу:', err && err.message);
});

/* ------------------------------------------------------------- scheduler */
let ticking = false;

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    // 1. Задачі, що "зависли" на зниклих серверах — повертаємо в чергу
    const running = db.prepare("SELECT * FROM jobs WHERE status = 'running'").all();
    const alive = new Set(pool.list().map((s) => s.id));
    for (const job of running) {
      if (job.worker_id && !alive.has(job.worker_id)) {
        db.prepare(`
          UPDATE jobs SET status = 'queued', progress = 0, stage = 'перепризначено',
            worker_id = NULL, started_at = NULL WHERE id = ?
        `).run(job.id);
        logEvent(job.id, 'Сервер застосунку зник — задачу повернено в чергу');
      }
    }

    // 2. Роздача задач із черги
    const queued = db.prepare(
      "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC"
    ).all();

    for (const job of queued) {
      const worker = pool.pick();
      if (!worker) break;
      const meta = job.result_json ? JSON.parse(job.result_json) : {};
      const dispatched = await pool.dispatch({
        id: job.id, n: job.n, maxIter: job.max_iter, tol: job.tol,
        seed: 1, omega: meta.omega ?? 1
      });
      if (dispatched) {
        db.prepare(`
          UPDATE jobs SET status = 'running', worker_id = ?, started_at = datetime('now'),
            stage = 'виконується', progress = 1 WHERE id = ?
        `).run(dispatched.id, job.id);
        logEvent(job.id, `Задачу передано на сервер ${dispatched.id}`);
        broadcastJob(jobDto(jobRow(job.id)));
      }
    }

    // 3. Автомасштабування
    const remaining = db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE status = 'queued'").get().c;
    await pool.autoscale(remaining);

    // 4. Періодичне оновлення черги для клієнтів (без ідентифікаторів чужих задач)
    const snapshot = queueSnapshot();
    broadcast({
      type: 'queue',
      queue: {
        length: snapshot.length,
        nextEtaSeconds: snapshot.length ? snapshot[0].etaSeconds : 0
      },
      pool: { size: pool.size, active: pool.activeCount, capacity: pool.totalCapacity }
    });
  } catch (err) {
    console.error('[scheduler]', err);
  } finally {
    ticking = false;
  }
}

/* ------------------------------------------------------------- websocket */

const wss = new WebSocketServer({ noServer: true });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

/** Подія про задачу — лише власнику задачі та адміністраторам. */
function broadcastJob(job) {
  if (!job) return;
  const data = JSON.stringify({ type: 'job', job });
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const user = client.user;
    if (!user) continue;
    if (user.role === 'admin' || user.id === job.userId) client.send(data);
  }
}

/* ------------------------------------------------------------------ boot */

async function main() {
  const tls = loadCertificates();
  const server = https.createServer(tls, app);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'https://localhost');
    if (url.pathname !== '/ws') return socket.destroy();
    const token = url.searchParams.get('token');
    let user;
    try { user = jwt.verify(token, JWT_SECRET); } catch { return socket.destroy(); }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'hello', user: ws.user, pool: { size: pool.size } }));
    ws.on('error', () => { /* ignore */ });
  });

  internal.listen(INTERNAL_PORT, '127.0.0.1');

  await pool.ensureMinimum();

  server.listen(LB_PORT, LB_HOST, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════════╗');
    console.log('  ║  Розподілена система обчислень — запущено                ║');
    console.log('  ╚══════════════════════════════════════════════════════════╝');
    console.log(`  HTTPS : https://localhost:${LB_PORT}`);
    console.log(`  WSS   : wss://localhost:${LB_PORT}/ws`);
    console.log(`  Серверів застосунків: ${pool.size} (мін ${MIN_WORKERS}, макс ${MAX_WORKERS})`);
    console.log('  Увага: сертифікат самопідписаний — браузер попросить підтвердити.');
    console.log('');
  });

  setInterval(tick, SCHEDULER_TICK_MS);
  tick();

  const shutdown = async () => {
    console.log('\n[lb] зупинка...');
    await pool.shutdownAll();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[lb] критична помилка:', err);
  process.exit(1);
});
