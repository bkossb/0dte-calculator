import WebSocket from 'ws';

const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;
const CHART_RANGES = { '1d': '5m' };
const INSTRUMENT_MARKETS = {
  SPY: { cfdSymbol: 'US500', futuresSymbol: 'ES=F', referenceSymbol: 'SPY', confirmationSymbol: '^SPX', gexMultiplier: 100 },
  QQQ: { cfdSymbol: 'US100', futuresSymbol: 'NQ=F', referenceSymbol: 'QQQ', confirmationSymbol: '^NDX', gexMultiplier: 100 },
  '^NDX': { cfdSymbol: 'US100', futuresSymbol: 'NQ=F', referenceSymbol: 'QQQ', confirmationSymbol: 'QQQ', gexMultiplier: 100 },
  '^SPX': { cfdSymbol: 'US500', futuresSymbol: 'ES=F', referenceSymbol: 'SPY', confirmationSymbol: 'SPY', gexMultiplier: 100 },
  DIA: { cfdSymbol: 'US30', futuresSymbol: 'YM=F', referenceSymbol: 'DIA', confirmationSymbol: '^DJI', confirmationQuoteWithoutOptions: true, gexMultiplier: 100 },
  GLD: { cfdSymbol: 'XAUUSD', futuresSymbol: 'GC=F', referenceSymbol: 'GLD', gexMultiplier: 100 },
  '^GDAXI': { cfdSymbol: 'DE40', futuresSymbol: 'FDAX', referenceSymbol: '^GDAXI', eurexProductId: 3734540, eurexContractType: 'weekly', tvFuturesSymbol: 'EUREX:FDAX1!', gexMultiplier: 5 },
};
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionsDesk/1.0)' };
const EUREX_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionsDesk/1.0)' };
const EUREX_TIME_ZONE = 'Europe/Berlin';
let cachedYahooSession = null;

function zonedDate(timestamp, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function previousSession(dailyResult, timeZone = 'America/New_York') {
  const timestamps = dailyResult?.timestamp ?? [];
  const highs = dailyResult?.indicators?.quote?.[0]?.high ?? [];
  const closes = dailyResult?.indicators?.quote?.[0]?.close ?? [];
  const today = zonedDate(Date.now() / 1000, timeZone);
  return timestamps
    .map((time, index) => ({ time, high: highs[index], close: closes[index], date: zonedDate(time, timeZone) }))
    .filter((bar) => bar.date < today && Number.isFinite(bar.high))
    .at(-1) ?? null;
}

function todaySession(dailyResult, timeZone = 'America/New_York') {
  const timestamps = dailyResult?.timestamp ?? [];
  const quote = dailyResult?.indicators?.quote?.[0] ?? {};
  const today = zonedDate(Date.now() / 1000, timeZone);
  const index = timestamps.findIndex((time) => zonedDate(time, timeZone) === today);
  if (index < 0) return null;
  const open = quote.open?.[index];
  const high = quote.high?.[index];
  const low = quote.low?.[index];
  if (!Number.isFinite(open) && !Number.isFinite(high) && !Number.isFinite(low)) return null;
  return { open: open ?? null, high: high ?? null, low: low ?? null };
}

async function getYahooSession() {
  if (cachedYahooSession && cachedYahooSession.expiresAt > Date.now()) return cachedYahooSession;

  const cookieResponse = await fetch('https://fc.yahoo.com', { headers: YAHOO_HEADERS });
  const setCookies = cookieResponse.headers.getSetCookie?.() ?? [cookieResponse.headers.get('set-cookie') ?? ''];
  const cookie = setCookies.map((value) => value.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('Yahoo Finance did not provide a session cookie.');

  const crumbResponse = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { ...YAHOO_HEADERS, Cookie: cookie },
  });
  const crumb = await crumbResponse.text();
  if (!crumbResponse.ok || !crumb || crumb.startsWith('{')) throw new Error('Yahoo Finance did not provide an API crumb.');

  cachedYahooSession = { cookie, crumb, expiresAt: Date.now() + 50 * 60 * 1000 };
  return cachedYahooSession;
}

