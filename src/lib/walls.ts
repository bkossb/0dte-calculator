import type { Contract } from '../types';

export function wallMetric(contracts: Contract[]) {
  const hasOpenInterest = contracts.some((contract) => Number.isFinite(contract.openInterest) && contract.openInterest > 0);
  return (contract: Contract) => {
    const openInterest = Number.isFinite(contract.openInterest) ? contract.openInterest : 0;
    const volume = Number.isFinite(contract.volume) ? contract.volume : 0;
    return hasOpenInterest && openInterest > 0 ? openInterest : volume;
  };
}

export function selectWallContracts(contracts: Contract[], spot: number | null, direction: 'above' | 'below', tolerance: number, leaderThreshold = 0.33, maxWalls = 3, minMetric = 0) {
  if (spot === null || spot <= 0) return [];
  const minimum = spot * (1 - tolerance);
  const maximum = spot * (1 + tolerance);
  const metric = wallMetric(contracts);
  const inBand = contracts
    .filter((contract) => metric(contract) >= minMetric)
    .filter((contract) => contract.strike >= minimum && contract.strike <= maximum);
  const dominant = inBand
    .filter((contract) => direction === 'above' ? contract.strike <= spot : contract.strike >= spot)
    .filter((contract) => metric(contract) >= 50)
    .sort((left, right) => metric(right) - metric(left))
    .slice(0, 1);
  const dominantStrikes = new Set(dominant.map((contract) => contract.strike));
  const candidates = inBand
    .filter((contract) => direction === 'above'
      ? contract.strike > spot && !dominantStrikes.has(contract.strike)
      : contract.strike < spot && !dominantStrikes.has(contract.strike))
    .sort((left, right) => metric(right) - metric(left) || Math.abs(left.strike - spot) - Math.abs(right.strike - spot));
  const leader = candidates[0] ? metric(candidates[0]) : 0;
  const significant = candidates.filter((contract) => metric(contract) >= leader * leaderThreshold);
  const minimumCount = Math.min(2, candidates.length);
  const selected = significant.length >= minimumCount
    ? significant
    : [...significant, ...candidates.filter((contract) => !significant.includes(contract))].slice(0, minimumCount);
  return [...dominant, ...selected.slice(0, maxWalls - dominant.length)]
    .sort((left, right) => left.strike - right.strike);
}
