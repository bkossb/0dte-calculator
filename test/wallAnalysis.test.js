import test from 'node:test';
import assert from 'node:assert/strict';
import { specialWallMatches, wallCashPrice, wallPosition } from '../src/lib/wallAnalysis.ts';

const wall = (label, side, strike) => ({ label, side, contract: { strike } });

test('special levels include the exact 0.1% boundary on both sides of the index strike', () => {
  const index = [wall('P1', 'put', 10000)];
  const etf = [wall('P1', 'put', 100.1), wall('P2', 'put', 99.9), wall('P3', 'put', 100.1001)];
  const matches = specialWallMatches(index, etf, 100);
  assert.deepEqual(matches.map((match) => match.etfLabel), ['P1', 'P2']);
  assert.ok(matches.every((match) => Math.abs(match.differencePct - 0.1) < 1e-10));
  assert.equal(specialWallMatches([wall('P1', 'put', 0.3)], [wall('P1', 'put', 0.3003)], 1).length, 1);
  assert.equal(specialWallMatches([wall('P1', 'put', 0.3)], [wall('P1', 'put', 0.300300001)], 1).length, 0);
});

test('special levels compare all qualifying pairs only on the same side', () => {
  const index = [wall('P1', 'put', 10000), wall('P2', 'put', 10005), wall('C1', 'call', 10000)];
  const etf = [wall('P1', 'put', 100), wall('C1', 'call', 100)];
  assert.deepEqual(specialWallMatches(index, etf, 100).map(({ cashLabel, etfLabel }) => [cashLabel, etfLabel]),
    [['P1', 'P1'], ['P2', 'P1'], ['C1', 'C1']]);
});

test('special levels require valid prices, conversion, and both sets of walls', () => {
  const index = [wall('P1', 'put', 10000), wall('P2', 'put', 0)];
  const etf = [wall('P1', 'put', 100), wall('P2', 'put', Infinity)];
  for (const factor of [null, 0, -1, Infinity, NaN]) assert.deepEqual(specialWallMatches(index, etf, factor), []);
  assert.deepEqual(specialWallMatches(index, [], 100), []);
  assert.deepEqual(specialWallMatches([], etf, 100), []);
  assert.equal(specialWallMatches(index, etf, 100).length, 1);
});

test('uses cash strikes directly and converts ETF strikes using the supplied factor', () => {
  assert.equal(wallCashPrice(30000, null), 30000);
  assert.equal(wallCashPrice(710, { factor: 40 }), 28400);
});

test('does not substitute ETF prices when conversion is unavailable or invalid', () => {
  for (const factor of [null, 0, -1, Infinity, NaN]) {
    assert.equal(wallCashPrice(710, { factor }), null);
  }
  assert.equal(wallCashPrice(Infinity, null), null);
  assert.equal(wallCashPrice(Number.MAX_VALUE, { factor: 2 }), null);
});

test('calculates ETF scenarios against actual cash spot, not the ETF spot', () => {
  const converted = wallCashPrice(99, { factor: 10 });
  const result = wallPosition(converted, 985);
  assert.equal(result.position, 'above');
  assert.ok(Math.abs(result.offsetPct - (990 / 985 - 1) * 100) < 1e-10);
  assert.match(result.scenarios[0], /Odrzucenie/);
});

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
