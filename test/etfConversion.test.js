import test from 'node:test';
import assert from 'node:assert/strict';
import { etfToCashFactor } from '../src/lib/etfConversion.ts';

test('converts ETF strikes using same-session cash and ETF highs', () => {
  for (const [etfHigh, cashHigh, strike, expected] of [
    [500, 30000, 510, 30600],
    [600, 6000, 620, 6200],
    [400, 40000, 410, 41000],
  ]) {
    const factor = etfToCashFactor(etfHigh, '2026-10-28', cashHigh, '2026-10-28');
    assert.notEqual(factor, null);
    assert.equal(strike * factor, expected);
  }
});

test('rejects missing, invalid, or mismatched session highs', () => {
  for (const [etfHigh, etfDate, cashHigh, cashDate] of [
    [null, '2026-10-28', 30000, '2026-10-28'],
    [0, '2026-10-28', 30000, '2026-10-28'],
    [500, '2026-10-28', Infinity, '2026-10-28'],
    [500, null, 30000, null],
    [500, '2026-10-27', 30000, '2026-10-28'],
  ]) {
    assert.equal(etfToCashFactor(etfHigh, etfDate, cashHigh, cashDate), null);
  }
});