async function fetchYahooOptions(url) {
  let session = await getYahooSession();
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('crumb', session.crumb);
  let upstream = await fetch(requestUrl, {
    headers: { ...YAHOO_HEADERS, Cookie: session.cookie },
  });

  if (upstream.status === 401 || upstream.status === 403) {
    if (cachedYahooSession === session) cachedYahooSession = null;
    session = await getYahooSession();
    requestUrl.searchParams.set('crumb', session.crumb);
    upstream = await fetch(requestUrl, {
      headers: { ...YAHOO_HEADERS, Cookie: session.cookie },
    });
  }

  return upstream;
}

function tvFrame(method, params) {
  const payload = JSON.stringify({ m: method, p: params });
  return `~m~${payload.length}~m~${payload}`;
}

function fetchTradingViewBars(symbol, interval = '5', barCount = 800, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket', {
      headers: { Origin: 'https://www.tradingview.com', 'User-Agent': YAHOO_HEADERS['User-Agent'] },
    });
    const session = `cs_${Math.random().toString(36).slice(2, 10)}`;
    const bars = [];
    const finish = (error) => {
      clearTimeout(timeout);
      try { ws.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(bars);
    };
    const timeout = setTimeout(() => finish(bars.length ? null : new Error('TradingView timeout')), timeoutMs);
    ws.on('open', () => {
      ws.send(tvFrame('set_auth_token', ['unauthorized_user_token']));
      ws.send(tvFrame('chart_create_session', [session, '']));
      ws.send(tvFrame('resolve_symbol', [session, 'sym1', `={"symbol":"${symbol}","adjustment":"splits","session":"extended"}`]));
      ws.send(tvFrame('create_series', [session, 's1', 's1', 'sym1', interval, barCount, '']));
    });
    ws.on('message', (data) => {
      for (const part of String(data).split('~m~')) {
        if (!part || /^\d+$/.test(part)) continue;
        let message;
        try { message = JSON.parse(part); } catch { continue; }
        if (message.m === 'timescale_update') {
          const series = message.p?.[1]?.s1?.s ?? [];
          for (const bar of series) {
            const [time, open, high, low, close] = bar.v ?? [];
            if (Number.isFinite(time) && Number.isFinite(close)) bars.push({ time, open, high, low, close });
          }
        }
        if (message.m === 'series_completed') finish(null);
        if (message.m === 'critical_error' || message.m === 'symbol_error') finish(new Error(`TradingView: ${message.m}`));
      }
    });
    ws.on('error', () => finish(new Error('TradingView connection failed')));
  });
}

function previousSessionFromBars(bars, timeZone) {
  const today = zonedDate(Date.now() / 1000, timeZone);
  const byDay = new Map();
  for (const bar of bars) {
    const date = zonedDate(bar.time, timeZone);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(bar);
  }
  const previousDate = [...byDay.keys()].filter((date) => date < today).at(-1);
  if (!previousDate) return null;
  const dayBars = byDay.get(previousDate);
  return {
    date: previousDate,
    high: Math.max(...dayBars.map((bar) => bar.high).filter(Number.isFinite)),
    close: dayBars.at(-1)?.close ?? null,
  };
}

function berlinCompactDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: EUREX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('-', '');
}

function eurexTradingDateToCompact(value) {
  const match = /^(\d{2})-(\d{2})-(\d{4})/.exec(String(value ?? ''));
  return match ? `${match[3]}${match[2]}${match[1]}` : null;
}

function compactDateToEpoch(compact) {
  return Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8))) / 1000;
}

function normPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - normPdf(x) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

function black76Price(side, forward, strike, timeYears, sigma) {
  if (sigma <= 0 || timeYears <= 0 || forward <= 0 || strike <= 0) return NaN;
  const sqrtT = Math.sqrt(timeYears);
  const d1 = (Math.log(forward / strike) + 0.5 * sigma * sigma * timeYears) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return side === 'call'
    ? forward * normCdf(d1) - strike * normCdf(d2)
    : strike * normCdf(-d2) - forward * normCdf(-d1);
}

