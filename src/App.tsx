import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, RefreshCw, Search } from 'lucide-react';
import { ColorType, createChart, LineStyle, type UTCTimestamp } from 'lightweight-charts';

type Contract = {
  contractSymbol: string;
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  change: number;
  percentChange: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  inTheMoney: boolean;
};

type HistoryPoint = { time: number; close: number };
type ChartPoint = { time: number; value: number };
type ChartLevel = { price: number; color: string; title: string };

type Chain = {
  symbol: string;
  quote: { price: number | null; previousClose: number | null; changePercent: number | null; currency: string };
  expirations: number[];
  selectedExpiration: number | null;
  calls: Contract[];
  puts: Contract[];
  history: HistoryPoint[];
  overnightHistory: HistoryPoint[];
  chartError: string | null;
  overnightError: string | null;
  previousDayHigh: number | null;
  previousDayDate: string | null;
  qqqPreviousDayHigh: number | null;
  qqqPreviousDayDate: string | null;
  futuresPreviousDayHigh: number | null;
  futuresPreviousDayDate: string | null;
  fetchedAt: string;
};

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const WALL_TOLERANCE = 0.04;
const instruments = [
  { symbol: 'SPY', label: 'SPY', option: 'SPY · S&P 500 ETF', description: 'SPDR S&P 500 ETF Trust' },
  { symbol: 'QQQ', label: 'QQQ', option: 'QQQ · Nasdaq-100 ETF', description: 'Invesco QQQ Trust · Nasdaq-100 ETF' },
  { symbol: '^NDX', label: 'NDX', option: 'NDX · Nasdaq-100 Index', description: 'Nasdaq-100 index options' },
  { symbol: '^SPX', label: 'SPX', option: 'SPX · S&P 500 Index', description: 'S&P 500 index options' },
  { symbol: 'DIA', label: 'DIA', option: 'DIA · Dow ETF / US30', description: 'SPDR Dow Jones Industrial Average ETF Trust · US30 proxy' },
];

