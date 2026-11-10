'use strict';

const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

module.exports = {
  ROOT,
  DATA_DIR: path.join(ROOT, 'data'),
  CERT_DIR: path.join(ROOT, 'certs'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  DB_FILE: path.join(ROOT, 'data', 'app.db'),

  // Єдина точка входу: HTTPS + WSS + балансувальник навантаження
  LB_PORT: Number(process.env.LB_PORT || 8443),
  LB_HOST: '0.0.0.0',
  // Внутрішній канал "сервер застосунків -> балансувальник" (тільки localhost)
  INTERNAL_PORT: Number(process.env.INTERNAL_PORT || 8444),
  INTERNAL_SECRET: process.env.INTERNAL_SECRET || 'internal-dev-secret',

  // Пул серверів застосунків (application servers)
  WORKER_HOST: '127.0.0.1',
  WORKER_BASE_PORT: Number(process.env.WORKER_BASE_PORT || 9101),
  MIN_WORKERS: Number(process.env.MIN_WORKERS || 2),
  MAX_WORKERS: Number(process.env.MAX_WORKERS || 4),
  WORKER_CAPACITY: Number(process.env.WORKER_CAPACITY || 1),

  // Обмеження трудомісткості однієї задачі
  LIMITS: {
    maxUnknowns: 250_000,      // максимальна кількість невідомих (вузлів сітки)
    maxIterations: 20_000,     // максимальна кількість ітерацій
    maxWorkUnits: 600_000_000, // невідомі × ітерації — "бюджет" обчислень
    maxSeconds: 60,            // жорсткий ліміт часу виконання на сервері
    minTolerance: 1e-12,
    maxTolerance: 1e-2
  },

  // Обмеження на користувача
  MAX_ACTIVE_JOBS_PER_USER: 4,
  MAX_HISTORY_JOBS_PER_USER: 20,

  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me-in-production',
  JWT_TTL: '12h',

  // Автомасштабування
  SCALE_UP_QUEUE_THRESHOLD: 1,
  SCALE_DOWN_IDLE_MS: 45_000,
  SCHEDULER_TICK_MS: 400
};
