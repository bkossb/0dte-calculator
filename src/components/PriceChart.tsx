import { useEffect, useRef } from 'react';
import { ColorType, createChart, LineStyle, type UTCTimestamp } from 'lightweight-charts';
import type { ChartLevel, ChartPoint } from '../types';

export function PriceChart({
  title,
  source,
  subtitle,
  points,
  levels,
  lineColor,
  legend,
  size = 'compact',
}: {
  title: string;
  source: string;
  subtitle: string;
  points: ChartPoint[];
  levels: ChartLevel[];
  lineColor: string;
  legend: { title: string; color: string }[];
  size?: 'compact' | 'featured';
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !points.length) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: { background: { type: ColorType.Solid, color: '#151c18' }, textColor: '#829087', fontFamily: 'DM Mono, monospace', fontSize: 10 },
      grid: { vertLines: { color: '#202a24' }, horzLines: { color: '#202a24' } },
      rightPriceScale: { borderColor: '#2a342e', scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: '#2a342e', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#617469', style: LineStyle.Dotted }, horzLine: { color: '#617469', style: LineStyle.Dotted } },
    });
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

    if (levels.length) {
      const allValues = [...points.map((point) => point.value), ...levels.map((level) => level.price)];
      const scaleSeries = chart.addLineSeries({
        color: 'rgba(0, 0, 0, 0)',
        lineVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      scaleSeries.setData([
        { time: chartData[0].time, value: Math.min(...allValues) },
        { time: chartData[chartData.length - 1].time, value: Math.max(...allValues) },
      ]);
    }
    levels.forEach((level) => priceSeries.createPriceLine({
      price: level.price,
      color: level.color,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: level.title,
    }));
    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.applyOptions({ width, height });
    });
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [points, levels, lineColor]);

  return (
    <section className={`chart-panel ${size === 'featured' ? 'chart-featured' : 'chart-compact'}`} aria-label={`${title} intraday price chart`}>
      <div className="chart-heading">
        <div><h2>{title} <span className="chart-source">{source}</span></h2><span className="chain-caption">{subtitle}</span></div>
        <span className="expiry-badge">1D</span>
      </div>
      {points.length ? <div className="chart-canvas" ref={containerRef} /> : <div className="chart-empty">Intraday history is unavailable.</div>}
      <div className="chart-legend">
        {legend.map((item) => <span key={item.title}><i className="legend-dot" style={{ backgroundColor: item.color }} />{item.title}</span>)}
      </div>
    </section>
  );
}
