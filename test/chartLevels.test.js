import test from 'node:test';
import assert from 'node:assert/strict';
import { chartLevelLabels, chartScaleBounds, groupChartLevels, selectChartLevels } from '../src/lib/chartLevels.ts';

const level = (title, price, kind) => ({ title, price, kind, color: '#ffffff' });

test('default view selects the two closest walls per side across sources and hides GEX', () => {
  const levels = [
    level('P1', 90, 'put'), level('QQQ P2', 98, 'put'), level('P3', 99, 'put'),
    level('C1', 110, 'call'), level('QQQ C2', 102, 'call'), level('C3', 101, 'call'),
    level('SPOT', 100, 'reference'), level('PDH', 120, 'reference'), level('FLIP', 95, 'gex'),
  ];
  assert.deepEqual(selectChartLevels(levels, 100, false, false).map((item) => item.title),
    ['QQQ P2', 'P3', 'QQQ C2', 'C3', 'SPOT', 'PDH']);
  assert.deepEqual(selectChartLevels(levels, 100, true, true), levels);
  assert.equal(selectChartLevels(levels, 100, true, false).some((item) => item.kind === 'gex'), false);
  assert.equal(selectChartLevels(levels, 100, false, true).some((item) => item.title === 'FLIP'), true);
  assert.equal(selectChartLevels(levels, null, false, false).length, 8);
});

test('distant levels do not expand chart bounds but nearby levels do', () => {
  const points = [{ time: 1, value: 99.9 }, { time: 2, value: 100.1 }];
  const levels = [level('near', 100.4, 'call'), level('far', 120, 'gex')];
  assert.deepEqual(chartScaleBounds(points, levels, 100), { min: 99.9, max: 100.4 });
});

test('groups visually close labels without changing their individual prices', () => {
  const levels = [level('C3', 29800, 'call'), level('QQQ C2', 29801.85, 'call'), level('P1', 29150, 'put')];
  const groups = groupChartLevels(levels, 29100, 30000, 340);
  assert.deepEqual(groups.map((group) => group.map((item) => item.title)), [['P1'], ['C3', 'QQQ C2']]);
  assert.deepEqual(groups[1].map((item) => item.price), [29800, 29801.85]);
  assert.equal(groupChartLevels([level('P2', 715, 'put'), level('C1', 715, 'call')], 710, 720, 340)[0].length, 2);
});

test('grouping does not chain distant endpoints into one group', () => {
  const levels = [level('a', 100, 'put'), level('b', 100.5, 'put'), level('c', 101, 'put')];
  assert.deepEqual(groupChartLevels(levels, 95, 105, 340).map((group) => group.length), [2, 1]);
});

test('one visible combined label identifies every grouped level without changing prices', () => {
  const first = level('C3', 29800, 'call');
  const second = level('QQQ C2', 29801.85, 'call');
  const single = level('SPOT', 29410, 'reference');
  const labels = chartLevelLabels([first, second, single], [[first, second]]);
  assert.deepEqual(labels.get(first), { title: 'C3 / QQQ C2 *', axisLabelVisible: true });
  assert.deepEqual(labels.get(second), { title: '', axisLabelVisible: false });
  assert.deepEqual(labels.get(single), { title: 'SPOT', axisLabelVisible: true });
  assert.equal(first.price, 29800);
  assert.equal(second.price, 29801.85);
});

test('a group containing SPOT uses the spot value as its chart label anchor', () => {
  const put = level('P2', 715, 'put');
  const spot = level('SPOT', 715.48, 'reference');
  const labels = chartLevelLabels([put, spot], [[put, spot]]);
  assert.deepEqual(labels.get(spot), { title: 'SPOT / P2 *', axisLabelVisible: true });
  assert.deepEqual(labels.get(put), { title: '', axisLabelVisible: false });
});