function black76ImpliedVol(side, price, forward, strike, timeYears) {
  const intrinsic = Math.max(side === 'call' ? forward - strike : strike - forward, 0);
  if (!Number.isFinite(price) || price <= intrinsic + 1e-9) return NaN;
  let low = 1e-4;
  let high = 5;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const value = black76Price(side, forward, strike, timeYears, mid);
    if (!Number.isFinite(value)) return NaN;
    if (value > price) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

function black76Gamma(forward, strike, timeYears, sigma) {
  if (sigma <= 0 || timeYears <= 0 || forward <= 0 || strike <= 0) return NaN;
  const d1 = (Math.log(forward / strike) + 0.5 * sigma * sigma * timeYears) / (sigma * Math.sqrt(timeYears));
  return normPdf(d1) / (forward * sigma * Math.sqrt(timeYears));
}

function computeGex(calls, puts, forward, timeYears, multiplier) {
  if (!Number.isFinite(forward) || forward <= 0 || timeYears <= 0 || !Number.isFinite(multiplier)) return null;
  const rows = [];
  for (const [side, contracts] of [['call', calls], ['put', puts]]) {
    for (const contract of contracts) {
      if (!Number.isFinite(contract.openInterest) || contract.openInterest <= 0) continue;
      let sigma = Number.isFinite(contract.impliedVolatility) && contract.impliedVolatility > 0
        ? contract.impliedVolatility
        : NaN;
      if (!Number.isFinite(sigma)) {
        const settle = Number.isFinite(contract.lastPrice) ? contract.lastPrice : NaN;
        sigma = black76ImpliedVol(side, settle, forward, contract.strike, timeYears);
      }
      if (!Number.isFinite(sigma)) continue;
      const gamma = black76Gamma(forward, contract.strike, timeYears, sigma);
      if (!Number.isFinite(gamma)) continue;
      const sign = side === 'call' ? 1 : -1;
      const gex = sign * gamma * contract.openInterest * multiplier * forward * forward * 0.01;
      rows.push({ strike: contract.strike, side, gex, openInterest: contract.openInterest, impliedVolatility: sigma });
    }
  }
  if (!rows.length) return null;
  const byStrike = new Map();
  for (const row of rows) {
    byStrike.set(row.strike, (byStrike.get(row.strike) ?? 0) + row.gex);
  }
  const sortedStrikes = [...byStrike.entries()].sort((a, b) => a[0] - b[0]);
  let gammaFlip = null;
  for (let i = 1; i < sortedStrikes.length; i += 1) {
    const [strikeA, gexA] = sortedStrikes[i - 1];
    const [strikeB, gexB] = sortedStrikes[i];
    if ((gexA > 0 && gexB < 0) || (gexA < 0 && gexB > 0)) {
      gammaFlip = strikeA + (strikeB - strikeA) * (Math.abs(gexA) / (Math.abs(gexA) + Math.abs(gexB)));
      break;
    }
  }
  const callWall = rows.filter((row) => row.side === 'call' && row.strike > forward).sort((a, b) => b.gex - a.gex)[0] ?? null;
  const putWall = rows.filter((row) => row.side === 'put' && row.strike < forward).sort((a, b) => a.gex - b.gex)[0] ?? null;
  const topByGex = [...rows].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 8);
  return {
    forward,
    timeYears,
    gammaFlip,
    callWall: callWall ? { strike: callWall.strike, gex: callWall.gex, openInterest: callWall.openInterest } : null,
    putWall: putWall ? { strike: putWall.strike, gex: putWall.gex, openInterest: putWall.openInterest } : null,
    topByGex,
  };
}

function eurexContract(row, productDate, side, spot) {
  const last = Number.isFinite(row.last) && row.last > 0 ? row.last : null;
  const settle = Number.isFinite(row.dSettle) && row.dSettle > 0 ? row.dSettle : null;
  return {
    contractSymbol: `ODAP-${productDate}-${side === 'call' ? 'C' : 'P'}-${row.strike}`,
    strike: row.strike,
    lastPrice: last ?? settle ?? NaN,
    bid: NaN,
    ask: NaN,
    change: NaN,
    percentChange: NaN,
    volume: Number.isFinite(row.volume) ? row.volume : 0,
    openInterest: Number.isFinite(row.openInterest) ? row.openInterest : 0,
    impliedVolatility: NaN,
    inTheMoney: Number.isFinite(spot) ? (side === 'call' ? row.strike < spot : row.strike > spot) : false,
  };
}

