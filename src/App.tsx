import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, RefreshCw, Search } from 'lucide-react';
import type { Chain, WallConfluence } from './types';
import { CONFLUENCE_TOLERANCE_PCT, instruments } from './config/instruments';
import { compact, display, expirationLabel, heat, numberFormat, percentage, todayExpiration } from './lib/format';
import { selectWallContracts, wallMetric } from './lib/walls';
import { PriceChart } from './components/PriceChart';

export default function App() {
  const [symbol, setSymbol] = useState('^NDX');
  const [cfdPreviousHighs, setCfdPreviousHighs] = useState<Record<string, string>>({ US100: '', US500: '', US30: '', XAUUSD: '', DE40: '' });
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiration, setExpiration] = useState(todayExpiration());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const requestIdRef = useRef(0);
  const activeInstrument = instruments.find((instrument) => instrument.symbol === symbol);
  const cfdSymbol = activeInstrument?.cfdSymbol ?? chain?.cfdSymbol ?? 'US100';
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
  const wallConfig = activeInstrument?.wall ?? { tolerance: 0.04, leaderThreshold: 0.33, maxWalls: 3, minMetric: 0 };
  const { tolerance: wallTolerance, leaderThreshold: wallLeaderThreshold, maxWalls, minMetric: wallMinMetric } = wallConfig;
  const walls = useMemo(() => {
    return {
      call: selectWallContracts(chain?.calls ?? [], price ?? null, 'above', wallTolerance, wallLeaderThreshold, maxWalls, wallMinMetric),
      put: selectWallContracts(chain?.puts ?? [], price ?? null, 'below', wallTolerance, wallLeaderThreshold, maxWalls, wallMinMetric),
    };
  }, [chain, price, wallTolerance, wallLeaderThreshold, maxWalls, wallMinMetric]);
  const confirmationPrice = chain?.confirmation?.price ?? null;
  const confirmationWalls = useMemo(() => ({
    call: selectWallContracts(chain?.confirmation?.calls ?? [], confirmationPrice, 'above', wallTolerance),
    put: selectWallContracts(chain?.confirmation?.puts ?? [], confirmationPrice, 'below', wallTolerance),
  }), [chain?.confirmation, confirmationPrice, wallTolerance]);
  const wallStrikes = new Set([...walls.call, ...walls.put].map((wall) => wall.strike));
  const wallRows = strikes.filter((row) => wallStrikes.has(row.strike));
  const showNearestStrikes = wallRows.length === 0 && strikes.length > 0;
  const displayedRows = showNearestStrikes
    ? [...strikes]
      .sort((left, right) => Math.abs(left.strike - (price ?? 0)) - Math.abs(right.strike - (price ?? 0)))
      .slice(0, 8)
      .sort((left, right) => left.strike - right.strike)
    : wallRows;
  const callMetric = wallMetric(chain?.calls ?? []);
  const putMetric = wallMetric(chain?.puts ?? []);
  const maxCallMetric = Math.max(0, ...(chain?.calls ?? []).map(callMetric));
  const maxPutMetric = Math.max(0, ...(chain?.puts ?? []).map(putMetric));
  const wallsByVolume = [...walls.call, ...walls.put].some((contract) => !Number.isFinite(contract.openInterest) || contract.openInterest <= 0);
  const optionsUnavailableMessage = chain?.optionsError
    ? `${chain.optionsError}${chain.expirations[0] ? ` Najbliższy termin: ${expirationLabel(chain.expirations[0])}.` : ''}`
    : '';
  const changePositive = (chain?.quote.changePercent ?? 0) >= 0;
  const currencySymbol = chain?.quote.currency === 'EUR' ? '€' : '$';
  const cfdToUnderlyingFactor = cfdHigh > 0 && chain?.previousDayHigh
    ? cfdHigh / chain.previousDayHigh
    : null;
  const conversionFactor = cfdToUnderlyingFactor;
  const primaryWalls = [
    ...walls.put.map((contract, index) => ({ contract, side: 'put' as const, label: `P${index + 1}` })),
    ...walls.call.map((contract, index) => ({ contract, side: 'call' as const, label: `C${index + 1}` })),
  ];
  const wallConfluence = useMemo<WallConfluence[]>(() => {
    const confirmation = chain?.confirmation;
    const confirmationPrice = confirmation?.price ?? null;
    const usedConfirmationContracts = new Set<string>();
    const confirmationPuts = confirmation?.puts ?? [];
    const confirmationCalls = confirmation?.calls ?? [];
    const confirmationMetrics = { put: wallMetric(confirmationPuts), call: wallMetric(confirmationCalls) };
    const confirmationWalls = {
      put: confirmationPrice ? confirmationPuts.filter((contract) => confirmationMetrics.put(contract) > 0 && contract.strike < confirmationPrice && contract.strike >= confirmationPrice * (1 - wallTolerance)).sort((a, b) => confirmationMetrics.put(b) - confirmationMetrics.put(a)).slice(0, 4) : [],
      call: confirmationPrice ? confirmationCalls.filter((contract) => confirmationMetrics.call(contract) > 0 && contract.strike > confirmationPrice && contract.strike <= confirmationPrice * (1 + wallTolerance)).sort((a, b) => confirmationMetrics.call(b) - confirmationMetrics.call(a)).slice(0, 4) : [],
    };

    return primaryWalls.map(({ contract, side, label }) => {
      const offsetPct = price ? (contract.strike / price - 1) * 100 : 0;
      const sideMetric = confirmationMetrics[side];
      const matches = confirmationPrice
        ? confirmationWalls[side]
          .filter((candidate) => !usedConfirmationContracts.has(candidate.contractSymbol))
          .map((candidate) => ({ contract: candidate, offsetPct: (candidate.strike / confirmationPrice - 1) * 100 }))
          .filter((candidate) => Math.abs(candidate.offsetPct - offsetPct) <= CONFLUENCE_TOLERANCE_PCT)
          .sort((left, right) => Math.abs(left.offsetPct - offsetPct) - Math.abs(right.offsetPct - offsetPct) || sideMetric(right.contract) - sideMetric(left.contract))
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
  const cfdScale = cfdToUnderlyingFactor ?? 1;
  const toCfdLevel = (value: number) => {
    if (!chain?.previousDayHigh) return null;
    return cfdScale * value;
  };
  const instrumentChartPoints = useMemo(() => (chain?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.history]);
  const instrumentChartLevels = useMemo(() => [
    ...walls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}` })),
    ...(chain?.gex?.putWall ? [{ price: chain.gex.putWall.strike, color: '#c0392b', title: 'GEX P' }] : []),
    ...(chain?.gex?.gammaFlip ? [{ price: chain.gex.gammaFlip, color: '#b8a1e3', title: 'FLIP' }] : []),
    ...(price !== null && price !== undefined ? [{ price, color: '#d8e2da', title: 'SPOT' }] : []),
    ...(chain?.previousDayHigh ? [{ price: chain.previousDayHigh, color: '#f3c969', title: 'PDH' }] : []),
    ...(chain?.previousDayClose ? [{ price: chain.previousDayClose, color: '#7aa2f7', title: 'PDC' }] : []),
    ...walls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}` })),
    ...(chain?.gex?.callWall ? [{ price: chain.gex.callWall.strike, color: '#27ae60', title: 'GEX C' }] : []),
  ], [walls, price, chain?.previousDayHigh, chain?.previousDayClose, chain?.gex]);
  const confirmationChartPoints = useMemo(() => (chain?.confirmation?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.confirmation?.history]);
  const confirmationChartLevels = useMemo(() => {
    const hasChain = (chain?.confirmation?.calls?.length ?? 0) + (chain?.confirmation?.puts?.length ?? 0) > 0;
    if (hasChain) {
      return [
        ...confirmationWalls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}` })),
        ...(confirmationPrice !== null ? [{ price: confirmationPrice, color: '#d8e2da', title: 'SPOT' }] : []),
        ...(chain?.confirmation?.previousDayHigh ? [{ price: chain.confirmation.previousDayHigh, color: '#f3c969', title: 'PDH' }] : []),
        ...(chain?.confirmation?.previousClose ? [{ price: chain.confirmation.previousClose, color: '#7aa2f7', title: 'PDC' }] : []),
        ...confirmationWalls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}` })),
      ];
    }
    const ratio = confirmationPrice && price ? confirmationPrice / price : null;
    if (ratio === null) return [];
    return [
      ...walls.put.map((wall, index) => ({ price: wall.strike * ratio, color: '#f18270', title: `P${index + 1}` })),
      ...(confirmationPrice !== null ? [{ price: confirmationPrice, color: '#d8e2da', title: 'SPOT' }] : []),
      ...(chain?.confirmation?.previousDayHigh ? [{ price: chain.confirmation.previousDayHigh, color: '#f3c969', title: 'PDH' }] : []),
      ...(chain?.confirmation?.previousClose ? [{ price: chain.confirmation.previousClose, color: '#7aa2f7', title: 'PDC' }] : []),
      ...walls.call.map((wall, index) => ({ price: wall.strike * ratio, color: '#55c99b', title: `C${index + 1}` })),
    ];
  }, [confirmationWalls, confirmationPrice, chain?.confirmation?.previousDayHigh, chain?.confirmation?.previousClose, chain?.confirmation?.calls, chain?.confirmation?.puts, walls, price]);

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
        <div className="topbar-right"><span className="live-dot" /> OPTIONS MARKET <span className="topbar-divider" /> {activeInstrument?.exchange === 'EUREX' ? 'EUREX' : 'US EQUITIES'}</div>
      </header>

      <section className="instrument-head">
        <div className="instrument-title">
          <div className="eyebrow">OPTION CHAIN <span className="eyebrow-line" /></div>
          <div className="title-row">
            <h1>{activeInstrument?.label ?? symbol}</h1>
            <span className="exchange-tag">{activeInstrument?.exchange ?? 'US EQUITY'}</span>
            {price !== null && price !== undefined && <span className="price">{currencySymbol}{display(price)}</span>}
            {chain?.quote.changePercent !== null && chain?.quote.changePercent !== undefined && (
              <span className={`price-change ${changePositive ? 'positive' : 'negative'}`}>
                {changePositive ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{display(Math.abs(chain.quote.changePercent), 2)}%
              </span>
            )}
          </div>
          <p className="instrument-subtitle">{activeInstrument?.description ?? symbol}</p>
          {(chain?.todayOpen !== null && chain?.todayOpen !== undefined) && (
            <div className="session-stats">
              <span>O <strong>{currencySymbol}{display(chain.todayOpen)}</strong></span>
              <span>H <strong>{currencySymbol}{display(chain.todayHigh)}</strong></span>
              <span>L <strong>{currencySymbol}{display(chain.todayLow)}</strong></span>
            </div>
          )}
          {chain?.confirmation && chain.confirmationTodayOpen !== null && chain.confirmationTodayOpen !== undefined && (
            <div className="session-stats session-stats-confirmation">
              <span>{chain.confirmation.symbol} O <strong>{currencySymbol}{display(chain.confirmationTodayOpen)}</strong></span>
              <span>H <strong>{currencySymbol}{display(chain.confirmationTodayHigh)}</strong></span>
              <span>L <strong>{currencySymbol}{display(chain.confirmationTodayLow)}</strong></span>
            </div>
          )}
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
          <span>{symbol} PDH <strong>{chain?.previousDayHigh ? display(chain.previousDayHigh) : '—'}</strong></span>
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
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'PDH', color: '#f3c969' }, { title: 'PDC', color: '#7aa2f7' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />}
        <PriceChart
          title={activeInstrument?.label ?? symbol}
          source={`${symbol} · 5 MIN`}
          subtitle="TODAY · PRE/POST-MARKET · WALLS + PDH"
          points={instrumentChartPoints}
          levels={instrumentChartLevels}
          lineColor="#55c99b"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'PDH', color: '#f3c969' }, { title: 'PDC', color: '#7aa2f7' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />
        {chain?.confirmation && chain.confirmation.symbol !== chain.referenceSymbol && confirmationChartPoints.length > 0 && <PriceChart
          title={instruments.find((instrument) => instrument.symbol === chain.confirmation?.symbol)?.label ?? chain.confirmation.symbol}
          source={`${chain.confirmation.symbol} · 5 MIN`}
          subtitle={chain.confirmation.calls.length ? 'PEER · SAME-DAY OPTIONS + SPOT' : 'CASH INDEX · REFERENCE'}
          points={confirmationChartPoints}
          levels={confirmationChartLevels}
          lineColor="#72bda5"
          legend={[{ title: 'PUT WALLS', color: '#f18270' }, { title: 'SPOT', color: '#d8e2da' }, { title: 'PDH', color: '#f3c969' }, { title: 'PDC', color: '#7aa2f7' }, { title: 'CALL WALLS', color: '#55c99b' }]}
        />}
      </div>

      <section className="levels-panel standalone-levels" aria-label="Option wall price levels">
        <div className="levels-heading">
          <div>
            <h2>Key levels</h2>
            <span className="chain-caption">±{display(wallTolerance * 100, 0)}% SPOT · PEER OFFSET ≤0.25 P.P.</span>
            {chain?.confirmationWarning && <p className="options-warning">{chain.confirmationWarning}</p>}
          </div>
          <span className="levels-symbol">{chain?.symbol ?? symbol} · {expiration ? expirationLabel(Number(expiration)) : '—'}</span>
        </div>
        <div className="levels-rows">
          {wallConfluence.filter((wall) => wall.side === 'put').map((wall) => <div className="level-row put-level" key={`put-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">{currencySymbol}{display(wall.consensusStrike)}</strong>
            <span className="level-distance">{display(wall.consensusOffsetPct)}%</span>
            <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span>
          </div>)}
          <div className="level-row spot-level">
            <span className="level-name">SPOT</span>
            <div className="level-track"><span className="level-marker" style={price !== null && price !== undefined ? { left: levelPosition(price) } : undefined} /></div>
            <strong className="level-price">{price === null || price === undefined ? '—' : `${currencySymbol}${display(price)}`}</strong>
            <span className="level-distance">UNDERLYING</span>
          </div>
          {wallConfluence.filter((wall) => wall.side === 'call').map((wall) => <div className="level-row call-level" key={`call-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}</span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">{currencySymbol}{display(wall.consensusStrike)}</strong>
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
            <strong>{chain?.previousDayHigh ? `${currencySymbol}${display(chain.previousDayHigh)}` : '—'}</strong>
            <span>{chain?.previousDayDate ?? 'Waiting for daily data'}</span>
          </div>
          {<div className="reference-high qqq-reference-high">
            <span className="metric-label">{chain?.referenceSymbol ?? activeInstrument?.label ?? symbol} · REFERENCE PDH</span>
            <strong>{chain?.referencePreviousDayHigh ? `${currencySymbol}${display(chain.referencePreviousDayHigh)}` : '—'}</strong>
            <span>{chain?.referencePreviousDayDate ?? 'Waiting for daily data'}</span>
          </div>}
          <div className="conversion-steps">
            <span>{cfdSymbol} / {symbol}: <b>{cfdToUnderlyingFactor === null ? '—' : display(cfdToUnderlyingFactor, 5)}</b></span>
            <span>COMBINED: <b>{conversionFactor === null ? '—' : display(conversionFactor, 5)}</b></span>
          </div>
          <p className="conversion-formula">CFD wall = option strike × ({cfdSymbol} PDH ÷ {symbol} PDH)</p>
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
            <span className="chain-caption">{showNearestStrikes ? 'NEAREST AVAILABLE STRIKES · WALL LEVELS NEED OPEN INTEREST' : `KEY CALLS + PUTS · WITHIN ±${display(wallTolerance * 100, 0)}% SPOT · ≥${Math.round(wallLeaderThreshold * 100)}% TOP OI${wallsByVolume ? ' · BY VOLUME' : ''}`}</span>
            {chain?.optionsWarning && <p className="options-warning">{chain.optionsWarning}</p>}
            {wallsByVolume && !showNearestStrikes && <p className="options-warning">Open interest unavailable; walls ranked by volume.</p>}
            {showNearestStrikes && <p className="options-warning">No open-interest walls found; showing the nearest available options.</p>}
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
                    : displayedRows.length === 0 ? <tr><td className="table-message" colSpan={11}>No options found for this expiration.</td></tr>
                    : displayedRows.map(({ strike, call, put }) => {
                      const callRank = walls.call.findIndex((wall) => wall.strike === strike);
                      const putRank = walls.put.findIndex((wall) => wall.strike === strike);
                      return <tr key={strike}>
                        <td className="call-cell oi-cell" style={heat(call ? callMetric(call) : 0, maxCallMetric, 'call')}>{call ? compact(call.openInterest) : '—'}</td>
                        <td className="call-cell">{call ? compact(call.volume) : '—'}</td>
                        <td className="call-cell">{call ? percentage(call.impliedVolatility) : '—'}</td>
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
                        <td className="put-cell">{put ? percentage(put.impliedVolatility) : '—'}</td>
                        <td className="put-cell">{put ? compact(put.volume) : '—'}</td>
                        <td className="put-cell oi-cell" style={heat(put ? putMetric(put) : 0, maxPutMetric, 'put')}>{put ? compact(put.openInterest) : '—'}</td>
                      </tr>;
                    })}
            </tbody>
          </table>
        </div>
        <footer className="panel-footer"><span>DATA: {activeInstrument?.dataSource ?? 'YAHOO FINANCE'}</span><span>{updatedAt ? `UPDATED ${updatedAt}` : 'AWAITING MARKET DATA'} · DELAYED DATA MAY APPLY</span></footer>
      </section>
      <footer className="page-footer"><span>Market Desk</span><span>For informational purposes only. Not investment advice.</span></footer>
    </main>
  );
}