function display(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function expirationLabel(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function todayExpiration() {
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

function heat(value: number, maximum: number, side: 'call' | 'put') {
  const intensity = maximum > 0 ? Math.sqrt(value / maximum) : 0;
  const color = side === 'call' ? `37, 178, 129, ${intensity * 0.2}` : `237, 105, 86, ${intensity * 0.2}`;
  return { backgroundColor: `rgba(${color})` };
}

function PriceChart({
  title,
  source,
  subtitle,
  points,
  levels,
  lineColor,
  legend,
}: {
  title: string;
  source: string;
  subtitle: string;
  points: ChartPoint[];
  levels: ChartLevel[];
  lineColor: string;
  legend: { title: string; color: string }[];
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
    <section className="chart-panel" aria-label={`${title} intraday price chart`}>
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

export default function App() {
  const [symbol, setSymbol] = useState('QQQ');
  const [us100CfdHigh, setUs100CfdHigh] = useState('');
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiration, setExpiration] = useState(todayExpiration());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const requestIdRef = useRef(0);
  const activeInstrument = instruments.find((instrument) => instrument.symbol === symbol);

  async function loadChain(nextSymbol = symbol, date = todayExpiration(), refresh = false) {
    const requestId = ++requestIdRef.current;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    setExpiration(date);
    try {
      const params = new URLSearchParams({ symbol: nextSymbol });
      if (date) params.set('date', date);
      const response = await fetch(`/api/options?${params}`, { cache: 'no-store' });
      const payload = await response.json();
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      setChain(payload as Chain);
      setExpiration(String(payload.selectedExpiration || payload.expirations?.[0] || ''));
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }));
    } catch (requestError) {
      if (requestId === requestIdRef.current) {
        setError(requestError instanceof Error ? requestError.message : 'Nie udało się pobrać danych.');
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    void loadChain('QQQ', todayExpiration(), false);
  }, []);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      void loadChain(symbol, todayExpiration(), true);
    }, 5 * 60 * 1000);

    return () => window.clearInterval(refreshTimer);
  }, [symbol]);

  const strikes = useMemo(() => {
    const callMap = new Map((chain?.calls ?? []).map((contract) => [contract.strike, contract]));
    const putMap = new Map((chain?.puts ?? []).map((contract) => [contract.strike, contract]));
    const allStrikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
    return allStrikes.map((strike) => ({ strike, call: callMap.get(strike), put: putMap.get(strike) }));
  }, [chain]);

  const price = chain?.quote.price;
  const walls = useMemo(() => {
    function strongest(contracts: Contract[], direction: 'above' | 'below') {
      if (price === null || price === undefined || price <= 0) return [];
      const minimum = price * (1 - WALL_TOLERANCE);
      const maximum = price * (1 + WALL_TOLERANCE);
      return contracts
        .filter((contract) => Number.isFinite(contract.openInterest) && contract.openInterest > 0)
        .filter((contract) => direction === 'above'
          ? contract.strike > price && contract.strike <= maximum
          : contract.strike < price && contract.strike >= minimum)
        .sort((left, right) => right.openInterest - left.openInterest || Math.abs(left.strike - price) - Math.abs(right.strike - price))
        .slice(0, 4)
        .sort((left, right) => left.strike - right.strike);
    }

    return {
      call: strongest(chain?.calls ?? [], 'above'),
      put: strongest(chain?.puts ?? [], 'below'),
    };
  }, [chain, price]);
  const wallStrikes = new Set([...walls.call, ...walls.put].map((wall) => wall.strike));
  const wallRows = strikes.filter((row) => wallStrikes.has(row.strike));
  const openInterest = (contract: Contract) => Number.isFinite(contract.openInterest) ? contract.openInterest : 0;
  const maxOi = Math.max(0, ...(chain?.calls ?? []).map(openInterest), ...(chain?.puts ?? []).map(openInterest));
  const callOi = (chain?.calls ?? []).reduce((total, item) => total + openInterest(item), 0);
  const putOi = (chain?.puts ?? []).reduce((total, item) => total + openInterest(item), 0);
  const putCallRatio = callOi ? putOi / callOi : null;
  const changePositive = (chain?.quote.changePercent ?? 0) >= 0;
  const conversionFactor = Number(us100CfdHigh) > 0 && chain?.previousDayHigh
    ? Number(us100CfdHigh) / chain.previousDayHigh
    : null;
  const qqqConversionFactor = Number(us100CfdHigh) > 0 && chain?.qqqPreviousDayHigh
    ? Number(us100CfdHigh) / chain.qqqPreviousDayHigh
    : null;
  const cfdLevels = [
    ...walls.put.map((contract, index) => ({ contract, side: 'put' as const, label: `P${index + 1}` })),
    ...walls.call.map((contract, index) => ({ contract, side: 'call' as const, label: `C${index + 1}` })),
  ];
  const levelValues = [...walls.put.map((wall) => wall.strike), price, ...walls.call.map((wall) => wall.strike)]
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const levelMinimum = levelValues.length ? Math.min(...levelValues) : 0;
  const levelMaximum = levelValues.length ? Math.max(...levelValues) : 1;
  const levelSpan = levelMaximum - levelMinimum || Math.max(Math.abs(levelMinimum) * 0.04, 1);
  const scaleMinimum = Math.max(0, levelMinimum - levelSpan * 0.12);
  const scaleMaximum = levelMaximum + levelSpan * 0.12;
  const levelPosition = (value: number) => `${((value - scaleMinimum) / (scaleMaximum - scaleMinimum)) * 100}%`;
  const wallDistance = (wall: Contract) => price ? (wall.strike / price - 1) * 100 : null;
  const cfdScale = Number(us100CfdHigh) > 0 && chain?.futuresPreviousDayHigh
    ? Number(us100CfdHigh) / chain.futuresPreviousDayHigh
    : 1;
  const toCfdLevel = (value: number) => conversionFactor === null || !chain?.previousDayHigh
    ? null
    : Number(us100CfdHigh) * value / chain.previousDayHigh;
  const cfdChartLevels = useMemo(() => {
    const mapped = (value: number) => conversionFactor === null || !chain?.previousDayHigh
      ? null
      : Number(us100CfdHigh) * value / chain.previousDayHigh;
    return [
      ...(conversionFactor !== null ? walls.put.flatMap((wall, index) => {
        const mappedPrice = mapped(wall.strike);
        return mappedPrice === null ? [] : [{ price: mappedPrice, color: '#f18270', title: `P${index + 1}` }];
      }) : []),
      ...(price !== null && price !== undefined && mapped(price) !== null ? [{ price: mapped(price)!, color: '#d8e2da', title: 'SPOT' }] : []),
      ...(Number(us100CfdHigh) > 0 ? [{ price: Number(us100CfdHigh), color: '#f3c969', title: 'CFD PDH' }] : chain?.futuresPreviousDayHigh ? [{ price: chain.futuresPreviousDayHigh, color: '#f3c969', title: 'NQ PDH' }] : []),
      ...(conversionFactor !== null ? walls.call.flatMap((wall, index) => {
        const mappedPrice = mapped(wall.strike);
        return mappedPrice === null ? [] : [{ price: mappedPrice, color: '#55c99b', title: `C${index + 1}` }];
      }) : []),
    ];
  }, [walls, price, chain?.previousDayHigh, chain?.futuresPreviousDayHigh, conversionFactor, us100CfdHigh]);
  const instrumentChartPoints = useMemo(() => (chain?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.history]);
  const instrumentChartLevels = useMemo(() => [
    ...walls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}` })),
    ...(price !== null && price !== undefined ? [{ price, color: '#d8e2da', title: 'SPOT' }] : []),
    ...(chain?.previousDayHigh ? [{ price: chain.previousDayHigh, color: '#f3c969', title: 'PDH' }] : []),
    ...walls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}` })),
  ], [walls, price, chain?.previousDayHigh]);
  const overnightChartPoints = useMemo(() => (chain?.overnightHistory ?? []).map(({ time, close }) => ({ time, value: close * cfdScale })), [chain?.overnightHistory, cfdScale]);

  function selectInstrument(nextSymbol: string) {
    setSymbol(nextSymbol);
    setExpiration('');
    setChain(null);
    void loadChain(nextSymbol, todayExpiration());
  }

  return (
    <main className="desk">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Market Desk home">
          <span className="brand-mark"><Activity size={17} strokeWidth={2.2} /></span>
          <span>MARKET<span className="brand-light">DESK</span></span>
        </a>
        <div className="topbar-right"><span className="live-dot" /> OPTIONS MARKET <span className="topbar-divider" /> US EQUITIES</div>
      </header>

      <section className="instrument-head">
        <div className="instrument-title">
          <div className="eyebrow">OPTION CHAIN <span className="eyebrow-line" /></div>
          <div className="title-row">
            <h1>{activeInstrument?.label ?? symbol}</h1>
            <span className="exchange-tag">NASDAQ</span>
            {price !== null && price !== undefined && <span className="price">${display(price)}</span>}
            {chain?.quote.changePercent !== null && chain?.quote.changePercent !== undefined && (
              <span className={`price-change ${changePositive ? 'positive' : 'negative'}`}>
                {changePositive ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{display(Math.abs(chain.quote.changePercent), 2)}%
              </span>
            )}
          </div>
          <p className="instrument-subtitle">{activeInstrument?.description ?? symbol}</p>
        </div>
        <label className="symbol-search">
          <Search size={16} aria-hidden="true" />
          <select aria-label="Instrument" value={symbol} onChange={(event) => selectInstrument(event.target.value)}>
            {instruments.map((instrument) => <option value={instrument.symbol} key={instrument.symbol}>{instrument.option}</option>)}
          </select>
          <ChevronDown className="instrument-chevron" size={14} aria-hidden="true" />
        </label>
      </section>

      <section className="toolbar" aria-label="Chain filters">
        <div className="select-wrap">
          <span className="control-label">EXPIRATION</span>
          <strong className="today-expiry">0DTE · {expirationLabel(Number(expiration))}</strong>
        </div>
        <div className="toolbar-meta">
          <span className="contract-count">{numberFormat.format(wallRows.length)} wall levels</span>
          <span className="toolbar-separator" />
          <span>AUTO · 5 MIN</span>
          <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void loadChain(symbol, todayExpiration(), true)} title="Refresh chain and chart" aria-label="Refresh chain and chart" disabled={loading || refreshing}>
            <RefreshCw size={15} />
          </button>
        </div>
      </section>

      <section className="metrics" aria-label="Open interest summary">
        <article className="metric">
          <span className="metric-label">CALL OPEN INTEREST</span>
          <strong className="metric-value">{chain ? compactFormat.format(callOi) : '—'}</strong>
          <span className="metric-detail call-color">CALLS</span>
        </article>
        <article className="metric">
          <span className="metric-label">PUT OPEN INTEREST</span>
          <strong className="metric-value">{chain ? compactFormat.format(putOi) : '—'}</strong>
          <span className="metric-detail put-color">PUTS</span>
        </article>
        <article className="metric ratio-metric">
          <span className="metric-label">PUT / CALL RATIO</span>
          <strong className="metric-value">{putCallRatio === null ? '—' : display(putCallRatio, 2)}</strong>
          <span className="metric-detail">OPEN INTEREST</span>
        </article>
        <article className="metric quote-metric">
          <span className="metric-label">UNDERLYING</span>
          <strong className="metric-value">{price === null || price === undefined ? '—' : `$${display(price)}`}</strong>
          <span className="metric-detail">{chain?.quote.currency ?? 'USD'} · {updatedAt || 'WAITING FOR DATA'}</span>
        </article>
      </section>

      <div className="chart-pair">
        <PriceChart
          title={activeInstrument?.label ?? symbol}
          source={`${symbol} · 5 MIN`}
          subtitle="TODAY · PRE/POST-MARKET · WALLS + PDH"
          points={instrumentChartPoints}
          levels={instrumentChartLevels}
          lineColor="#55c99b"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'PDH', color: '#f3c969' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />
        <PriceChart
          title="US100 overnight"
          source="NQ=F · 5 MIN"
          subtitle="FUTURES · NORMALIZED TO CFD HIGH"
          points={overnightChartPoints}
          levels={cfdChartLevels}
          lineColor="#e0ad5a"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: Number(us100CfdHigh) > 0 ? 'CFD PDH' : 'NQ PDH', color: '#f3c969' }, { title: 'CFD SPOT', color: '#d8e2da' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />
      </div>

      <section className="levels-panel standalone-levels" aria-label="Option wall price levels">
        <div className="levels-heading">
          <div><h2>Key levels</h2><span className="chain-caption">TOP 4 CALLS + PUTS WITHIN ±4% SPOT · BY OPEN INTEREST</span></div>
          <span className="levels-symbol">{chain?.symbol ?? symbol} · {expiration ? expirationLabel(Number(expiration)) : '—'}</span>
        </div>
        <div className="levels-rows">
          {walls.put.map((wall, index) => <div className="level-row put-level" key={`put-${wall.strike}`}>
            <span className="level-name">PUT {index + 1}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.strike) }} /></div>
            <strong className="level-price">${display(wall.strike)}</strong>
            <span className="level-distance">{display(wallDistance(wall))}%</span>
          </div>)}
          <div className="level-row spot-level">
            <span className="level-name">SPOT</span>
            <div className="level-track"><span className="level-marker" style={price !== null && price !== undefined ? { left: levelPosition(price) } : undefined} /></div>
            <strong className="level-price">{price === null || price === undefined ? '—' : `$${display(price)}`}</strong>
            <span className="level-distance">UNDERLYING</span>
          </div>
          {walls.call.map((wall, index) => <div className="level-row call-level" key={`call-${wall.strike}`}>
            <span className="level-name">CALL {index + 1}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.strike) }} /></div>
            <strong className="level-price">${display(wall.strike)}</strong>
            <span className="level-distance">{display(wallDistance(wall))}%</span>
          </div>)}
        </div>
      </section>

      <section className="cfd-panel" aria-label="US100 CFD wall conversion">
        <div className="cfd-heading">
          <div><h2>US100 CFD conversion</h2><span className="chain-caption">MAP OPTION LEVELS FROM THE PREVIOUS SESSION HIGH</span></div>
          <span className="expiry-badge">{activeInstrument?.label ?? symbol} · 0DTE</span>
        </div>
        <div className="cfd-inputs">
          <label className="cfd-anchor-input">
            <span className="metric-label">YOUR US100 CFD · PREVIOUS HIGH</span>
            <div className="number-input-wrap"><span>US100</span><input aria-label="US100 CFD previous-day high" type="number" min="0" step="0.1" inputMode="decimal" placeholder="Enter yesterday high" value={us100CfdHigh} onChange={(event) => setUs100CfdHigh(event.target.value)} /></div>
          </label>
          <div className="reference-high">
            <span className="metric-label">{activeInstrument?.label ?? symbol} · PREVIOUS SESSION HIGH</span>
            <strong>{chain?.previousDayHigh ? `$${display(chain.previousDayHigh)}` : '—'}</strong>
            <span>{chain?.previousDayDate ?? 'Waiting for daily data'}</span>
          </div>
          <div className="reference-high qqq-reference-high">
            <span className="metric-label">QQQ · PREVIOUS SESSION HIGH</span>
            <strong>{chain?.qqqPreviousDayHigh ? `$${display(chain.qqqPreviousDayHigh)}` : '—'}</strong>
            <span>{chain?.qqqPreviousDayDate ?? 'Waiting for daily data'} · {qqqConversionFactor ? `×${display(qqqConversionFactor, 3)}` : 'enter CFD high'}</span>
          </div>
          <p className="conversion-formula">US100 level = your CFD high × option strike ÷ selected instrument's previous-session high. NQ=F is normalized to the same CFD high.</p>
        </div>
        <div className="conversion-table-wrap">
          <table className="conversion-table">
            <thead><tr><th>LEVEL</th><th>OPTION STRIKE</th><th>VS PREV. HIGH</th><th>US100 CFD LEVEL</th></tr></thead>
            <tbody>
              {cfdLevels.length ? cfdLevels.map(({ contract, side, label }) => {
                const convertedLevel = toCfdLevel(contract.strike);
                const relativeToHigh = chain?.previousDayHigh ? (contract.strike / chain.previousDayHigh - 1) * 100 : null;
                return <tr key={label}>
                  <td className={side === 'put' ? 'put-conversion' : 'call-conversion'}>{label}</td>
                  <td>{display(contract.strike)}</td>
                  <td>{relativeToHigh === null ? '—' : `${display(relativeToHigh)}%`}</td>
                  <td className="converted-level">{convertedLevel === null ? 'Enter CFD high' : display(convertedLevel)}</td>
                </tr>;
              }) : <tr><td className="conversion-empty" colSpan={4}>No 0DTE wall levels for this instrument today.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="chain-panel" aria-label="Options chain">
        <div className="chain-heading">
          <div><h2>Wall strikes</h2><span className="chain-caption">TOP 4 CALLS ABOVE · TOP 4 PUTS BELOW · WITHIN ±4% SPOT</span></div>
          <span className="expiry-badge">{expiration ? expirationLabel(Number(expiration)) : 'SELECT EXPIRATION'}</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr className="group-head">
                <th className="call-group" colSpan={5}>CALLS</th>
                <th className="strike-heading" rowSpan={2}>STRIKE</th>
                <th className="put-group" colSpan={5}>PUTS</th>
              </tr>
              <tr className="column-head">
                <th>OPEN INT.</th><th>VOLUME</th><th>IV</th><th>BID</th><th>ASK</th>
                <th>BID</th><th>ASK</th><th>IV</th><th>VOLUME</th><th>OPEN INT.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td className="table-message" colSpan={11}><span className="loader" /> Loading option chain</td></tr>
                : error ? <tr><td className="table-message error-message" colSpan={11}>{error}</td></tr>
                  : wallRows.length === 0 ? <tr><td className="table-message" colSpan={11}>No wall levels found for this expiration.</td></tr>
                    : wallRows.map(({ strike, call, put }) => {
                      const callRank = walls.call.findIndex((wall) => wall.strike === strike);
                      const putRank = walls.put.findIndex((wall) => wall.strike === strike);
                      return <tr key={strike}>
                        <td className="call-cell oi-cell" style={heat(call?.openInterest ?? 0, maxOi, 'call')}>{call ? compactFormat.format(call.openInterest) : '—'}</td>
                        <td className="call-cell">{call ? compactFormat.format(call.volume) : '—'}</td>
                        <td className="call-cell">{call ? percentFormat.format(call.impliedVolatility) : '—'}</td>
                        <td className="call-cell quote-cell">{call ? display(call.bid) : '—'}</td>
                        <td className="call-cell quote-cell">{call ? display(call.ask) : '—'}</td>
                        <td className="strike-cell">
                          <span>{numberFormat.format(strike)}</span>
                          <span className="wall-tags">
                            {putRank >= 0 && <span className="wall-tag put-tag">P{putRank + 1}</span>}
                            {callRank >= 0 && <span className="wall-tag call-tag">C{callRank + 1}</span>}
                          </span>
                        </td>
                        <td className="put-cell quote-cell">{put ? display(put.bid) : '—'}</td>
                        <td className="put-cell quote-cell">{put ? display(put.ask) : '—'}</td>
                        <td className="put-cell">{put ? percentFormat.format(put.impliedVolatility) : '—'}</td>
                        <td className="put-cell">{put ? compactFormat.format(put.volume) : '—'}</td>
                        <td className="put-cell oi-cell" style={heat(put?.openInterest ?? 0, maxOi, 'put')}>{put ? compactFormat.format(put.openInterest) : '—'}</td>
                      </tr>;
                    })}
            </tbody>
          </table>
        </div>
        <footer className="panel-footer"><span>DATA: YAHOO FINANCE</span><span>{updatedAt ? `UPDATED ${updatedAt}` : 'AWAITING MARKET DATA'} · DELAYED DATA MAY APPLY</span></footer>
      </section>
      <footer className="page-footer"><span>Market Desk</span><span>For informational purposes only. Not investment advice.</span></footer>
    </main>
  );
}