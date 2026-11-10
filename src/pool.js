'use strict';

/**
 * Пул серверів застосунків + автомасштабування (горизонтальне розширення).
 * Кожен "сервер застосунку" — окремий процес Node.js зі своїм портом.
 */

const { fork } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const {
  ROOT, WORKER_HOST, WORKER_BASE_PORT, MIN_WORKERS, MAX_WORKERS,
  WORKER_CAPACITY, SCALE_DOWN_IDLE_MS, INTERNAL_PORT, INTERNAL_SECRET
} = require('./config');
const { logWorker } = require('./db');

const WORKER_SCRIPT = path.join(ROOT, 'src', 'worker.js');

function request(port, pathname, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      { host: WORKER_HOST, port, path: pathname, method: body ? 'POST' : 'GET',
        headers: {
          ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}),
          ...headers
        },
        timeout: 5000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || '{}') }); }
          catch { resolve({ status: res.statusCode, body: {} }); }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

class WorkerPool {
  constructor() {
    this.workers = new Map(); // id -> { id, port, proc, capacity, active:Set, lastUsed, ready }
    this.nextIndex = 0;
    this.scaling = false;
    this.manualHoldUntil = 0;
  }

  /** Тимчасово вимкнути автоматику після ручної зміни розміру пулу */
  holdAutoscale(ms = 60_000) {
    this.manualHoldUntil = Date.now() + ms;
  }

  get size() { return this.workers.size; }

  list() {
    return [...this.workers.values()].map((w) => ({
      id: w.id,
      port: w.port,
      capacity: w.capacity,
      active: w.active.size,
      load: Math.round((w.active.size / Math.max(1, w.capacity)) * 100),
      ready: w.ready,
      uptimeSec: Math.round((Date.now() - w.startedAt) / 1000),
      idleSec: Math.round((Date.now() - w.lastUsed) / 1000)
    }));
  }

  get activeCount() {
    let n = 0;
    for (const w of this.workers.values()) n += w.active.size;
    return n;
  }

  get totalCapacity() {
    let n = 0;
    for (const w of this.workers.values()) n += w.capacity;
    return n;
  }

  async startWorker() {
    if (this.workers.size >= MAX_WORKERS) return null;

    const index = this.nextIndex++;
    const port = WORKER_BASE_PORT + (index % 100);
    const id = `app-${this.nextIndex}`;

    const proc = fork(WORKER_SCRIPT, [], {
      env: {
        ...process.env,
        PORT: String(port),
        WORKER_ID: id,
        CAPACITY: String(WORKER_CAPACITY),
        LB_INTERNAL: `http://127.0.0.1:${INTERNAL_PORT}`,
        INTERNAL_SECRET
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });

    const worker = {
      id, port, proc, capacity: WORKER_CAPACITY,
      active: new Set(), lastUsed: Date.now(), startedAt: Date.now(), ready: false
    };
    this.workers.set(id, worker);
    logWorker(id, 'started', `порт ${port}`);

    proc.on('exit', () => {
      this.workers.delete(id);
      logWorker(id, 'stopped', 'процес завершився');
    });

    // Чекаємо готовності (health-check)
    for (let i = 0; i < 60; i++) {
      try {
        const res = await request(port, '/health');
        if (res.status === 200) { worker.ready = true; break; }
      } catch { /* ще не піднявся */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!worker.ready) logWorker(id, 'warning', 'не відповів на health-check');
    return worker;
  }

  async ensureMinimum() {
    while (this.workers.size < MIN_WORKERS) {
      const w = await this.startWorker();
      if (!w) break;
    }
  }

  /** Найменш завантажений сервер, у якого є вільний слот */
  pick() {
    let best = null;
    for (const w of this.workers.values()) {
      if (!w.ready) continue;
      if (w.active.size >= w.capacity) continue;
      if (!best || w.active.size < best.active.size) best = w;
    }
    return best;
  }

  async dispatch(job) {
    const worker = this.pick();
    if (!worker) return null;
    worker.active.add(job.id);
    worker.lastUsed = Date.now();
    try {
      await request(worker.port, '/run', job, { 'x-internal-token': 'worker' });
      return worker;
    } catch (err) {
      worker.active.delete(job.id);
      return null;
    }
  }

  release(jobId) {
    for (const w of this.workers.values()) {
      if (w.active.delete(jobId)) w.lastUsed = Date.now();
    }
  }

  async cancel(jobId) {
    for (const w of this.workers.values()) {
      if (w.active.has(jobId)) {
        try { await request(w.port, '/cancel', { id: jobId }, { 'x-internal-token': 'worker' }); }
        catch { /* ignore */ }
        w.active.delete(jobId);
        return true;
      }
    }
    return false;
  }

  async stopWorker(id) {
    const w = this.workers.get(id);
    if (!w) return false;
    try { await request(w.port, '/shutdown', {}, { 'x-internal-token': 'worker' }); } catch { /* ignore */ }
    setTimeout(() => { try { w.proc.kill(); } catch { /* ignore */ } }, 500);
    this.workers.delete(id);
    logWorker(id, 'scaled-down', 'автоматичне зменшення пулу');
    return true;
  }

  /** Автомасштабування: вгору за чергою, вниз за простоєм */
  async autoscale(queueLength) {
    if (this.scaling) return;
    // Ручне керування з панелі адміністратора має пріоритет над автоматикою
    if (Date.now() < this.manualHoldUntil) return;
    this.scaling = true;
    try {
      if (queueLength > 0 && this.workers.size < MAX_WORKERS) {
        const freeSlots = this.totalCapacity - this.activeCount;
        if (queueLength > freeSlots) {
          await this.startWorker();
          logWorker('pool', 'scale-up', `черга ${queueLength}, серверів ${this.workers.size}`);
        }
      } else if (queueLength === 0 && this.workers.size > MIN_WORKERS) {
        const now = Date.now();
        const idle = [...this.workers.values()]
          .filter((w) => w.active.size === 0 && now - w.lastUsed > SCALE_DOWN_IDLE_MS)
          .sort((a, b) => a.lastUsed - b.lastUsed);
        if (idle.length && this.workers.size - 1 >= MIN_WORKERS) {
          await this.stopWorker(idle[0].id);
        }
      }
    } finally {
      this.scaling = false;
    }
  }

  async shutdownAll() {
    for (const id of [...this.workers.keys()]) {
      const w = this.workers.get(id);
      try { w.proc.kill(); } catch { /* ignore */ }
    }
    this.workers.clear();
  }
}

module.exports = { WorkerPool, request };