async function handleEurexChain(request, response, symbol, market, range) {
  const chartUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  chartUrl.searchParams.set('range', range);
  chartUrl.searchParams.set('interval', CHART_RANGES[range]);
  chartUrl.searchParams.set('includePrePost', 'true');
  const dailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  dailyUrl.searchParams.set('range', '5d');
  dailyUrl.searchParams.set('interval', '1d');
  const overviewUrl = `https://www.eurex.com/api/v1/overallstatistics/${market.eurexProductId}?filtertype=overview`;

  try {
    const { cookie } = await getYahooSession();
    const requestHeaders = { ...YAHOO_HEADERS, Cookie: cookie };
    const [overviewResponse, chartUpstream, dailyUpstream, futuresBars] = await Promise.all([
      fetch(overviewUrl, { headers: EUREX_HEADERS }).catch(() => null),
      fetch(chartUrl, { headers: requestHeaders }).catch(() => null),
      fetch(dailyUrl, { headers: requestHeaders }).catch(() => null),
      market.tvFuturesSymbol ? fetchTradingViewBars(market.tvFuturesSymbol).catch(() => null) : null,
    ]);
    const [overview, chartPayload, dailyPayload] = await Promise.all([
      overviewResponse?.ok ? overviewResponse.json().catch(() => null) : null,
      chartUpstream?.ok ? chartUpstream.json().catch(() => null) : null,
      dailyUpstream?.ok ? dailyUpstream.json().catch(() => null) : null,
    ]);

    const chartResult = chartPayload?.chart?.result?.[0];
    const price = chartResult?.meta?.regularMarketPrice ?? null;
    const selectedPreviousSession = previousSession(dailyPayload?.chart?.result?.[0], EUREX_TIME_ZONE);
    const previousClose = selectedPreviousSession?.close
      ?? chartResult?.meta?.chartPreviousClose
      ?? overview?.header?.underlyingClosingPrice
      ?? null;

    const todayCompact = berlinCompactDate();
    const overviewRows = overview?.dataRows ?? [];
    const weeklyDates = overviewRows
      .filter((row) => row.contractType === 'W' || row.contractType === 'E')
      .map((row) => String(row.date))
      .sort();
    const selectedDate = weeklyDates.find((date) => date === todayCompact)
      ?? weeklyDates.find((date) => date > todayCompact)
      ?? weeklyDates.at(-1)
      ?? null;
    const isNearestExpiration = Boolean(selectedDate && selectedDate !== todayCompact);
    const busdate = eurexTradingDateToCompact(overview?.header?.tradingDates?.[0]);

    let calls = [];
    let puts = [];
    let optionsError = null;
    let optionsWarning = null;
    let monthly = null;
    if (!selectedDate || !busdate) {
      optionsError = 'Eurex nie zwrócił tygodniowych terminów opcji DAX.';
    } else {
      const monthlyDate = overviewRows
        .filter((row) => row.contractType === 'E')
        .map((row) => String(row.date))
        .sort()
        .find((date) => date > selectedDate) ?? null;
      const detailUrl = `https://www.eurex.com/api/v1/overallstatistics/${market.eurexProductId}?filtertype=detail&productdate=${selectedDate}&busdate=${busdate}&contracttype=${market.eurexContractType}`;
      const monthlyUrl = monthlyDate
        ? `https://www.eurex.com/api/v1/overallstatistics/${market.eurexProductId}?filtertype=detail&productdate=${monthlyDate}&busdate=${busdate}&contracttype=monthly`
        : null;
      const [detailResponse, monthlyResponse] = await Promise.all([
        fetch(detailUrl, { headers: EUREX_HEADERS }).catch(() => null),
        monthlyUrl ? fetch(monthlyUrl, { headers: EUREX_HEADERS }).catch(() => null) : null,
      ]);
      const detail = detailResponse?.ok ? await detailResponse.json().catch(() => null) : null;
      if (!detail || (!(detail.dataRowsCall ?? []).length && !(detail.dataRowsPut ?? []).length)) {
        optionsError = `Brak opcji Eurex dla ${symbol} dziś ani w najbliższym terminie.`;
      } else {
        calls = (detail.dataRowsCall ?? []).map((row) => eurexContract(row, selectedDate, 'call', price));
        puts = (detail.dataRowsPut ?? []).map((row) => eurexContract(row, selectedDate, 'put', price));
        if (isNearestExpiration) optionsWarning = `Brak opcji 0DTE dla ${symbol}; pokazuję najbliższy termin.`;
      }
      const monthlyDetail = monthlyResponse?.ok ? await monthlyResponse.json().catch(() => null) : null;
      if (monthlyDate && monthlyDetail && ((monthlyDetail.dataRowsCall ?? []).length || (monthlyDetail.dataRowsPut ?? []).length)) {
        monthly = {
          date: monthlyDate,
          expiration: compactDateToEpoch(monthlyDate),
          calls: (monthlyDetail.dataRowsCall ?? []).map((row) => eurexContract(row, monthlyDate, 'call', price)),
          puts: (monthlyDetail.dataRowsPut ?? []).map((row) => eurexContract(row, monthlyDate, 'put', price)),
        };
      }
    }

    const timestamps = chartResult?.timestamp ?? [];
    const closes = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const history = timestamps.flatMap((time, index) => Number.isFinite(closes[index]) ? [{ time, close: closes[index] }] : []);
    const now = Math.floor(Date.now() / 1000);
    const overnightHistory = (futuresBars ?? [])
      .filter((bar) => bar.time >= now - 24 * 60 * 60)
      .map((bar) => ({ time: bar.time, close: bar.close }));
    const futuresPrevious = futuresBars?.length
      ? previousSessionFromBars(futuresBars, EUREX_TIME_ZONE)
      : null;
    const futuresPreviousDayHigh = futuresPrevious?.high ?? selectedPreviousSession?.high ?? null;
    const futuresPreviousDayClose = futuresPrevious?.close ?? selectedPreviousSession?.close ?? null;
    const futuresPreviousDayDate = futuresPrevious?.date ?? selectedPreviousSession?.date ?? null;

    const forward = overnightHistory.at(-1)?.close ?? null;
    let gex = null;
    if (forward && selectedDate) {
      const expiryUtc = Date.UTC(Number(selectedDate.slice(0, 4)), Number(selectedDate.slice(4, 6)) - 1, Number(selectedDate.slice(6, 8)), 16, 30);
      const timeYears = Math.max((expiryUtc - Date.now()) / (365.25 * 24 * 60 * 60 * 1000), 1 / (365.25 * 24 * 12));
      gex = computeGex(calls, puts, forward, timeYears, market.gexMultiplier);
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      symbol,
      cfdSymbol: market.cfdSymbol,
      futuresSymbol: market.futuresSymbol,
      referenceSymbol: market.referenceSymbol,
      confirmationSymbol: null,
      quote: {
        price,
        previousClose,
        changePercent: price !== null && previousClose ? (price / previousClose - 1) * 100 : null,
        currency: chartResult?.meta?.currency ?? 'EUR',
      },
      expirations: weeklyDates.map(compactDateToEpoch),
      selectedExpiration: selectedDate ? compactDateToEpoch(selectedDate) : null,
      isNearestExpiration,
      calls,
      puts,
      monthly,
      optionsError,
      optionsWarning,
      confirmation: null,
      confirmationWarning: null,
      chartRange: range,
      history,
      chartError: history.length ? null : chartPayload?.chart?.error?.description || 'Yahoo Finance nie zwrócił danych historycznych.',
      previousDayHigh: selectedPreviousSession?.high ?? null,
      previousDayClose: selectedPreviousSession?.close ?? null,
      previousDayDate: selectedPreviousSession?.date ?? null,
      todayOpen: todaySession(dailyPayload?.chart?.result?.[0], EUREX_TIME_ZONE)?.open ?? null,
      todayHigh: todaySession(dailyPayload?.chart?.result?.[0], EUREX_TIME_ZONE)?.high ?? null,
      todayLow: todaySession(dailyPayload?.chart?.result?.[0], EUREX_TIME_ZONE)?.low ?? null,
      referencePreviousDayHigh: selectedPreviousSession?.high ?? null,
      referencePreviousDayDate: selectedPreviousSession?.date ?? null,
      futuresPreviousDayHigh: futuresPreviousDayHigh,
      futuresPreviousDayClose: futuresPreviousDayClose,
      futuresPreviousDayDate: futuresPreviousDayDate,
      gex,
      overnightHistory,
      overnightError: overnightHistory.length ? null : 'FDAX futures history is unavailable.',
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Nie udało się połączyć z Eurex/Yahoo Finance.' });
  }
}

export default async function handler(request, response) {
  const symbol = String(request.query.symbol || 'QQQ').trim().toUpperCase();
  const expiration = request.query.date ? Number(request.query.date) : null;
  const range = String(request.query.range || '1d');

  if (!SYMBOL_PATTERN.test(symbol)) {
    return response.status(400).json({ error: 'Nieprawidłowy symbol.' });
  }
  const market = INSTRUMENT_MARKETS[symbol];
  if (!market) {
    return response.status(400).json({ error: 'Instrument nie ma skonfigurowanego rynku CFD.' });
  }
  if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= 0)) {
    return response.status(400).json({ error: 'Nieprawidłowy termin wygaśnięcia.' });
  }
  if (!Object.hasOwn(CHART_RANGES, range)) {
    return response.status(400).json({ error: 'Nieprawidłowy zakres wykresu.' });
  }
  if (market.eurexProductId) {
    return handleEurexChain(request, response, symbol, market, range);
  }

  const url = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
  if (expiration) url.searchParams.set('date', String(expiration));
  const chartUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  chartUrl.searchParams.set('range', range);
  chartUrl.searchParams.set('interval', CHART_RANGES[range]);
  chartUrl.searchParams.set('includePrePost', 'true');
  const dailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  dailyUrl.searchParams.set('range', '5d');
  dailyUrl.searchParams.set('interval', '1d');
  const referenceDailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.referenceSymbol)}`);
  referenceDailyUrl.searchParams.set('range', '5d');
  referenceDailyUrl.searchParams.set('interval', '1d');
  const overnightUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.futuresSymbol)}`);
  const now = Math.floor(Date.now() / 1000);
  overnightUrl.searchParams.set('period1', String(now - 24 * 60 * 60));
  overnightUrl.searchParams.set('period2', String(now));
  overnightUrl.searchParams.set('interval', '5m');
  overnightUrl.searchParams.set('includePrePost', 'true');
  const futuresDailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.futuresSymbol)}`);
  futuresDailyUrl.searchParams.set('range', '5d');
  futuresDailyUrl.searchParams.set('interval', '1d');

  try {
    const { cookie } = await getYahooSession();
    const requestHeaders = { ...YAHOO_HEADERS, Cookie: cookie };
    const [upstream, chartUpstream, dailyUpstream, referenceDailyUpstream, overnightUpstream, futuresDailyUpstream] = await Promise.all([
      fetchYahooOptions(url),
      fetch(chartUrl, { headers: requestHeaders }).catch(() => null),
      fetch(dailyUrl, { headers: requestHeaders }).catch(() => null),
      symbol === market.referenceSymbol ? null : fetch(referenceDailyUrl, { headers: requestHeaders }).catch(() => null),
      fetch(overnightUrl, { headers: requestHeaders }).catch(() => null),
      fetch(futuresDailyUrl, { headers: requestHeaders }).catch(() => null),
    ]);
    const [payload, chartPayload, dailyPayload, referenceDailyPayload, overnightPayload, futuresDailyPayload] = await Promise.all([
      upstream.json().catch(() => null),
      chartUpstream?.ok ? chartUpstream.json().catch(() => null) : null,
      dailyUpstream?.ok ? dailyUpstream.json().catch(() => null) : null,
      referenceDailyUpstream?.ok ? referenceDailyUpstream.json().catch(() => null) : null,
      overnightUpstream?.ok ? overnightUpstream.json().catch(() => null) : null,
      futuresDailyUpstream?.ok ? futuresDailyUpstream.json().catch(() => null) : null,
    ]);
    const result = payload?.optionChain?.result?.[0];

    if (!upstream.ok || payload?.optionChain?.error || !result) {
      const message = payload?.optionChain?.error?.description
        || payload?.finance?.error?.description
        || `Yahoo Finance zwrócił błąd HTTP ${upstream.status}.`;
      return response.status(upstream.status === 429 ? 429 : 502).json({ error: message });
    }

    let selectedOptions = result.options?.[0];
    let expirations = result.expirationDates ?? [];
    let isNearestExpiration = false;
    let optionsError = null;
    const hasContracts = (options) => (options?.calls?.length ?? 0) + (options?.puts?.length ?? 0) > 0;
    const hasRequestedExpiration = !expiration || (selectedOptions?.expirationDate === expiration && hasContracts(selectedOptions));

    if (expiration && !hasRequestedExpiration) {
      const nearestUrl = new URL(url);
      nearestUrl.searchParams.delete('date');
      const nearestResponse = await fetchYahooOptions(nearestUrl);
      const nearestPayload = nearestResponse.ok ? await nearestResponse.json().catch(() => null) : null;
      const nearestResult = nearestPayload?.optionChain?.result?.[0];
      const nearestOptions = nearestResult?.options?.find((options) => options.expirationDate >= expiration && hasContracts(options));

      if (nearestOptions) {
        selectedOptions = nearestOptions;
        expirations = nearestResult.expirationDates ?? expirations;
        isNearestExpiration = true;
      } else {
        optionsError = `Brak opcji dla ${symbol} dziś ani w najbliższym terminie.`;
      }
    }

    let confirmation = null;
    let confirmationWarning = null;
    let confirmationDailyResult = null;
    if (market.confirmationSymbol && (selectedOptions?.expirationDate || market.confirmationQuoteWithoutOptions)) {
      const confirmationUrl = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(market.confirmationSymbol)}`);
      if (selectedOptions?.expirationDate) confirmationUrl.searchParams.set('date', String(selectedOptions.expirationDate));
      const confirmationChartUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.confirmationSymbol)}`);
      confirmationChartUrl.searchParams.set('range', range);
      confirmationChartUrl.searchParams.set('interval', CHART_RANGES[range]);
      confirmationChartUrl.searchParams.set('includePrePost', 'true');
      const sharesReferenceDaily = market.confirmationSymbol === market.referenceSymbol;
      const confirmationDailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.confirmationSymbol)}`);
      confirmationDailyUrl.searchParams.set('range', '5d');
      confirmationDailyUrl.searchParams.set('interval', '1d');
      const [confirmationResponse, confirmationChartResponse, confirmationDailyResponse] = await Promise.all([
        selectedOptions?.expirationDate ? fetchYahooOptions(confirmationUrl).catch(() => null) : null,
        fetch(confirmationChartUrl, { headers: requestHeaders }).catch(() => null),
        sharesReferenceDaily ? null : fetch(confirmationDailyUrl, { headers: requestHeaders }).catch(() => null),
      ]);
      const [confirmationPayload, confirmationChartPayload, confirmationDailyPayload] = await Promise.all([
        confirmationResponse?.ok ? confirmationResponse.json().catch(() => null) : null,
        confirmationChartResponse?.ok ? confirmationChartResponse.json().catch(() => null) : null,
        confirmationDailyResponse?.ok ? confirmationDailyResponse.json().catch(() => null) : null,
      ]);
      const confirmationResult = confirmationPayload?.optionChain?.result?.[0];
      const confirmationOptions = confirmationResult?.options?.find((options) => options.expirationDate === selectedOptions?.expirationDate && hasContracts(options));

      const peerChart = confirmationChartPayload?.chart?.result?.[0];
      const peerTimestamps = peerChart?.timestamp ?? [];
      const peerCloses = peerChart?.indicators?.quote?.[0]?.close ?? [];
      const peerHistory = peerTimestamps.flatMap((time, index) => Number.isFinite(peerCloses[index]) ? [{ time, close: peerCloses[index] }] : []);
      confirmationDailyResult = sharesReferenceDaily
        ? (symbol === market.referenceSymbol ? dailyPayload : referenceDailyPayload)?.chart?.result?.[0]
        : confirmationDailyPayload?.chart?.result?.[0];
      const confirmationPreviousSession = previousSession(confirmationDailyResult);
      const peerPrice = market.confirmationQuoteWithoutOptions
        ? peerChart?.meta?.regularMarketPrice ?? null
        : confirmationResult?.quote?.regularMarketPrice ?? peerChart?.meta?.regularMarketPrice ?? null;
      const peerPreviousClose = confirmationPreviousSession?.close
        ?? (market.confirmationQuoteWithoutOptions ? peerChart?.meta?.previousClose : null)
        ?? confirmationResult?.quote?.regularMarketPreviousClose
        ?? null;
      const peerChangePercent = Number.isFinite(peerPrice) && Number.isFinite(peerPreviousClose) && peerPreviousClose !== 0
        ? (peerPrice / peerPreviousClose - 1) * 100
        : null;

      if (confirmationOptions || peerHistory.length || (market.confirmationQuoteWithoutOptions && (peerPrice !== null || todaySession(confirmationDailyResult)))) {
        confirmation = {
          symbol: market.confirmationSymbol,
          price: peerPrice,
          changePercent: peerChangePercent,
          previousClose: peerPreviousClose,
          previousDayHigh: confirmationPreviousSession?.high ?? null,
          previousDayDate: confirmationPreviousSession?.date ?? null,
          calls: confirmationOptions?.calls ?? [],
          puts: confirmationOptions?.puts ?? [],
          history: peerHistory,
        };
        if (!confirmationOptions) confirmationWarning = `Brak chainu ${market.confirmationSymbol} dla tego samego terminu.`;
      } else {
        confirmationWarning = `Brak chainu ${market.confirmationSymbol} dla tego samego terminu.`;
      }
    }

    const chartResult = chartPayload?.chart?.result?.[0];
    const timestamps = chartResult?.timestamp ?? [];
    const closes = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const history = timestamps.flatMap((time, index) => Number.isFinite(closes[index]) ? [{ time, close: closes[index] }] : []);
    const selectedPreviousSession = previousSession(dailyPayload?.chart?.result?.[0]);
    const referencePreviousSession = symbol === market.referenceSymbol
      ? selectedPreviousSession
      : previousSession(referenceDailyPayload?.chart?.result?.[0]);
    const futuresPreviousSession = previousSession(futuresDailyPayload?.chart?.result?.[0]);
    const overnightResult = overnightPayload?.chart?.result?.[0];
    const overnightTimestamps = overnightResult?.timestamp ?? [];
    const overnightCloses = overnightResult?.indicators?.quote?.[0]?.close ?? [];
    const overnightHistory = overnightTimestamps.flatMap((time, index) => Number.isFinite(overnightCloses[index]) ? [{ time, close: overnightCloses[index] }] : []);

    const forward = overnightHistory.at(-1)?.close ?? result.quote?.regularMarketPrice ?? null;
    let gex = null;
    if (forward && selectedOptions?.expirationDate) {
      const expiryMs = selectedOptions.expirationDate * 1000 + 21 * 60 * 60 * 1000;
      const timeYears = Math.max((expiryMs - Date.now()) / (365.25 * 24 * 60 * 60 * 1000), 1 / (365.25 * 24 * 12));
      gex = computeGex(selectedOptions?.calls ?? [], selectedOptions?.puts ?? [], forward, timeYears, market.gexMultiplier);
    }

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      symbol,
      cfdSymbol: market.cfdSymbol,
      futuresSymbol: market.futuresSymbol,
      referenceSymbol: market.referenceSymbol,
      confirmationSymbol: market.confirmationSymbol ?? null,
      quote: {
        price: result.quote?.regularMarketPrice ?? null,
        previousClose: result.quote?.regularMarketPreviousClose ?? null,
        changePercent: result.quote?.regularMarketChangePercent ?? null,
        currency: result.quote?.currency ?? 'USD',
      },
      expirations,
      selectedExpiration: selectedOptions?.expirationDate ?? expiration,
      isNearestExpiration,
      calls: selectedOptions?.calls ?? [],
      puts: selectedOptions?.puts ?? [],
      optionsError,
      optionsWarning: isNearestExpiration ? `Brak opcji 0DTE dla ${symbol}; pokazuję najbliższy termin.` : null,
      confirmation,
      confirmationWarning,
      chartRange: range,
      history,
      chartError: history.length ? null : chartPayload?.chart?.error?.description || 'Yahoo Finance nie zwrócił danych historycznych.',
      previousDayHigh: selectedPreviousSession?.high ?? null,
      previousDayClose: selectedPreviousSession?.close ?? null,
      previousDayDate: selectedPreviousSession?.date ?? null,
      todayOpen: todaySession(dailyPayload?.chart?.result?.[0])?.open ?? null,
      todayHigh: todaySession(dailyPayload?.chart?.result?.[0])?.high ?? null,
      todayLow: todaySession(dailyPayload?.chart?.result?.[0])?.low ?? null,
      confirmationTodayOpen: confirmation ? todaySession(confirmationDailyResult)?.open ?? null : null,
      confirmationTodayHigh: confirmation ? todaySession(confirmationDailyResult)?.high ?? null : null,
      confirmationTodayLow: confirmation ? todaySession(confirmationDailyResult)?.low ?? null : null,
      referencePreviousDayHigh: referencePreviousSession?.high ?? null,
      referencePreviousDayDate: referencePreviousSession?.date ?? null,
      futuresPreviousDayHigh: futuresPreviousSession?.high ?? null,
      futuresPreviousDayClose: futuresPreviousSession?.close ?? null,
      futuresPreviousDayDate: futuresPreviousSession?.date ?? null,
      overnightHistory,
      overnightError: overnightHistory.length ? null : overnightResult?.meta?.symbol ? 'No overnight futures history.' : 'Nasdaq futures history is unavailable.',
      gex,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Yahoo Finance request failed:', error);
    return response.status(502).json({ error: 'Nie udało się połączyć z Yahoo Finance.' });
  }
}