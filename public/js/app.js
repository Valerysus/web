'use strict';

/* ------------------------------------------------------------------ state */

const state = {
  token: localStorage.getItem('token') || null,
  user: null,
  limits: null,
  jobs: [],
  ws: null,
  authMode: 'login'
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

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
  return { queued: 'у черзі', running: 'виконується', done: 'завершено', failed: 'помилка', cancelled: 'скасовано' }[s] || s;
}

function renderJobs() {
  const box = document.querySelector('#jobsList');
  if (!state.jobs.length) {
    box.innerHTML = '<p class="muted">Задач ще немає.</p>';
    return;
  }

  box.innerHTML = state.jobs.map((j) => {
    const canCancel = j.status === 'queued' || j.status === 'running';
    const eta = j.status === 'queued' && j.etaSeconds ? ` · очікування ≈ ${j.etaSeconds} с` : '';
    const result = j.result && j.result.iterations
      ? `<div class="job-result">ітерацій: ${j.result.iterations} · сітка: ${j.result.gridSize}×${j.result.gridSize} · нев'язка: ${Number(j.result.residual).toExponential(2)} · похибка: ${Number(j.result.maxError).toExponential(2)}</div>`
      : '';
    const err = j.error ? `<div class="job-result" style="color:#ff9ba0">${j.error}</div>` : '';

    return `
      <div class="job">
        <div class="job-head">
          <div>
            <div class="job-title">Пуассон · невідомих ${j.n.toLocaleString('uk-UA')} · ε = ${j.tol}</div>
            <div class="job-meta">
              <span>${j.createdAt}</span>
              <span>сервер: ${j.workerId || '—'}</span>
              <span>${j.iterations || 0} ітерацій${eta}</span>
            </div>
          </div>
          <div class="row">
            <span class="pill ${j.status}">${statusLabel(j.status)}</span>
            ${canCancel ? `<button class="btn ghost small danger" data-cancel="${j.id}">Скасувати</button>` : ''}
          </div>
        </div>
        <div class="job-progress">
          <div class="bar"><div class="bar-fill" style="width:${j.progress}%"></div></div>
          <span>${j.progress}%</span>
        </div>
        <div class="job-stage">${j.stage}</div>
        ${result}${err}
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

function renderSystem(pool, queue) {
  if (pool) {
    document.querySelector('#statServers').textContent = pool.size;
    document.querySelector('#statActive').textContent = pool.active;
    const load = pool.capacity ? Math.round((pool.active / pool.capacity) * 100) : 0;
    document.querySelector('#statLoad').textContent = load + '%';
    const bar = document.querySelector('#loadBar');
    bar.style.width = load + '%';
    bar.className = 'bar-fill' + (load > 85 ? ' bad' : load > 60 ? ' warn' : '');
  }
  if (queue) {
    document.querySelector('#statQueue').textContent = queue.length;
    if (queue.length) {
      showQueueInfo(`У черзі ${queue.length} задач. Наступна почнеться ≈ через ${queue[0].etaSeconds} с.`);
    } else {
      document.querySelector('#queueInfo').classList.add('hidden');
    }
  }
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
      const idx = state.jobs.findIndex((j) => j.id === msg.job.id);
      if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...msg.job };
      else state.jobs.unshift(msg.job);
      renderJobs();
    } else if (msg.type === 'queue') {
      renderSystem(msg.pool, msg.queue);
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
        <td>${s.id}</td>
        <td>${s.port}</td>
        <td>${s.active}</td>
        <td>${s.capacity}</td>
        <td>${s.uptimeSec} с</td>
        <td>${s.idleSec} с</td>
      </tr>`).join('');

    const log = await api('/api/admin/log');
    document.querySelector('#adminLog').innerHTML = [
      ...log.workers.map((w) => `<div><span class="t">${w.created_at}</span> [${w.worker_id}] ${w.action} ${w.detail || ''}</div>`),
      ...log.events.map((e) => `<div><span class="t">${e.created_at}</span> [job n=${e.n}] ${e.message}</div>`)
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
    const map = { app: '#appView', theory: '#theoryView', arch: '#archView' };
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
  showApp();
  updateWorkload();
  await loadJobs();
  connectWs();
  if (state.user.role === 'admin') {
    await loadAdmin();
    setInterval(loadAdmin, 3000);
  }
}

boot();
