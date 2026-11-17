'use strict';

/* ------------------------------------------------------------------ state */

const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  limits: null,
  jobs: [],
  servers: [],
  ws: null,
  adminTimer: null,
  authMode: 'login'
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/** Екранування тексту перед вставкою в innerHTML. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

/* -------------------------------------------------------------------- api */

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Помилка ${res.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

/* ------------------------------------------------------------------- auth */

function showAuth() {
  $('#authView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
  $('#userBadge').classList.add('hidden');
  $('#logoutBtn').classList.add('hidden');
}

function showApp() {
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#userBadge').classList.remove('hidden');
  $('#logoutBtn').classList.remove('hidden');
  $('#userBadge').textContent = state.user.email;
  $('#userBadge').classList.toggle('admin', state.user.role === 'admin');
  $('#adminCard').classList.toggle('hidden', state.user.role !== 'admin');
}

$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    state.authMode = tab.dataset.auth;
    $('#authSubmit').textContent = state.authMode === 'login' ? 'Увійти' : 'Зареєструватись';
    $('#authError').classList.add('hidden');
  });
});

$('#authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.querySelector('#email').value.trim();
  const password = document.querySelector('#password').value;
  const btn = document.querySelector('#authSubmit');
  const errBox = document.querySelector('#authError');

  errBox.classList.add('hidden');
  btn.disabled = true;
  try {
    const data = await api(`/api/auth/${state.authMode}`, {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('token', data.token);
    await boot();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

document.querySelector('#logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('token');
  state.token = null;
  state.user = null;
  if (state.ws) { state.ws.close(); state.ws = null; }
  showAuth();
});

/* ------------------------------------------------------------------ limits */

function readFormClean() {
  return {
    n: Number(document.querySelector('#n').value),
    maxIter: Number(document.querySelector('#maxIter').value),
    tol: Number(document.querySelector('#tol').value),
    omega: Number(document.querySelector('#omega').value)
  };
}

/** Дзеркало серверної валідації — перевірка ще на клієнті (п.1 ТЗ) */
function validateClient(v) {
  const L = state.limits.limits;
  const errors = [];

  if (!Number.isInteger(v.n) || v.n < 2) errors.push('Кількість невідомих має бути цілим числом ≥ 2');  if (v.n > L.maxUnknowns) errors.push(`Перевищено ліміт невідомих: максимум ${L.maxUnknowns}`);
  if (!Number.isInteger(v.maxIter) || v.maxIter < 1) errors.push('Кількість ітерацій має бути цілим ≥ 1');
  if (v.maxIter > L.maxIterations) errors.push(`Перевищено ліміт ітерацій: максимум ${L.maxIterations}`);
  if (!(v.tol >= L.minTolerance && v.tol <= L.maxTolerance)) {
    errors.push(`Точність має бути в межах ${L.minTolerance} … ${L.maxTolerance}`);
  }
  if (!(v.omega > 0 && v.omega < 2)) errors.push('Параметр релаксації ω має бути в межах (0; 2)');

  const work = (Number.isFinite(v.n) ? v.n : 0) * (Number.isFinite(v.maxIter) ? v.maxIter : 0);
  if (work > L.maxWorkUnits) {
    errors.push(`Трудомісткість ${work.toLocaleString('uk-UA')} перевищує бюджет ${L.maxWorkUnits.toLocaleString('uk-UA')}`);
  }
  return { errors, work };
}

function updateWorkload() {
  const v = readFormClean();
  const L = state.limits.limits;
  const work = (Number.isFinite(v.n) ? v.n : 0) * (Number.isFinite(v.maxIter) ? v.maxIter : 0);
  const pct = Math.min(100, (work / L.maxWorkUnits) * 100);

  document.querySelector('#workloadValue').textContent = work.toLocaleString('uk-UA') + ' операцій';
  const bar = document.querySelector('#workloadBar');
  bar.style.width = pct + '%';
  bar.className = 'bar-fill' + (work > L.maxWorkUnits ? ' bad' : pct > 70 ? ' warn' : '');

  const hint = document.querySelector('#workloadHint');
  if (work > L.maxWorkUnits) {
    hint.textContent = `Перевищено бюджет ${L.maxWorkUnits.toLocaleString('uk-UA')} — сервер відмовить у виконанні.`;
    hint.className = 'hint bad';
  } else {
    hint.textContent = `Бюджет: ${L.maxWorkUnits.toLocaleString('uk-UA')} операцій (невідомі × ітерації).`;
    hint.className = 'hint';
  }
  document.querySelector('#nHint').textContent = `максимум ${L.maxUnknowns.toLocaleString('uk-UA')}`;
}

['#n', '#maxIter', '#tol', '#omega'].forEach((sel) => {
  document.querySelector(sel).addEventListener('input', updateWorkload);
});

/* ------------------------------------------------------------------- jobs */

document.querySelector('#jobForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.querySelector('#jobError');
  const btn = document.querySelector('#runBtn');
  errBox.classList.add('hidden');

  const v = readFormClean();
  const { errors } = validateClient(v);
  if (errors.length) {
    errBox.textContent = errors[0];
    errBox.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  try {
    const data = await api('/api/jobs', { method: 'POST', body: JSON.stringify(v) });
    if (data.queue && data.queue.etaSeconds > 0) {
      showQueueInfo(`Задачу поставлено в чергу. Позиція ${data.queue.position}, очікування ≈ ${data.queue.etaSeconds} с.`);
    } else {
      document.querySelector('#queueInfo').classList.add('hidden');
    }
    await loadJobs();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

function showQueueInfo(text) {
  const box = document.querySelector('#queueInfo');
  box.textContent = text;
  box.classList.remove('hidden');
}

function statusLabel(s) {
  return { queued: 'У черзі', running: 'Виконується', done: 'Завершено', failed: 'Помилка', cancelled: 'Скасовано' }[s] || s;
}

function statusDotClass(s) {
  return { queued: 'queued', running: 'running', done: 'done', failed: 'failed', cancelled: 'cancelled' }[s] || 'queued';
}

function renderJobs() {
  const box = document.querySelector('#jobsList');
  if (!state.jobs.length) {
    box.innerHTML = '<p class="muted">Задач ще немає.</p>';
    return;
  }

  box.innerHTML = state.jobs.map((j) => {
    const canCancel = j.status === 'queued' || j.status === 'running';
    const isDone = j.status === 'done';
    const isQueued = j.status === 'queued';

    let detailLine = '';
    if (isDone && j.result && j.result.iterations) {
      detailLine = `<div class="job-result">ітерацій: ${j.result.iterations} · вузлів: ${j.result.gridSize}×${j.result.gridSize} · остання зміна: ${Number(j.result.delta).toExponential(2)} · похибка: ${Number(j.result.maxError).toExponential(2)}</div>`;
    } else if (isQueued) {
      const pos = j.queuePosition ? `позиція ${j.queuePosition}` : 'у черзі';
      const eta = j.etaSeconds ? ` · очікування ≈ ${j.etaSeconds} с` : '';
      detailLine = `<div class="job-stage">${esc(pos)}${esc(eta)}</div>`;
    } else {
      detailLine = `<div class="job-stage">${esc(j.stage)}</div>`;
    }

    const err = j.error ? `<div class="job-result job-error">${esc(j.error)}</div>` : '';
    const barClass = isDone ? 'bar-fill done' : 'bar-fill';

    return `
      <div class="job">
        <div class="job-head">
          <div>
            <div class="job-title">Пуассон · невідомих ${Number(j.n).toLocaleString('uk-UA')} · ε = ${esc(j.tol)}</div>
            <div class="job-meta">${esc(j.createdAt || j.created_at || '')} · сервер ${esc(j.workerId || '—')}</div>
          </div>
          <div class="job-status">
            <span class="status-dot ${statusDotClass(j.status)}"></span>
            ${esc(statusLabel(j.status))}
          </div>
        </div>
        <div class="job-progress">
          <div class="bar"><div class="${barClass}" style="width:${Number(j.progress) || 0}%"></div></div>
          <span>${Number(j.progress) || 0}%</span>
        </div>
        ${detailLine}
        ${err}
        ${canCancel ? `<div class="job-actions"><button class="ghost" data-cancel="${esc(j.id)}">Скасувати</button></div>` : ''}
      </div>`;
  }).join('');

  $$('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api(`/api/jobs/${btn.dataset.cancel}/cancel`, { method: 'POST' });
        await loadJobs();
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

async function loadJobs() {
  const data = await api('/api/jobs');
  state.jobs = data.jobs;
  renderJobs();
}

document.querySelector('#refreshBtn').addEventListener('click', loadJobs);

/* ---------------------------------------------------------------- system */

function renderSystem(pool, queue, servers) {
  if (pool) {
    const max = state.limits && state.limits.servers ? state.limits.servers.max : pool.size;
    document.querySelector('#statServers').textContent = `${pool.size} з ${max}`;
    document.querySelector('#statActive').textContent = `${pool.active} ${pluralTasks(pool.active)}`;
    const load = pool.capacity ? Math.round((pool.active / pool.capacity) * 100) : 0;
    document.querySelector('#statLoad').textContent = load + '%';
  }
  if (queue) {
    const eta = queue.nextEtaSeconds ? ` · очікування ≈ ${queue.nextEtaSeconds} с` : '';
    document.querySelector('#statQueue').textContent = `${queue.length}${eta}`;
    if (queue.length) {
      showQueueInfo(`У черзі ${queue.length} задач. Наступна почнеться ≈ через ${queue.nextEtaSeconds} с.`);
    } else {
      document.querySelector('#queueInfo').classList.add('hidden');
    }
  }
  if (servers) {
    state.servers = servers;
    renderServers();
  }
}

function pluralTasks(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'задача';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачі';
  return 'задач';
}

function renderServers() {
  const box = document.querySelector('#serversList');
  if (!box) return;
  if (!state.servers.length) {
    box.innerHTML = '<p class="muted">Серверів немає.</p>';
    return;
  }
  const isAdmin = state.user && state.user.role === 'admin';
  box.innerHTML = state.servers.map((s) => {
    const pct = s.capacity ? Math.round((s.active / s.capacity) * 100) : 0;
    const meta = isAdmin && s.port
      ? `порт ${s.port} · ${s.active} з ${s.capacity}`
      : `${s.active} з ${s.capacity}`;
    const starting = s.ready === false
      ? '<div class="server-starting">запускається…</div>'
      : '';
    return `
      <div class="server-row">
        <div class="server-head">
          <span class="server-name">${esc(s.id)}</span>
          <span class="server-meta">${esc(meta)}</span>
        </div>
        <div class="server-bar"><div class="server-bar-fill" style="width:${pct}%"></div></div>
        ${starting}
      </div>`;
  }).join('');

  const max = state.limits && state.limits.servers ? state.limits.servers.max : 3;
  const foot = document.querySelector('#serversFoot');
  if (foot) foot.textContent = `Максимум ${max} сервери. Нові запускаються автоматично, коли з'являється черга.`;
}

/* --------------------------------------------------------------- websocket */

function connectWs() {
  if (state.ws) state.ws.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(state.token)}`);
  state.ws = ws;

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    if (msg.type === 'job') {
      // Сервер надсилає лише власні задачі (і задачі всіх користувачів для адміна),
      // тому невідому задачу додаємо тільки якщо вона справді належить нам.
      const idx = state.jobs.findIndex((j) => j.id === msg.job.id);
      if (idx >= 0) {
        state.jobs[idx] = { ...state.jobs[idx], ...msg.job };
      } else if (state.user.role === 'admin' || msg.job.userId === state.user.id) {
        state.jobs.unshift(msg.job);
      } else {
        return;
      }
      renderJobs();
    } else if (msg.type === 'queue') {
      renderSystem(msg.pool, msg.queue, msg.servers);
    }
  };

  ws.onclose = () => {
    if (state.token) setTimeout(connectWs, 2000);
  };
}

/* ------------------------------------------------------------------ admin */

async function loadAdmin() {
  if (!state.user || state.user.role !== 'admin') return;
  try {
    const data = await api('/api/admin/overview');
    document.querySelector('#admUsers').textContent = data.users;
    document.querySelector('#admRunning').textContent = data.jobs.running;
    document.querySelector('#admQueued').textContent = data.jobs.queued;
    document.querySelector('#admDone').textContent = data.jobs.done;

    document.querySelector('#serversTable').querySelector('tbody').innerHTML = data.pool.servers.map((s) => `
      <tr>
        <td>${esc(s.id)}</td>
        <td>${Number(s.port)}</td>
        <td>${Number(s.active)}</td>
        <td>${Number(s.capacity)}</td>
        <td>${Number(s.uptimeSec)} с</td>
        <td>${Number(s.idleSec)} с</td>
      </tr>`).join('');

    const log = await api('/api/admin/log');
    document.querySelector('#adminLog').innerHTML = [
      ...log.workers.map((w) => `<div><span class="t">${esc(w.created_at)}</span> [${esc(w.worker_id)}] ${esc(w.action)} ${esc(w.detail || '')}</div>`),
      ...log.events.map((e) => `<div><span class="t">${esc(e.created_at)}</span> [job n=${Number(e.n)}] ${esc(e.message)}</div>`)
    ].join('');
  } catch { /* не адмін або мережа */ }
}

$$('[data-scale]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api('/api/admin/scale', { method: 'POST', body: JSON.stringify({ action: btn.dataset.scale }) });
      await loadAdmin();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });
});

/* ------------------------------------------------------------------- views */

$$('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.view').forEach((v) => v.classList.add('hidden'));
    const map = { app: '#appView', arch: '#archView' };
    document.querySelector(map[btn.dataset.view]).classList.remove('hidden');
  });
});

/* -------------------------------------------------------------------- boot */

async function boot() {
  if (!state.token) { showAuth(); return; }

  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
  } catch {
    localStorage.removeItem('token');
    state.token = null;
    showAuth();
    return;
  }

  state.limits = await api('/api/limits');
  const L = state.limits.limits;
  const heroLimits = document.querySelector('#heroLimits');
  if (heroLimits) {
    heroLimits.textContent =
      `До ${L.maxUnknowns.toLocaleString('uk-UA')} невідомих · до ${L.maxIterations.toLocaleString('uk-UA')} ітерацій · до ${L.maxSeconds} секунд на задачу`;
  }
  showApp();
  updateWorkload();
  await loadJobs();
  connectWs();
  if (state.user.role === 'admin') {
    await loadAdmin();
    if (state.adminTimer) clearInterval(state.adminTimer);
    state.adminTimer = setInterval(loadAdmin, 3000);
  }
}

boot();
