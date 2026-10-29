import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_TIME_ZONE, chartTimeFormatters, isValidTimeZone, readTimeZonePreference, TIME_ZONE_STORAGE_KEY, timeZoneOptions } from '../src/lib/timeZone.ts';

const timestamp = (value) => Date.parse(value) / 1000;
const point = (time) => ({ time, value: 100 });

test('axes and crosshair display the same instant in the chosen zone without changing timestamps', () => {
  const time = timestamp('2026-10-29T14:30:00Z');
  const points = [point(time)];
  const utc = chartTimeFormatters('UTC', points);
  const warsaw = chartTimeFormatters('Europe/Warsaw', points);
  const newYork = chartTimeFormatters('America/New_York', points);

  assert.equal(utc.tickMarkFormatter(time), '14:30');
  assert.equal(warsaw.tickMarkFormatter(time), '15:30');
  assert.equal(newYork.tickMarkFormatter(time), '10:30');
  assert.match(warsaw.timeFormatter(time), /29 Oct 2026, 15:30 GMT\+1/);
  assert.match(newYork.timeFormatter(time), /29 Oct 2026, 10:30 GMT-4/);
  assert.equal(points[0].time, time);
});

test('handles spring and autumn DST changes, distinguishing repeated local hours', () => {
  const spring = [timestamp('2026-03-29T00:30:00Z'), timestamp('2026-03-29T01:30:00Z')];
  const springFormat = chartTimeFormatters('Europe/Warsaw', spring.map(point));
  assert.equal(springFormat.tickMarkFormatter(spring[0]), '01:30 GMT+1');
  assert.equal(springFormat.tickMarkFormatter(spring[1]), '03:30 GMT+2');

  const autumn = [timestamp('2026-10-25T00:30:00Z'), timestamp('2026-10-25T01:30:00Z')];
  const autumnFormat = chartTimeFormatters('Europe/Warsaw', autumn.map(point));
  assert.equal(autumnFormat.tickMarkFormatter(autumn[0]), '02:30 GMT+2');
  assert.equal(autumnFormat.tickMarkFormatter(autumn[1]), '02:30 GMT+1');
  assert.match(autumnFormat.timeFormatter(autumn[0]), /02:30 GMT\+2/);
  assert.match(autumnFormat.timeFormatter(autumn[1]), /02:30 GMT\+1/);
});

test('crosshair includes the local date across midnight and leaves date-only values alone', () => {
  const time = timestamp('2026-03-29T00:30:00Z');
  const format = chartTimeFormatters('America/New_York', [point(time)]);
  assert.match(format.timeFormatter(time), /28 Mar 2026, 20:30 GMT-4/);
  assert.equal(format.tickMarkFormatter('2026-03-29'), null);
  assert.equal(format.timeFormatter({ year: 2026, month: 3, day: 29 }), '2026-03-29');
});

test('restores valid preferences and explicitly reports invalid stored zones', () => {
  const storage = (value) => ({ getItem: (key) => { assert.equal(key, TIME_ZONE_STORAGE_KEY); return value; } });
  assert.deepEqual(readTimeZonePreference(storage(null)), { selection: BROWSER_TIME_ZONE, warning: null });
  assert.deepEqual(readTimeZonePreference(storage('America/New_York')), { selection: 'America/New_York', warning: null });
  const invalid = readTimeZonePreference(storage('Not/A_Zone'));
  assert.equal(invalid.selection, BROWSER_TIME_ZONE);
  assert.match(invalid.warning, /nieprawidłowa/);
  assert.equal(isValidTimeZone('Not/A_Zone'), false);
  assert.ok(timeZoneOptions('Europe/Warsaw', BROWSER_TIME_ZONE).includes('UTC'));
  assert.ok(timeZoneOptions('Europe/Warsaw', BROWSER_TIME_ZONE).includes('Europe/Warsaw'));
});
