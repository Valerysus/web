'use strict';

/**
 * Перевірка ізоляції задач між користувачами:
 *  - користувач A створює задачу;
 *  - користувач B не отримує її у своєму списку;
 *  - WebSocket користувача B не отримує подій про задачу A;
 *  - адміністратор отримує події про задачі всіх користувачів.
 *
 * Запуск: node scripts/test-isolation.js (система має бути запущена)
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const WebSocket = require('ws');

const BASE = process.env.BASE_URL || 'https://localhost:8443';
const WS = BASE.replace('https', 'wss');

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function collect(token, ms) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS}/ws?token=${encodeURIComponent(token)}`);
    const messages = [];
    ws.on('message', (raw) => {
      try { messages.push(JSON.parse(raw)); } catch { /* ignore */ }
    });
    ws.on('error', () => { /* ignore */ });
    setTimeout(() => { ws.close(); resolve(messages); }, ms);
  });
}

async function main() {
  console.log(`Перевірка ізоляції задач: ${BASE}\n`);

  const userA = (await api('/api/auth/login', {
    method: 'POST', body: { email: 'user@local', password: 'user123' }
  })).data.token;

  const emailB = `iso-${Date.now()}@example.com`;
  const userB = (await api('/api/auth/register', {
    method: 'POST', body: { email: emailB, password: 'secret123' }
  })).data.token;

  const admin = (await api('/api/auth/login', {
    method: 'POST', body: { email: 'admin@local', password: 'admin123' }
  })).data.token;

  check('отримано три токени', Boolean(userA && userB && admin));

  const wsB = collect(userB, 6000);
  const wsAdmin = collect(admin, 6000);
  await new Promise((r) => setTimeout(r, 500));

  const created = await api('/api/jobs', {
    method: 'POST', token: userA,
    body: { n: 40000, maxIter: 2000, tol: 1e-6, omega: 1.9 }
  });
  check('задачу створено', created.status === 201, `статус ${created.status}`);
  const jobId = created.data.job && created.data.job.id;

  const listB = await api('/api/jobs', { token: userB });
  const leaked = (listB.data.jobs || []).some((j) => j.id === jobId);
  check('чужа задача не потрапляє у список користувача B', !leaked);

  const directB = await api(`/api/jobs/${jobId}`, { token: userB });
  check('прямий запит чужої задачі → 404', directB.status === 404, `статус ${directB.status}`);

  const cancelB = await api(`/api/jobs/${jobId}/cancel`, { method: 'POST', token: userB });
  check('скасування чужої задачі → 404', cancelB.status === 404, `статус ${cancelB.status}`);

  const [msgsB, msgsAdmin] = await Promise.all([wsB, wsAdmin]);

  const jobEventsB = msgsB.filter((m) => m.type === 'job' && m.job.id === jobId);
  check('WebSocket користувача B не отримав подій про чужу задачу', jobEventsB.length === 0,
    `отримано ${jobEventsB.length}`);

  const jobEventsAdmin = msgsAdmin.filter((m) => m.type === 'job' && m.job.id === jobId);
  check('WebSocket адміністратора отримав події про задачу', jobEventsAdmin.length > 0,
    `отримано ${jobEventsAdmin.length}`);

  const queueMsgs = msgsB.filter((m) => m.type === 'queue');
  const queueLeaksIds = queueMsgs.some((m) => Array.isArray(m.queue));
  check('подія черги не містить ідентифікаторів задач', !queueLeaksIds);

  console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('Помилка тесту:', err.message);
  process.exit(1);
});
