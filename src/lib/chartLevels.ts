import type { ChartLevel, ChartPoint } from '../types';

export function selectChartLevels(levels: ChartLevel[], spot: number | null, showAllWalls: boolean, showGex: boolean): ChartLevel[] {
  const available = levels.filter((level) => Number.isFinite(level.price) && (showGex || level.kind !== 'gex'));
  if (showAllWalls || spot === null || !Number.isFinite(spot)) return available;

  const selected = new Set(
    (['put', 'call'] as const).flatMap((kind) => available
      .filter((level) => level.kind === kind)
      .sort((left, right) => Math.abs(left.price - spot) - Math.abs(right.price - spot))
      .slice(0, 2)),
  );
  return available.filter((level) => (level.kind !== 'put' && level.kind !== 'call') || selected.has(level));
}

export function chartScaleBounds(points: ChartPoint[], levels: ChartLevel[], spot: number): { min: number; max: number } {
  const nearby = levels.filter((level) => Math.abs(level.price - spot) <= Math.abs(spot) * 0.005);
  const values = [...points.map((point) => point.value), ...nearby.map((level) => level.price)].filter(Number.isFinite);
  return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: spot, max: spot };
}

export function groupChartLevels(levels: ChartLevel[], min: number, max: number, height: number): ChartLevel[][] {
  const threshold = Math.max(0, max - min) * 18 / (Math.max(height, 1) * 0.76);
  const groups: ChartLevel[][] = [];
  for (const level of [...levels].sort((left, right) => left.price - right.price)) {
    const lastGroup = groups.at(-1);
    if (lastGroup && level.price - lastGroup[0].price <= threshold) lastGroup.push(level);
    else groups.push([level]);
  }
  return groups;
}

export function chartLevelLabels(levels: ChartLevel[], groups: ChartLevel[][]): Map<ChartLevel, { title: string; axisLabelVisible: boolean }> {
  const labels = new Map(levels.map((level) => [level, { title: level.title, axisLabelVisible: true }]));
  for (const group of groups) {
    if (group.length < 2) continue;
    const anchor = group.find((level) => level.title === 'SPOT') ?? group[0];
    group.forEach((level) => {
      labels.set(level, {
        title: level === anchor ? `${[anchor, ...group.filter((item) => item !== anchor)].map((item) => item.title).join(' / ')} *` : '',
        axisLabelVisible: level === anchor,
      });
    });
  }
  return labels;
}
