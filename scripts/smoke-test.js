'use strict';

/**
 * Smoke-тест API: перевіряє авторизацію, ліміти, створення задачі,
 * прогрес, скасування та адмін-метрики на живій системі.
 * Запуск: node scripts/smoke-test.js (система має бути вже запущена)
 */

const https = require('node:https');

const BASE = process.env.BASE_URL || 'https://localhost:8443';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  console.log(`Smoke-тест API: ${BASE}\n`);

  const limits = await api('/api/limits');
  check('GET /api/limits віддає ліміти', limits.status === 200 && !!limits.data.limits);

  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody@example.com', password: 'wrong' }
  });
  console.log(`  · невірний логін → ${badLogin.status}`);

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'user@local', password: 'user123' }
  });
  check('вхід демо-користувача', login.status === 200 && !!login.data.token);
  const token = login.data.token;

  const noAuth = await api('/api/jobs');
  check('без токена → 401', noAuth.status === 401);

  const tooBig = await api('/api/jobs', {
    method: 'POST', token,
    body: { n: 250000, maxIter: 20000, tol: 1e-6, omega: 1.9 }
  });
  check('перевищення бюджету → 422', tooBig.status === 422, `отримано ${tooBig.status}`);

  const created = await api('/api/jobs', {
    method: 'POST', token,
    body: { n: 40000, maxIter: 2000, tol: 1e-6, omega: 1.9 }
  });
  check('створення задачі → 201', created.status === 201, `отримано ${created.status}`);
  const jobId = created.data.job && created.data.job.id;

  if (jobId) {
    await new Promise((r) => setTimeout(r, 1500));
    const one = await api(`/api/jobs/${jobId}`, { token });
    check('задача має статус і прогрес',
      one.status === 200 && ['queued', 'running', 'done'].includes(one.data.job.status),
      JSON.stringify(one.data.job && one.data.job.status));

    const cancel = await api(`/api/jobs/${jobId}/cancel`, { method: 'POST', token });
    check('скасування приймається', cancel.status === 200 || cancel.status === 409);
  }

  const adminLogin = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@local', password: 'admin123' }
  });
  const adminToken = adminLogin.data.token;

  const forbidden = await api('/api/admin/overview', { token });
  check('звичайний користувач не бачить адмінку → 403', forbidden.status === 403);

  const overview = await api('/api/admin/overview', { token: adminToken });
  check('адмін отримує метрики',
    overview.status === 200 && overview.data.pool && overview.data.pool.size >= 2,
    `pool.size=${overview.data.pool && overview.data.pool.size}`);

  console.log(`\nПройдено: ${passed}, провалено: ${failed}`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error('Помилка smoke-тесту:', err.message);
  process.exit(1);
});
