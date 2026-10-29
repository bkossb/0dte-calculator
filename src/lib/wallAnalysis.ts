export type WallPosition = 'above' | 'below' | 'at' | 'unknown';

export function wallCashPrice(strike: number, conversion: { factor: number | null } | null): number | null {
  if (!Number.isFinite(strike) || strike <= 0) return null;
  if (conversion === null) return strike;
  const factor = conversion.factor;
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  const price = strike * factor;
  return Number.isFinite(price) && price > 0 ? price : null;
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
