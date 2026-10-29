import { useEffect, useMemo, useRef, useState } from 'react';
import { ColorType, createChart, LineStyle, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { chartLevelLabels, chartScaleBounds, groupChartLevels, selectChartLevels } from '../lib/chartLevels';
import { display } from '../lib/format';
import { chartLevelHelp } from '../lib/helpText';
import { chartTimeFormatters } from '../lib/timeZone';
import type { ChartLevel, ChartPoint } from '../types';
import { HelpTip } from './HelpTip';

export function PriceChart({
  title,
  source,
  subtitle,
  points,
  levels,
  spot,
  showAllWalls,
  showGex,
  timeZone,
  levelDetails,
  lineColor,
  legend,
  size = 'compact',
}: {
  title: string;
  source: string;
  subtitle: string;
  points: ChartPoint[];
  levels: ChartLevel[];
  spot: number | null;
  showAllWalls: boolean;
  showGex: boolean;
  timeZone: string;
  levelDetails?: (level: ChartLevel) => string;
  lineColor: string;
  legend: { title: string; color: string; help: string }[];
  size?: 'compact' | 'featured';
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const timeFormatters = useMemo(() => chartTimeFormatters(timeZone, points), [timeZone, points]);
  const timeFormattersRef = useRef(timeFormatters);
  timeFormattersRef.current = timeFormatters;
  const [chartHeight, setChartHeight] = useState(340);
  const chartSpot = spot !== null && Number.isFinite(spot) ? spot : points.at(-1)?.value ?? 0;
  const visibleLevels = useMemo(() => selectChartLevels(levels, chartSpot, showAllWalls, showGex), [levels, chartSpot, showAllWalls, showGex]);
  const bounds = useMemo(() => chartScaleBounds(points, visibleLevels, chartSpot), [points, visibleLevels, chartSpot]);
  const margin = (bounds.max - bounds.min) * 0.12 / 0.76;
  const onScaleLevels = useMemo(() => visibleLevels.filter((level) => level.price >= bounds.min - margin && level.price <= bounds.max + margin), [visibleLevels, bounds, margin]);
  const groups = useMemo(() => groupChartLevels(onScaleLevels, bounds.min, bounds.max, chartHeight).filter((group) => group.length > 1), [onScaleLevels, bounds, chartHeight]);
  const labels = useMemo(() => chartLevelLabels(visibleLevels, groups), [visibleLevels, groups]);
  const outsideLevels = useMemo(() => visibleLevels.filter((level) => level.price < bounds.min - margin || level.price > bounds.max + margin), [visibleLevels, bounds, margin]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !points.length) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#151c18' }, textColor: '#829087', fontFamily: 'DM Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: '#202a24' }, horzLines: { color: '#202a24' } },
      rightPriceScale: { borderColor: '#2a342e', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: '#2a342e', timeVisible: true, secondsVisible: false, tickMarkFormatter: timeFormattersRef.current.tickMarkFormatter },
      localization: { timeFormatter: timeFormattersRef.current.timeFormatter },
      crosshair: { vertLine: { color: '#617469', style: LineStyle.Dotted }, horzLine: { color: '#617469', style: LineStyle.Dotted } },
    });
    chartRef.current = chart;
    const priceSeries = chart.addAreaSeries({
      lineColor,
      topColor: `${lineColor}29`,
      bottomColor: `${lineColor}03`,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const chartData = points.map(({ time, value }) => ({ time: time as UTCTimestamp, value }));
    priceSeries.setData(chartData);

    if (visibleLevels.length && chartData.length > 1) {
      const scaleSeries = chart.addLineSeries({
        color: 'rgba(0, 0, 0, 0)',
        lineVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      scaleSeries.setData([
        { time: chartData[0].time, value: bounds.min },
        { time: chartData[chartData.length - 1].time, value: bounds.max },
      ]);
    }
    visibleLevels.forEach((level) => {
      const label = labels.get(level);
      if (!label) throw new Error(`Missing chart label for ${level.title}`);
      priceSeries.createPriceLine({
        price: level.price,
        color: level.color,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: label.axisLabelVisible,
        title: label.title,
      });
    });
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
      setChartHeight((current) => current === height ? current : height);
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chartRef.current = null;
      chart.remove();
    };
  }, [points, visibleLevels, lineColor, bounds, labels]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { tickMarkFormatter: timeFormatters.tickMarkFormatter },
      localization: { timeFormatter: timeFormatters.timeFormatter },
    });
  }, [timeFormatters]);

  return (
    <section className={`chart-panel ${size === 'featured' ? 'chart-featured' : 'chart-compact'}`} aria-label={`${title} intraday price chart`}>
      <div className="chart-heading">
        <div><h2>{title} <span className="chart-source">{source}</span></h2><span className="chain-caption">{subtitle}</span></div>
        <span className="expiry-badge">1D · {timeZone}</span>
      </div>
      {points.length ? <div className="chart-canvas" ref={containerRef} /> : <div className="chart-empty">Intraday history is unavailable.</div>}
      {points.length > 0 && (groups.length > 0 || outsideLevels.length > 0) && <div className="chart-level-details" aria-label={`${title} grouped and off-scale levels`}>
        {groups.map((group) => <div className="chart-level-group" key={group.map((level) => level.title).join('|')}>
          <strong>* GROUPED · HOVER FOR FULL PRECISION</strong>
          {group.map((level) => <span key={`${level.title}-${level.price}`} title={`${level.title}: ${level.price}`}><i className="legend-dot" style={{ backgroundColor: level.color }} />{level.title}: {display(level.price)}<HelpTip label={`${title}: ${level.title}`} text={`${chartLevelHelp(level)}\n\nWartość: ${level.price}.${levelDetails ? levelDetails(level) : ''}`} /></span>)}
        </div>)}
        {outsideLevels.length > 0 && <div className="chart-level-group">
          <strong>OUTSIDE CHART RANGE</strong>
          {outsideLevels.map((level) => <span key={`${level.title}-${level.price}`} title={`${level.title}: ${level.price}`}><i className="legend-dot" style={{ backgroundColor: level.color }} />{level.title}: {display(level.price)}<HelpTip label={`${title}: ${level.title}`} text={`${chartLevelHelp(level)}\n\nWartość: ${level.price}.${levelDetails ? levelDetails(level) : ''}`} /></span>)}
        </div>}
      </div>}
      <div className="chart-legend">
        {legend.map((item) => <span key={item.title}><i className="legend-dot" style={{ backgroundColor: item.color }} />{item.title}<HelpTip label={`${title}: ${item.title}`} text={item.help} /></span>)}
      </div>
    </section>
  );
}
