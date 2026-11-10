'use strict';

/**
 * Тест обчислювального ядра: перевіряє збіжність, похибку та скасування.
 * Запуск: node scripts/test-solver.js
 */

const assert = require('node:assert');
const { solve } = require('../shared/solver');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Тести обчислювального ядра (рівняння Пуассона, SOR):');

test('мала сітка збігається до заданої точності', () => {
  const r = solve({ n: 400, maxIter: 5000, tol: 1e-8, omega: 1.9 });
  assert.ok(r.converged, 'очікувалась збіжність');
  assert.ok(r.residual < 1e-8, `нев'язка ${r.residual} завелика`);
  assert.ok(r.iterations > 0 && r.iterations <= 5000);
});

test('сітка 401×401 дає прийнятну похибку відносно аналітичного розв\'язку', () => {
  const r = solve({ n: 160000, maxIter: 3000, tol: 1e-6, omega: 1.9 });
  assert.strictEqual(r.gridSize, 401);
  assert.ok(r.maxError < 0.05, `похибка ${r.maxError} завелика`);
});

test('прогрес монотонно зростає і не перевищує 100', () => {
  const seen = [];
  solve({ n: 10000, maxIter: 500, tol: 1e-12, omega: 1.9, onProgress: (p) => seen.push(p.progress) });
  assert.ok(seen.length > 0, 'прогрес не надходив');
  assert.ok(seen.every((v) => v >= 0 && v <= 100), 'прогрес поза межами 0..100');
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'прогрес не монотонний');
  }
});

test('скасування зупиняє обчислення', () => {
  let calls = 0;
  const r = solve({
    n: 250000, maxIter: 20000, tol: 1e-14, omega: 1.9,
    shouldStop: () => ++calls > 3
  });
  assert.strictEqual(r.stopped, 'cancelled');
  assert.ok(r.iterations < 20000, 'обчислення не зупинилось');
});

test('перевищення дедлайну повертає статус timeout', () => {
  const r = solve({
    n: 250000, maxIter: 20000, tol: 1e-14, omega: 1.9,
    deadline: Date.now() + 50
  });
  assert.strictEqual(r.stopped, 'timeout');
});

test('детермінованість: однаковий сід — однаковий результат', () => {
  const a = solve({ n: 10000, maxIter: 300, tol: 1e-12, omega: 1.9, seed: 42 });
  const b = solve({ n: 10000, maxIter: 300, tol: 1e-12, omega: 1.9, seed: 42 });
  assert.strictEqual(a.residual, b.residual);
  assert.deepStrictEqual(a.profile, b.profile);
});

console.log(`\nПройдено: ${passed}`);
if (process.exitCode) {
  console.error('Є помилки в тестах.');
} else {
  console.log('Усі тести пройдено.');
}
