export function etfToCashFactor(
  etfHigh: number | null | undefined,
  etfDate: string | null | undefined,
  cashHigh: number | null | undefined,
  cashDate: string | null | undefined,
): number | null {
  if (etfHigh == null || cashHigh == null || !Number.isFinite(etfHigh) || !Number.isFinite(cashHigh)
    || etfHigh <= 0 || cashHigh <= 0 || !etfDate || etfDate !== cashDate) return null;
  const factor = cashHigh / etfHigh;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}
