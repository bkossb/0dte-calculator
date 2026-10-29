export type WallPosition = 'above' | 'below' | 'at' | 'unknown';
type WallCandidate = {
  label: string;
  side: 'put' | 'call';
  contract: { strike: number };
};
export type SpecialWallMatch = {
  side: 'put' | 'call';
  cashLabel: string;
  etfLabel: string;
  cashPrice: number;
  etfPrice: number;
  differencePct: number;
};

export const SPECIAL_WALL_TOLERANCE = 0.001;

export function wallCashPrice(strike: number, conversion: { factor: number | null } | null): number | null {
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (conversion === null) return strike;
  const factor = conversion.factor;
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  const price = strike * factor;
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function specialWallMatches(cashWalls: WallCandidate[], etfWalls: WallCandidate[], factor: number | null): SpecialWallMatch[] {
  const matches: SpecialWallMatch[] = [];
  for (const cash of cashWalls) {
    const cashPrice = wallCashPrice(cash.contract.strike, null);
    if (cashPrice === null) continue;
    for (const etf of etfWalls) {
      if (cash.side !== etf.side) continue;
      const etfPrice = wallCashPrice(etf.contract.strike, { factor });
      if (etfPrice === null) continue;
      const difference = Math.abs(etfPrice - cashPrice);
      const roundingTolerance = Number.EPSILON * Math.max(cashPrice, etfPrice);
      if (difference <= cashPrice * SPECIAL_WALL_TOLERANCE + roundingTolerance) {
        matches.push({
          side: cash.side,
          cashLabel: cash.label,
          etfLabel: etf.label,
          cashPrice,
          etfPrice,
          differencePct: difference / cashPrice * 100,
        });
      }
    }
  }
  return matches;
}

export function wallPosition(strike: number, spot: number | null | undefined): {
  position: WallPosition;
  offsetPct: number | null;
  scenarios: string[];
} {
  if (!Number.isFinite(strike) || strike <= 0 || spot == null || !Number.isFinite(spot) || spot <= 0) {
    return { position: 'unknown', offsetPct: null, scenarios: [] };
  }
  const offsetPct = (strike / spot - 1) * 100;
  if (strike > spot) {
    return {
      position: 'above',
      offsetPct,
      scenarios: [
        'Odrzucenie poziomu może oznaczać powrót w dół.',
        'Przebicie i utrzymanie powyżej może sprzyjać dalszemu wzrostowi.',
      ],
    };
  }
  if (strike < spot) {
    return {
      position: 'below',
      offsetPct,
      scenarios: [
        'Obrona poziomu może oznaczać odbicie w górę.',
        'Przebicie i utrzymanie poniżej może sprzyjać dalszemu spadkowi.',
      ],
    };
  }
  return {
    position: 'at',
    offsetPct,
    scenarios: [
      'Utrzymanie powyżej poziomu może sprzyjać ruchowi w górę.',
      'Utrzymanie poniżej poziomu może sprzyjać ruchowi w dół.',
    ],
  };
}
