import test from 'node:test';
import assert from 'node:assert/strict';
import { wallPosition } from '../src/lib/wallAnalysis.ts';

test('describes an overhead level with conditional rejection and breakout scenarios', () => {
  const result = wallPosition(105, 100);
  assert.equal(result.position, 'above');
  assert.ok(Math.abs(result.offsetPct - 5) < 1e-10);
  assert.match(result.scenarios[0], /Odrzucenie.*w dół/);
  assert.match(result.scenarios[1], /powyżej.*wzrostowi/);
});

test('describes a level below spot with conditional defense and breakdown scenarios', () => {
  const result = wallPosition(95, 100);
  assert.equal(result.position, 'below');
  assert.ok(Math.abs(result.offsetPct + 5) < 1e-10);
  assert.match(result.scenarios[0], /Obrona.*w górę/);
  assert.match(result.scenarios[1], /poniżej.*spadkowi/);
});

test('uses neutral scenarios at spot rather than assuming either side', () => {
  const result = wallPosition(100, 100);
  assert.equal(result.position, 'at');
  assert.equal(result.offsetPct, 0);
  assert.match(result.scenarios[0], /powyżej/);
  assert.match(result.scenarios[1], /poniżej/);
});

test('does not invent a distance or scenarios when spot or strike is invalid', () => {
  for (const [strike, spot] of [[100, null], [100, 0], [100, NaN], [Infinity, 100], [0, 100]]) {
    assert.deepEqual(wallPosition(strike, spot), { position: 'unknown', offsetPct: null, scenarios: [] });
  }
});
