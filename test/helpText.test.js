import test from 'node:test';
import assert from 'node:assert/strict';
import { chartLevelHelp, helpText } from '../src/lib/helpText.ts';

test('GEX and FLIP explanations describe the implemented estimate and limitations', () => {
  assert.match(helpText.gex, /Black 76/);
  assert.match(helpText.gex, /dodatni znak call i ujemny put/);
  assert.match(helpText.gex, /nie obserwacja rzeczywistych pozycji dealerów/);
  assert.match(helpText.flip, /osobno dla każdego strike’u/);
  assert.match(helpText.flip, /pierwszej zmiany znaku/);
  assert.match(helpText.flip, /Nie przelicza łącznego GEX dla różnych cen bazowych/);
});

test('chart descriptions distinguish GEX levels, reference levels and converted ETF walls', () => {
  const level = (title, kind) => ({ title, kind, color: '#fff', price: 100 });
  assert.equal(chartLevelHelp(level('PDH', 'reference')), helpText.pdh);
  assert.match(chartLevelHelp(level('GEX C', 'gex')), /powyżej użytego forward/);
  assert.match(chartLevelHelp(level('GEX P', 'gex')), /poniżej użytego forward/);
  assert.match(chartLevelHelp(level('FLIP', 'gex')), /między kolejnymi strike’ami/);
  assert.match(chartLevelHelp(level('QQQ P1', 'put')), /poprzedniej sesji/);
  assert.doesNotMatch(chartLevelHelp(level('P1', 'put')), /przeliczony ze strike’u ETF/);
});
