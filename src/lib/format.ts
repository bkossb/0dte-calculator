export const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

export function display(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function compact(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : compactFormat.format(value);
}

export function percentage(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : percentFormat.format(value);
}

export function expirationLabel(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

export function todayExpiration() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return String(Date.UTC(year, month - 1, day) / 1000);
}

export function heat(value: number, maximum: number, side: 'call' | 'put') {
  const intensity = maximum > 0 ? Math.sqrt(value / maximum) : 0;
  const color = side === 'call' ? `37, 178, 129, ${intensity * 0.2}` : `237, 105, 86, ${intensity * 0.2}`;
  return { backgroundColor: `rgba(${color})` };
}
