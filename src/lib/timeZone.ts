import type { Time } from 'lightweight-charts';
import type { ChartPoint } from '../types';

export const BROWSER_TIME_ZONE = 'browser';
export const TIME_ZONE_STORAGE_KEY = 'market-desk:chart-time-zone';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export function readTimeZonePreference(storage: Pick<Storage, 'getItem'>): { selection: string; warning: string | null } {
  const saved = storage.getItem(TIME_ZONE_STORAGE_KEY);
  if (saved === null || saved === BROWSER_TIME_ZONE) return { selection: BROWSER_TIME_ZONE, warning: null };
  if (isValidTimeZone(saved)) return { selection: saved, warning: null };
  return { selection: BROWSER_TIME_ZONE, warning: `Zapisana strefa „${saved}” jest nieprawidłowa. Używana jest strefa przeglądarki.` };
}

export function timeZoneOptions(browserTimeZone: string, selection: string): string[] {
  const supported = 'supportedValuesOf' in Intl && typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['America/Chicago', 'America/Los_Angeles', 'America/New_York', 'Asia/Tokyo', 'Europe/Berlin', 'Europe/London', 'Europe/Warsaw'];
  return [...new Set(['UTC', browserTimeZone, ...(selection === BROWSER_TIME_ZONE ? [] : [selection]), ...supported])]
    .filter(isValidTimeZone)
    .sort((left, right) => left.localeCompare(right));
}

function nonTimestampLabel(time: Exclude<Time, number>): string {
  return typeof time === 'string' ? time : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function chartTimeFormatters(timeZone: string, points: ChartPoint[]) {
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const offsetFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', timeZoneName: 'shortOffset',
  });
  const crosshairFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset',
  });
  const offsetAt = (timestamp: number) => {
    const offset = offsetFormatter.formatToParts(new Date(timestamp * 1000))
      .find((part) => part.type === 'timeZoneName')?.value;
    if (!offset) throw new Error(`Brak informacji o przesunięciu strefy ${timeZone}.`);
    return offset;
  };
  const offsets = new Set(points.map((point) => offsetAt(point.time)));
  return {
    tickMarkFormatter: (time: Time) => {
      if (typeof time !== 'number') return null;
      const date = new Date(time * 1000);
      return offsets.size > 1 ? `${timeFormatter.format(date)} ${offsetAt(time)}` : timeFormatter.format(date);
    },
    timeFormatter: (time: Time) => typeof time === 'number'
      ? crosshairFormatter.format(new Date(time * 1000))
      : nonTimestampLabel(time),
  };
}
