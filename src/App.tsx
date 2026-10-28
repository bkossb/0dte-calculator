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
type ConfirmationChain = { symbol: string; price: number | null; calls: Contract[]; puts: Contract[]; history: HistoryPoint[] };
type WallConfluence = {
  contract: Contract;
  side: 'put' | 'call';
  label: string;
  offsetPct: number;
  consensusOffsetPct: number;
  consensusStrike: number;
  confirmation: Contract | null;
  confirmationOffsetPct: number | null;
};

type Chain = {
  symbol: string;
  cfdSymbol: string;
  futuresSymbol: string;
  referenceSymbol: string;
  quote: { price: number | null; previousClose: number | null; changePercent: number | null; currency: string };
  expirations: number[];
  selectedExpiration: number | null;
  isNearestExpiration: boolean;
  calls: Contract[];
  puts: Contract[];
  confirmationSymbol: string | null;
  confirmation: ConfirmationChain | null;
  confirmationWarning: string | null;
  optionsError: string | null;
  optionsWarning: string | null;
  history: HistoryPoint[];
  overnightHistory: HistoryPoint[];
  chartError: string | null;
  overnightError: string | null;
  previousDayHigh: number | null;
  previousDayDate: string | null;
  referencePreviousDayHigh: number | null;
  referencePreviousDayDate: string | null;
  futuresPreviousDayHigh: number | null;
  futuresPreviousDayDate: string | null;
  fetchedAt: string;
};

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });
const WALL_TOLERANCE = 0.04;
const CONFLUENCE_TOLERANCE_PCT = 0.5;
const instruments = [
  { symbol: '^NDX', label: 'NDX', exchange: 'NASDAQ', cfdSymbol: 'US100', futuresSymbol: 'NQ=F', option: 'NDX · US100 · QQQ confirm', description: 'Nasdaq-100 index options · QQQ confluence' },
  { symbol: 'SPY', label: 'SPY', exchange: 'NYSE ARCA', cfdSymbol: 'US500', futuresSymbol: 'ES=F', option: 'SPY · US500 · SPX confirm', description: 'S&P 500 ETF options · SPX confluence' },
  { symbol: 'DIA', label: 'DIA', exchange: 'NYSE ARCA', cfdSymbol: 'US30', futuresSymbol: 'YM=F', option: 'DIA · US30', description: 'SPDR Dow Jones Industrial Average ETF Trust · US30' },
  { symbol: 'GLD', label: 'GLD', exchange: 'NYSE ARCA', cfdSymbol: 'XAUUSD', futuresSymbol: 'GC=F', option: 'GLD · XAUUSD', description: 'SPDR Gold Shares · XAUUSD proxy' },
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

function selectWallContracts(contracts: Contract[], spot: number | null, direction: 'above' | 'below') {
  if (spot === null || spot <= 0) return [];
  const minimum = spot * (1 - WALL_TOLERANCE);
  const maximum = spot * (1 + WALL_TOLERANCE);
  return contracts
    .filter((contract) => Number.isFinite(contract.openInterest) && contract.openInterest > 0)
    .filter((contract) => direction === 'above'
      ? contract.strike > spot && contract.strike <= maximum
      : contract.strike < spot && contract.strike >= minimum)
    .sort((left, right) => right.openInterest - left.openInterest || Math.abs(left.strike - spot) - Math.abs(right.strike - spot))
    .slice(0, 4)
    .sort((left, right) => left.strike - right.strike);
}

function PriceChart({
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

export default function App() {
  const [symbol, setSymbol] = useState('^NDX');
  const [cfdPreviousHighs, setCfdPreviousHighs] = useState<Record<string, string>>({ US100: '', US500: '', US30: '', XAUUSD: '' });
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiration, setExpiration] = useState(todayExpiration());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const requestIdRef = useRef(0);
  const activeInstrument = instruments.find((instrument) => instrument.symbol === symbol);
  const cfdSymbol = activeInstrument?.cfdSymbol ?? chain?.cfdSymbol ?? 'US100';
  const futuresSymbol = activeInstrument?.futuresSymbol ?? chain?.futuresSymbol ?? 'NQ=F';
  const cfdPreviousHigh = cfdPreviousHighs[cfdSymbol] ?? '';
  const cfdHigh = Number(cfdPreviousHigh);

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
    void loadChain('^NDX', todayExpiration(), false);
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
    return {
      call: selectWallContracts(chain?.calls ?? [], price ?? null, 'above'),
      put: selectWallContracts(chain?.puts ?? [], price ?? null, 'below'),
    };
  }, [chain, price]);
  const confirmationPrice = chain?.confirmation?.price ?? null;
  const confirmationWalls = useMemo(() => ({
    call: selectWallContracts(chain?.confirmation?.calls ?? [], confirmationPrice, 'above'),
    put: selectWallContracts(chain?.confirmation?.puts ?? [], confirmationPrice, 'below'),
  }), [chain?.confirmation, confirmationPrice]);
  const wallStrikes = new Set([...walls.call, ...walls.put].map((wall) => wall.strike));
  const wallRows = strikes.filter((row) => wallStrikes.has(row.strike));
  const openInterest = (contract: Contract) => Number.isFinite(contract.openInterest) ? contract.openInterest : 0;
  const maxOi = Math.max(0, ...(chain?.calls ?? []).map(openInterest), ...(chain?.puts ?? []).map(openInterest));
  const optionsUnavailableMessage = chain?.optionsError
    ? `${chain.optionsError}${chain.expirations[0] ? ` Najbliższy termin: ${expirationLabel(chain.expirations[0])}.` : ''}`
    : '';
  const changePositive = (chain?.quote.changePercent ?? 0) >= 0;
  const cfdToFuturesFactor = cfdHigh > 0 && chain?.futuresPreviousDayHigh
    ? cfdHigh / chain.futuresPreviousDayHigh
    : null;
  const futuresToReferenceFactor = chain?.futuresPreviousDayHigh && chain.referencePreviousDayHigh
    ? chain.futuresPreviousDayHigh / chain.referencePreviousDayHigh
    : null;
  const referenceToUnderlyingFactor = chain?.referencePreviousDayHigh && chain.previousDayHigh
    ? chain.referencePreviousDayHigh / chain.previousDayHigh
    : null;
  const conversionFactor = cfdToFuturesFactor !== null && futuresToReferenceFactor !== null && referenceToUnderlyingFactor !== null
    ? cfdToFuturesFactor * futuresToReferenceFactor * referenceToUnderlyingFactor
    : null;
  const primaryWalls = [
    ...walls.put.map((contract, index) => ({ contract, side: 'put' as const, label: `P${index + 1}` })),
    ...walls.call.map((contract, index) => ({ contract, side: 'call' as const, label: `C${index + 1}` })),
  ];
  const wallConfluence = useMemo<WallConfluence[]>(() => {
    const confirmation = chain?.confirmation;
    const confirmationPrice = confirmation?.price ?? null;
    const usedConfirmationContracts = new Set<string>();
    const confirmationWalls = {
      put: confirmationPrice ? (confirmation?.puts ?? []).filter((contract) => Number.isFinite(contract.openInterest) && contract.openInterest > 0 && contract.strike < confirmationPrice && contract.strike >= confirmationPrice * (1 - WALL_TOLERANCE)).sort((a, b) => b.openInterest - a.openInterest).slice(0, 4) : [],
      call: confirmationPrice ? (confirmation?.calls ?? []).filter((contract) => Number.isFinite(contract.openInterest) && contract.openInterest > 0 && contract.strike > confirmationPrice && contract.strike <= confirmationPrice * (1 + WALL_TOLERANCE)).sort((a, b) => b.openInterest - a.openInterest).slice(0, 4) : [],
    };

    return primaryWalls.map(({ contract, side, label }) => {
      const offsetPct = price ? (contract.strike / price - 1) * 100 : 0;
      const matches = confirmationPrice
        ? confirmationWalls[side]
          .filter((candidate) => !usedConfirmationContracts.has(candidate.contractSymbol))
          .map((candidate) => ({ contract: candidate, offsetPct: (candidate.strike / confirmationPrice - 1) * 100 }))
          .filter((candidate) => Math.abs(candidate.offsetPct - offsetPct) <= CONFLUENCE_TOLERANCE_PCT)
          .sort((left, right) => Math.abs(left.offsetPct - offsetPct) - Math.abs(right.offsetPct - offsetPct) || right.contract.openInterest - left.contract.openInterest)
        : [];
      const match = matches[0] ?? null;
      if (match) usedConfirmationContracts.add(match.contract.contractSymbol);
      const consensusOffsetPct = match ? (offsetPct + match.offsetPct) / 2 : offsetPct;

      return {
        contract,
        side,
        label,
        offsetPct,
        consensusOffsetPct,
        consensusStrike: price ? price * (1 + consensusOffsetPct / 100) : contract.strike,
        confirmation: match?.contract ?? null,
        confirmationOffsetPct: match?.offsetPct ?? null,
      };
    });
  }, [primaryWalls, chain?.confirmation, price]);
  const cfdLevels = wallConfluence;
  const levelValues = [...wallConfluence.map((wall) => wall.consensusStrike), price]
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const levelMinimum = levelValues.length ? Math.min(...levelValues) : 0;
  const levelMaximum = levelValues.length ? Math.max(...levelValues) : 1;
  const levelSpan = levelMaximum - levelMinimum || Math.max(Math.abs(levelMinimum) * 0.04, 1);
  const scaleMinimum = Math.max(0, levelMinimum - levelSpan * 0.12);
  const scaleMaximum = levelMaximum + levelSpan * 0.12;
  const levelPosition = (value: number) => `${((value - scaleMinimum) / (scaleMaximum - scaleMinimum)) * 100}%`;
  const cfdScale = cfdToFuturesFactor ?? 1;
  const toCfdLevel = (value: number) => conversionFactor === null || !chain?.previousDayHigh
    ? null
    : cfdHigh * value / chain.previousDayHigh;
  const cfdChartLevels = useMemo(() => {
    const mapped = (value: number) => conversionFactor === null || !chain?.previousDayHigh
      ? null
      : cfdHigh * value / chain.previousDayHigh;
    return [
      ...(conversionFactor !== null ? wallConfluence.filter((wall) => wall.side === 'put').flatMap((wall) => {
        const mappedPrice = mapped(wall.consensusStrike);
        return mappedPrice === null ? [] : [{ price: mappedPrice, color: '#f18270', title: wall.confirmation ? `${wall.label} CONF` : wall.label }];
      }) : []),
      ...(price !== null && price !== undefined && mapped(price) !== null ? [{ price: mapped(price)!, color: '#d8e2da', title: 'SPOT' }] : []),
      ...(cfdHigh > 0 ? [{ price: cfdHigh, color: '#f3c969', title: 'CFD PDH' }] : chain?.futuresPreviousDayHigh ? [{ price: chain.futuresPreviousDayHigh, color: '#f3c969', title: `${futuresSymbol} PDH` }] : []),
      ...(conversionFactor !== null ? wallConfluence.filter((wall) => wall.side === 'call').flatMap((wall) => {
        const mappedPrice = mapped(wall.consensusStrike);
        return mappedPrice === null ? [] : [{ price: mappedPrice, color: '#55c99b', title: wall.confirmation ? `${wall.label} CONF` : wall.label }];
      }) : []),
    ];
  }, [wallConfluence, price, chain?.previousDayHigh, chain?.futuresPreviousDayHigh, conversionFactor, cfdHigh, futuresSymbol]);
  const instrumentChartPoints = useMemo(() => (chain?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.history]);
  const instrumentChartLevels = useMemo(() => [
    ...wallConfluence.filter((wall) => wall.side === 'put').map((wall) => ({ price: wall.consensusStrike, color: '#f18270', title: wall.confirmation ? `${wall.label} CONF` : wall.label })),
    ...(price !== null && price !== undefined ? [{ price, color: '#d8e2da', title: 'SPOT' }] : []),
    ...(chain?.previousDayHigh ? [{ price: chain.previousDayHigh, color: '#f3c969', title: 'PDH' }] : []),
    ...wallConfluence.filter((wall) => wall.side === 'call').map((wall) => ({ price: wall.consensusStrike, color: '#55c99b', title: wall.confirmation ? `${wall.label} CONF` : wall.label })),
  ], [wallConfluence, price, chain?.previousDayHigh]);
  const confirmationChartPoints = useMemo(() => (chain?.confirmation?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.confirmation?.history]);
  const confirmationChartLevels = useMemo(() => [
    ...confirmationWalls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}` })),
    ...(confirmationPrice !== null ? [{ price: confirmationPrice, color: '#d8e2da', title: 'SPOT' }] : []),
    ...confirmationWalls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}` })),
  ], [confirmationWalls, confirmationPrice]);
  const overnightChartPoints = useMemo(() => (chain?.overnightHistory ?? []).map(({ time, close }) => ({ time, value: close * cfdScale })), [chain?.overnightHistory, cfdScale]);

  function selectInstrument(nextSymbol: string) {
    setSymbol(nextSymbol);
    setExpiration('');
    setChain(null);
    void loadChain(nextSymbol, todayExpiration());
  }

  function updateCfdHigh(value: string) {
    setCfdPreviousHighs((current) => ({ ...current, [cfdSymbol]: value }));
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
            <span className="exchange-tag">{activeInstrument?.exchange ?? 'US EQUITY'}</span>
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
          <strong className="today-expiry">{chain?.isNearestExpiration ? 'NEAREST' : '0DTE'} · {expirationLabel(Number(expiration))}</strong>
        </div>
        <div className="toolbar-meta">
          <span>AUTO · 5 MIN</span>
          <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void loadChain(symbol, todayExpiration(), true)} title="Refresh chain and chart" aria-label="Refresh chain and chart" disabled={loading || refreshing}>
            <RefreshCw size={15} />
          </button>
        </div>
      </section>

      <section className="cfd-entry-panel" aria-label={`${cfdSymbol} previous-day high input`}>
        <div className="cfd-entry-title">
          <span className="control-label">CFD ANCHOR · PREVIOUS SESSION HIGH</span>
          <span className="expiry-badge">{cfdSymbol}</span>
        </div>
        <label className="cfd-anchor-input">
          <span className="metric-label">YOUR {cfdSymbol} · PREVIOUS HIGH</span>
          <div className="number-input-wrap"><span>{cfdSymbol}</span><input aria-label={`${cfdSymbol} CFD previous-day high`} type="number" min="0" step="0.1" inputMode="decimal" placeholder="Enter yesterday high" value={cfdPreviousHigh} onChange={(event) => updateCfdHigh(event.target.value)} /></div>
        </label>
        <div className="cfd-entry-reference">
          <span>{futuresSymbol} PDH <strong>{chain?.futuresPreviousDayHigh ? display(chain.futuresPreviousDayHigh) : '—'}</strong></span>
          <span>{chain?.referenceSymbol ?? activeInstrument?.label ?? symbol} PDH <strong>{chain?.referencePreviousDayHigh ? display(chain.referencePreviousDayHigh) : '—'}</strong></span>
        </div>
      </section>

      <div className="chart-pair">
        {chain?.confirmation && chain.confirmation.symbol === chain.referenceSymbol && confirmationChartPoints.length > 0 && <PriceChart
          title={instruments.find((instrument) => instrument.symbol === chain.confirmation?.symbol)?.label ?? chain.confirmation.symbol}
          source={`${chain.confirmation.symbol} · 5 MIN`}
          subtitle="PEER · SAME-DAY OPTIONS + SPOT"
          points={confirmationChartPoints}
          levels={confirmationChartLevels}
          lineColor="#72bda5"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />}
        <PriceChart
          title={activeInstrument?.label ?? symbol}
          source={`${symbol} · 5 MIN`}
          subtitle="TODAY · PRE/POST-MARKET · WALLS + PDH"
          points={instrumentChartPoints}
          levels={instrumentChartLevels}
          lineColor="#55c99b"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'PDH', color: '#f3c969' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />
        {chain?.confirmation && chain.confirmation.symbol !== chain.referenceSymbol && confirmationChartPoints.length > 0 && <PriceChart
          title={instruments.find((instrument) => instrument.symbol === chain.confirmation?.symbol)?.label ?? chain.confirmation.symbol}
          source={`${chain.confirmation.symbol} · 5 MIN`}
          subtitle="PEER · SAME-DAY OPTIONS + SPOT"
          points={confirmationChartPoints}
          levels={confirmationChartLevels}
          lineColor="#72bda5"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />}
        <PriceChart
          title={`${cfdSymbol} overnight`}
          source={`${futuresSymbol} · 5 MIN`}
          subtitle={`FUTURES · NORMALIZED TO ${cfdSymbol} PDH`}
          points={overnightChartPoints}
          levels={cfdChartLevels}
          lineColor="#e0ad5a"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: cfdHigh > 0 ? `${cfdSymbol} PDH` : `${futuresSymbol} PDH`, color: '#f3c969' }, { title: `${cfdSymbol} SPOT`, color: '#d8e2da' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />
      </div>

      <section className="levels-panel standalone-levels" aria-label="Option wall price levels">
        <div className="levels-heading">
          <div>
            <h2>Key levels</h2>
            <span className="chain-caption">±4% SPOT · CONFIRMED WHEN PEER OFFSET IS WITHIN 0.5 P.P.</span>
            {chain?.confirmationWarning && <p className="options-warning">{chain.confirmationWarning}</p>}
          </div>
          <span className="levels-symbol">{chain?.symbol ?? symbol} · {expiration ? expirationLabel(Number(expiration)) : '—'}</span>
        </div>
        <div className="levels-rows">
          {wallConfluence.filter((wall) => wall.side === 'put').map((wall) => <div className="level-row put-level" key={`put-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">${display(wall.consensusStrike)}</strong>
            <span className="level-distance">{display(wall.consensusOffsetPct)}%</span>
            <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span>
          </div>)}
          <div className="level-row spot-level">
            <span className="level-name">SPOT</span>
            <div className="level-track"><span className="level-marker" style={price !== null && price !== undefined ? { left: levelPosition(price) } : undefined} /></div>
            <strong className="level-price">{price === null || price === undefined ? '—' : `$${display(price)}`}</strong>
            <span className="level-distance">UNDERLYING</span>
          </div>
          {wallConfluence.filter((wall) => wall.side === 'call').map((wall) => <div className="level-row call-level" key={`call-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">${display(wall.consensusStrike)}</strong>
            <span className="level-distance">{display(wall.consensusOffsetPct)}%</span>
            <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span>
          </div>)}
        </div>
      </section>

      <section className="cfd-panel" aria-label={`${cfdSymbol} CFD wall conversion`}>
        <div className="cfd-heading">
          <div><h2>{cfdSymbol} CFD conversion</h2><span className="chain-caption">PREVIOUS-HIGH ALIGNMENT · CFD → FUTURES → OPTIONS</span></div>
          <span className="expiry-badge">{activeInstrument?.label ?? symbol} · {chain?.isNearestExpiration ? 'NEAREST' : '0DTE'}</span>
        </div>
        <div className="cfd-inputs">
          <div className="reference-high">
            <span className="metric-label">{activeInstrument?.label ?? symbol} · OPTION PDH</span>
            <strong>{chain?.previousDayHigh ? `$${display(chain.previousDayHigh)}` : '—'}</strong>
            <span>{chain?.previousDayDate ?? 'Waiting for daily data'}</span>
          </div>
          <div className="reference-high futures-reference-high">
            <span className="metric-label">{futuresSymbol} · FUTURES PDH</span>
            <strong>{chain?.futuresPreviousDayHigh ? `$${display(chain.futuresPreviousDayHigh)}` : '—'}</strong>
            <span>{chain?.futuresPreviousDayDate ?? 'Waiting for daily data'}</span>
          </div>
          {<div className="reference-high qqq-reference-high">
            <span className="metric-label">{chain?.referenceSymbol ?? activeInstrument?.label ?? symbol} · REFERENCE PDH</span>
            <strong>{chain?.referencePreviousDayHigh ? `$${display(chain.referencePreviousDayHigh)}` : '—'}</strong>
            <span>{chain?.referencePreviousDayDate ?? 'Waiting for daily data'}</span>
          </div>}
          <div className="conversion-steps">
            <span>{cfdSymbol} / {futuresSymbol}: <b>{cfdToFuturesFactor === null ? '—' : display(cfdToFuturesFactor, 5)}</b></span>
            <span>{futuresSymbol} / {chain?.referenceSymbol ?? symbol}: <b>{futuresToReferenceFactor === null ? '—' : display(futuresToReferenceFactor, 5)}</b></span>
            <span>{chain?.referenceSymbol ?? symbol} / {symbol}: <b>{referenceToUnderlyingFactor === null ? '—' : display(referenceToUnderlyingFactor, 5)}</b></span>
            <span>COMBINED: <b>{conversionFactor === null ? '—' : display(conversionFactor, 5)}</b></span>
          </div>
          <p className="conversion-formula">CFD wall = option strike × ({cfdSymbol} PDH ÷ {futuresSymbol} PDH) × ({futuresSymbol} PDH ÷ {chain?.referenceSymbol ?? symbol} PDH) × ({chain?.referenceSymbol ?? symbol} PDH ÷ {symbol} PDH)</p>
        </div>
        <div className="conversion-table-wrap">
          <table className="conversion-table">
            <thead><tr><th>LEVEL</th><th>PRIMARY / PEER STRIKE</th><th>CONSENSUS OFFSET</th><th>{cfdSymbol} CFD LEVEL</th></tr></thead>
            <tbody>
              {cfdLevels.length ? cfdLevels.map((wall) => {
                const convertedLevel = toCfdLevel(wall.consensusStrike);
                return <tr key={wall.label}>
                  <td className={wall.side === 'put' ? 'put-conversion' : 'call-conversion'}>{wall.label} <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span></td>
                  <td>{display(wall.contract.strike)}{wall.confirmation ? ` / ${display(wall.confirmation.strike)}` : ''}</td>
                  <td>{display(wall.consensusOffsetPct)}%</td>
                  <td className="converted-level">{convertedLevel === null ? `Enter ${cfdSymbol} high` : display(convertedLevel)}</td>
                </tr>;
              }) : <tr><td className="conversion-empty" colSpan={4}>{optionsUnavailableMessage || error || 'No 0DTE wall levels for this instrument today.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="chain-panel" aria-label="Options chain">
        <div className="chain-heading">
          <div>
            <h2>Wall strikes</h2>
            <span className="chain-caption">TOP 4 CALLS ABOVE · TOP 4 PUTS BELOW · WITHIN ±4% SPOT</span>
            {chain?.optionsWarning && <p className="options-warning">{chain.optionsWarning}</p>}
          </div>
          <span className="expiry-badge">{chain?.isNearestExpiration ? 'NEAREST · ' : ''}{expiration ? expirationLabel(Number(expiration)) : 'SELECT EXPIRATION'}</span>
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
                  : chain?.optionsError ? <tr><td className="table-message" colSpan={11}>{optionsUnavailableMessage}</td></tr>
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