import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, RefreshCw, Search } from 'lucide-react';

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

type Chain = {
  symbol: string;
  quote: { price: number | null; previousClose: number | null; changePercent: number | null; currency: string };
  expirations: number[];
  selectedExpiration: number | null;
  calls: Contract[];
  puts: Contract[];
  fetchedAt: string;
};

const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const percentFormat = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

function display(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function expirationLabel(epoch: number) {
  return new Date(epoch * 1000).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function heat(value: number, maximum: number, side: 'call' | 'put') {
  const intensity = maximum > 0 ? Math.sqrt(value / maximum) : 0;
  const color = side === 'call' ? `37, 178, 129, ${intensity * 0.2}` : `237, 105, 86, ${intensity * 0.2}`;
  return { backgroundColor: `rgba(${color})` };
}

export default function App() {
  const [symbolInput, setSymbolInput] = useState('QQQ');
  const [symbol, setSymbol] = useState('QQQ');
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiration, setExpiration] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  async function loadChain(nextSymbol = symbol, date = expiration, refresh = false) {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ symbol: nextSymbol });
      if (date) params.set('date', date);
      const response = await fetch(`/api/options?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      setChain(payload as Chain);
      setExpiration(String(payload.selectedExpiration || payload.expirations?.[0] || ''));
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Nie udało się pobrać danych.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadChain('QQQ', '', false);
  }, []);

  const strikes = useMemo(() => {
    const callMap = new Map((chain?.calls ?? []).map((contract) => [contract.strike, contract]));
    const putMap = new Map((chain?.puts ?? []).map((contract) => [contract.strike, contract]));
    const allStrikes = [...new Set([...callMap.keys(), ...putMap.keys()])].sort((a, b) => a - b);
    return allStrikes.map((strike) => ({ strike, call: callMap.get(strike), put: putMap.get(strike) }));
  }, [chain]);

  const maxOi = Math.max(0, ...(chain?.calls ?? []).map((item) => item.openInterest), ...(chain?.puts ?? []).map((item) => item.openInterest));
  const callOi = (chain?.calls ?? []).reduce((total, item) => total + item.openInterest, 0);
  const putOi = (chain?.puts ?? []).reduce((total, item) => total + item.openInterest, 0);
  const putCallRatio = callOi ? putOi / callOi : null;
  const price = chain?.quote.price;
  const changePositive = (chain?.quote.changePercent ?? 0) >= 0;

  function submitSymbol(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSymbol = symbolInput.trim().toUpperCase();
    if (!nextSymbol) return;
    setSymbol(nextSymbol);
    setExpiration('');
    void loadChain(nextSymbol, '');
  }

  function changeExpiration(value: string) {
    setExpiration(value);
    void loadChain(symbol, value);
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
            <h1>{chain?.symbol ?? symbol}</h1>
            <span className="exchange-tag">NASDAQ</span>
            {price !== null && price !== undefined && <span className="price">${display(price)}</span>}
            {chain?.quote.changePercent !== null && chain?.quote.changePercent !== undefined && (
              <span className={`price-change ${changePositive ? 'positive' : 'negative'}`}>
                {changePositive ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{display(Math.abs(chain.quote.changePercent), 2)}%
              </span>
            )}
          </div>
          <p className="instrument-subtitle">Invesco QQQ Trust · Nasdaq-100 ETF</p>
        </div>
        <form className="symbol-search" onSubmit={submitSymbol}>
          <Search size={16} aria-hidden="true" />
          <input aria-label="Symbol" value={symbolInput} onChange={(event) => setSymbolInput(event.target.value)} maxLength={15} />
          <button type="submit" title="Load symbol"><ArrowUp size={15} /></button>
        </form>
      </section>

      <section className="toolbar" aria-label="Chain filters">
        <label className="select-wrap">
          <span className="control-label">EXPIRATION</span>
          <span className="select-control">
            <select value={expiration} onChange={(event) => changeExpiration(event.target.value)} disabled={!chain?.expirations.length}>
              {(chain?.expirations ?? []).map((date) => <option value={date} key={date}>{expirationLabel(date)}</option>)}
            </select>
            <ChevronDown size={15} />
          </span>
        </label>
        <div className="toolbar-meta">
          <span className="contract-count">{numberFormat.format(strikes.length)} strikes</span>
          <span className="toolbar-separator" />
          <span>Calls + puts</span>
          <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void loadChain(symbol, expiration, true)} title="Refresh chain" aria-label="Refresh chain" disabled={loading || refreshing}>
            <RefreshCw size={15} />
          </button>
        </div>
      </section>

      <section className="metrics" aria-label="Open interest summary">
        <article className="metric">
          <span className="metric-label">CALL OPEN INTEREST</span>
          <strong className="metric-value">{compactFormat.format(callOi)}</strong>
          <span className="metric-detail call-color">CALLS</span>
        </article>
        <article className="metric">
          <span className="metric-label">PUT OPEN INTEREST</span>
          <strong className="metric-value">{compactFormat.format(putOi)}</strong>
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

      <section className="chain-panel" aria-label="Options chain">
        <div className="chain-heading">
          <div><h2>Options chain</h2><span className="chain-caption">OPEN INTEREST SHADING · CONTRACTS STANDARDIZED TO 100 SHARES</span></div>
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
                  : strikes.length === 0 ? <tr><td className="table-message" colSpan={11}>No option contracts returned for this expiration.</td></tr>
                    : strikes.map(({ strike, call, put }) => {
                      const atm = price !== null && price !== undefined && Math.abs(strike - price) === Math.min(...strikes.map((item) => Math.abs(item.strike - price)));
                      return <tr className={atm ? 'atm-row' : ''} key={strike}>
                        <td className="call-cell oi-cell" style={heat(call?.openInterest ?? 0, maxOi, 'call')}>{call ? compactFormat.format(call.openInterest) : '—'}</td>
                        <td className="call-cell">{call ? compactFormat.format(call.volume) : '—'}</td>
                        <td className="call-cell">{call ? percentFormat.format(call.impliedVolatility) : '—'}</td>
                        <td className="call-cell quote-cell">{call ? display(call.bid) : '—'}</td>
                        <td className="call-cell quote-cell">{call ? display(call.ask) : '—'}</td>
                        <td className="strike-cell">{numberFormat.format(strike)}{atm && <span className="atm-tag">ATM</span>}</td>
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