'use strict';

/**
 * Обчислювальне ядро: розв'язання двовимірного рівняння Пуассона
 *   -Δu = f  на одиничному квадраті з нульовими граничними умовами Діріхле,
 * методом скінченних різниць із ітераційною схемою SOR (successive over-relaxation).
 *
 * Сітка: `inner` внутрішніх вузлів на сторону, крок h = 1/(inner+1),
 * тобто границі x=0 та x=1 лежать рівно на межах відрізка.
 * Кількість невідомих = inner².
 */

/** Генератор псевдовипадкових чисел (mulberry32) — лишається для сумісності API. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Права частина f(x,y) — гладка функція, щоб задача мала змістовний розв'язок. */
function sourceFunction(x, y) {
  return 2 * Math.PI * Math.PI * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
}

/** Точний розв'язок для контролю похибки: u(x,y) = sin(πx)·sin(πy). */
function exactSolution(x, y) {
  return Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
}

/**
 * @param {object} opts
 * @param {number} opts.n          бажана кількість невідомих
 * @param {number} opts.maxIter    максимум ітерацій
 * @param {number} opts.tol        точність (максимальна зміна за ітерацію)
 * @param {number} [opts.omega]    коефіцієнт релаксації SOR, 1 < ω < 2
 * @param {number} [opts.seed]     сід генератора (варіація амплітуди правої частини)
 * @param {(p:object)=>void} [opts.onProgress]
 * @param {()=>boolean} [opts.shouldStop]
 * @param {number} [opts.deadline] абсолютний час (ms), після якого треба зупинитись
 */
function solve(opts) {
  const {
    n, maxIter, tol, omega = 1.9, seed = 1,
    onProgress = () => {}, shouldStop = () => false, deadline = Infinity
  } = opts;

  // inner внутрішніх вузлів на сторону; крок сітки h = 1/(inner+1)
  const inner = Math.max(2, Math.round(Math.sqrt(n)));
  const unknowns = inner * inner;
  const h = 1 / (inner + 1);
  const h2 = h * h;

  // Сід лише масштабує амплітуду гладкої правої частини — не додає шуму,
  // тому похибка відносно аналітичного розв'язку лишається малою.
  const amplitude = 1 + ((seed % 7) - 3) * 0.01;

  const f = new Float64Array(unknowns);
  for (let i = 0; i < inner; i++) {
    for (let j = 0; j < inner; j++) {
      f[i * inner + j] = amplitude * sourceFunction((i + 1) * h, (j + 1) * h);
    }
  }

  const u = new Float64Array(unknowns);
  let iterations = 0;
  let delta = Infinity;
  let stopped = null;

  const reportEvery = Math.max(1, Math.floor(maxIter / 100));

  for (let iter = 1; iter <= maxIter; iter++) {
    let maxDelta = 0;

    for (let i = 0; i < inner; i++) {
      for (let j = 0; j < inner; j++) {
        const idx = i * inner + j;
        const left = i > 0 ? u[(i - 1) * inner + j] : 0;
        const right = i < inner - 1 ? u[(i + 1) * inner + j] : 0;
        const down = j > 0 ? u[i * inner + (j - 1)] : 0;
        const up = j < inner - 1 ? u[i * inner + (j + 1)] : 0;

        const gs = 0.25 * (left + right + down + up + h2 * f[idx]);
        const next = (1 - omega) * u[idx] + omega * gs;
        const change = Math.abs(next - u[idx]);
        if (change > maxDelta) maxDelta = change;
        u[idx] = next;
      }
    }

    iterations = iter;
    delta = maxDelta;

    if (iter % reportEvery === 0 || iter === maxIter) {
      onProgress({
        progress: Math.min(99, Math.round((iter / maxIter) * 100)),
        stage: `ітерація ${iter} з ${maxIter} (сітка ${inner}×${inner})`,
        iterations: iter,
        delta
      });
    }

    if (maxDelta < tol) {
      onProgress({ progress: 100, stage: 'збіжність досягнута', iterations: iter, delta });
      break;
    }
    if (shouldStop()) { stopped = 'cancelled'; break; }
    if (Date.now() > deadline) { stopped = 'timeout'; break; }
  }

  // Справжня нев'язка дискретної задачі: max |f - A·u|, де A·u = (4u - сусіди)/h²
  let residual = 0;
  for (let i = 0; i < inner; i++) {
    for (let j = 0; j < inner; j++) {
      const idx = i * inner + j;
      const left = i > 0 ? u[(i - 1) * inner + j] : 0;
      const right = i < inner - 1 ? u[(i + 1) * inner + j] : 0;
      const down = j > 0 ? u[i * inner + (j - 1)] : 0;
      const up = j < inner - 1 ? u[i * inner + (j + 1)] : 0;
      const au = (4 * u[idx] - left - right - down - up) / h2;
      const r = Math.abs(f[idx] - au);
      if (r > residual) residual = r;
    }
  }

  let maxError = 0;
  let norm = 0;
  for (let i = 0; i < inner; i++) {
    for (let j = 0; j < inner; j++) {
      const v = u[i * inner + j];
      norm += v * v;
      const err = Math.abs(v - amplitude * exactSolution((i + 1) * h, (j + 1) * h));
      if (err > maxError) maxError = err;
    }
  }

  const mid = Math.floor(inner / 2);
  const profile = [];
  const step = Math.max(1, Math.floor(inner / 40));
  for (let j = 0; j < inner; j += step) {
    profile.push(Number(u[mid * inner + j].toFixed(6)));
  }

  return {
    stopped,
    gridSize: inner,
    unknowns,
    iterations,
    delta,
    residual,
    maxError,
    converged: delta < Math.max(tol, 1e-12),
    solutionNorm: Math.sqrt(norm),
    profile
  };
}

module.exports = { solve, mulberry32, sourceFunction, exactSolution };
