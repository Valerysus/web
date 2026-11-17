'use strict';




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


function sourceFunction(x, y) {
  return 2 * Math.PI * Math.PI * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
}


function exactSolution(x, y) {
  return Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
}


function solve(opts) {
  const {
    n, maxIter, tol, omega = 1.9,
    onProgress = () => {}, shouldStop = () => false, deadline = Infinity
  } = opts;


  const inner = Math.max(2, Math.round(Math.sqrt(n)));
  const unknowns = inner * inner;
  const h = 1 / (inner + 1);
  const h2 = h * h;

  const f = new Float64Array(unknowns);
  for (let i = 0; i < inner; i++) {
    for (let j = 0; j < inner; j++) {
      f[i * inner + j] = sourceFunction((i + 1) * h, (j + 1) * h);
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
        stage: `ітерація ${iter} з ${maxIter} (сітка ${inner}×${inner} вузлів)`,
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
      const err = Math.abs(v - exactSolution((i + 1) * h, (j + 1) * h));
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
