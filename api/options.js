const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;
const CHART_RANGES = { '1d': '5m' };
const INSTRUMENT_MARKETS = {
  SPY: { cfdSymbol: 'US500', futuresSymbol: 'ES=F', referenceSymbol: 'SPY', confirmationSymbol: '^SPX' },
  QQQ: { cfdSymbol: 'US100', futuresSymbol: 'NQ=F', referenceSymbol: 'QQQ', confirmationSymbol: '^NDX' },
  '^NDX': { cfdSymbol: 'US100', futuresSymbol: 'NQ=F', referenceSymbol: 'QQQ', confirmationSymbol: 'QQQ' },
  '^SPX': { cfdSymbol: 'US500', futuresSymbol: 'ES=F', referenceSymbol: 'SPY', confirmationSymbol: 'SPY' },
  DIA: { cfdSymbol: 'US30', futuresSymbol: 'YM=F', referenceSymbol: 'DIA' },
  GLD: { cfdSymbol: 'XAUUSD', futuresSymbol: 'GC=F', referenceSymbol: 'GLD' },
  '^GDAXI': { cfdSymbol: 'DE40', futuresSymbol: '^GDAXI', referenceSymbol: '^GDAXI', eurexProductId: 3734540, eurexContractType: 'weekly' },
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
  const overnightUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.futuresSymbol)}`);
  const now = Math.floor(Date.now() / 1000);
  overnightUrl.searchParams.set('period1', String(now - 24 * 60 * 60));
  overnightUrl.searchParams.set('period2', String(now));
  overnightUrl.searchParams.set('interval', '5m');
  overnightUrl.searchParams.set('includePrePost', 'true');
  const overviewUrl = `https://www.eurex.com/api/v1/overallstatistics/${market.eurexProductId}?filtertype=overview`;

  try {
    const { cookie } = await getYahooSession();
    const requestHeaders = { ...YAHOO_HEADERS, Cookie: cookie };
    const [overviewResponse, chartUpstream, dailyUpstream, overnightUpstream] = await Promise.all([
      fetch(overviewUrl, { headers: EUREX_HEADERS }).catch(() => null),
      fetch(chartUrl, { headers: requestHeaders }).catch(() => null),
      fetch(dailyUrl, { headers: requestHeaders }).catch(() => null),
      fetch(overnightUrl, { headers: requestHeaders }).catch(() => null),
    ]);
    const [overview, chartPayload, dailyPayload, overnightPayload] = await Promise.all([
      overviewResponse?.ok ? overviewResponse.json().catch(() => null) : null,
      chartUpstream?.ok ? chartUpstream.json().catch(() => null) : null,
      dailyUpstream?.ok ? dailyUpstream.json().catch(() => null) : null,
      overnightUpstream?.ok ? overnightUpstream.json().catch(() => null) : null,
    ]);

    const chartResult = chartPayload?.chart?.result?.[0];
    const price = chartResult?.meta?.regularMarketPrice ?? null;
    const selectedPreviousSession = previousSession(dailyPayload?.chart?.result?.[0], EUREX_TIME_ZONE);
    const previousClose = selectedPreviousSession?.close
      ?? chartResult?.meta?.chartPreviousClose
      ?? overview?.header?.underlyingClosingPrice
      ?? null;

    const todayCompact = berlinCompactDate();
    const weeklyDates = (overview?.dataRows ?? [])
      .filter((row) => row.contractType === 'W')
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
    if (!selectedDate || !busdate) {
      optionsError = 'Eurex nie zwrócił tygodniowych terminów opcji DAX.';
    } else {
      const detailUrl = `https://www.eurex.com/api/v1/overallstatistics/${market.eurexProductId}?filtertype=detail&productdate=${selectedDate}&busdate=${busdate}&contracttype=${market.eurexContractType}`;
      const detailResponse = await fetch(detailUrl, { headers: EUREX_HEADERS }).catch(() => null);
      const detail = detailResponse?.ok ? await detailResponse.json().catch(() => null) : null;
      if (!detail || (!(detail.dataRowsCall ?? []).length && !(detail.dataRowsPut ?? []).length)) {
        optionsError = `Brak opcji Eurex dla ${symbol} dziś ani w najbliższym terminie.`;
      } else {
        calls = (detail.dataRowsCall ?? []).map((row) => eurexContract(row, selectedDate, 'call', price));
        puts = (detail.dataRowsPut ?? []).map((row) => eurexContract(row, selectedDate, 'put', price));
        if (isNearestExpiration) optionsWarning = `Brak opcji 0DTE dla ${symbol}; pokazuję najbliższy termin.`;
      }
    }

    const timestamps = chartResult?.timestamp ?? [];
    const closes = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const history = timestamps.flatMap((time, index) => Number.isFinite(closes[index]) ? [{ time, close: closes[index] }] : []);
    const overnightResult = overnightPayload?.chart?.result?.[0];
    const overnightTimestamps = overnightResult?.timestamp ?? [];
    const overnightCloses = overnightResult?.indicators?.quote?.[0]?.close ?? [];
    const overnightHistory = overnightTimestamps.flatMap((time, index) => Number.isFinite(overnightCloses[index]) ? [{ time, close: overnightCloses[index] }] : []);

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
      referencePreviousDayHigh: selectedPreviousSession?.high ?? null,
      referencePreviousDayDate: selectedPreviousSession?.date ?? null,
      futuresPreviousDayHigh: selectedPreviousSession?.high ?? null,
      futuresPreviousDayClose: selectedPreviousSession?.close ?? null,
      futuresPreviousDayDate: selectedPreviousSession?.date ?? null,
      overnightHistory,
      overnightError: overnightHistory.length ? null : 'DAX index history is unavailable.',
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
    if (market.confirmationSymbol && selectedOptions?.expirationDate) {
      const confirmationUrl = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(market.confirmationSymbol)}`);
      confirmationUrl.searchParams.set('date', String(selectedOptions.expirationDate));
      const confirmationChartUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.confirmationSymbol)}`);
      confirmationChartUrl.searchParams.set('range', range);
      confirmationChartUrl.searchParams.set('interval', CHART_RANGES[range]);
      confirmationChartUrl.searchParams.set('includePrePost', 'true');
      const sharesReferenceDaily = market.confirmationSymbol === market.referenceSymbol;
      const confirmationDailyUrl = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(market.confirmationSymbol)}`);
      confirmationDailyUrl.searchParams.set('range', '5d');
      confirmationDailyUrl.searchParams.set('interval', '1d');
      const [confirmationResponse, confirmationChartResponse, confirmationDailyResponse] = await Promise.all([
        fetchYahooOptions(confirmationUrl).catch(() => null),
        fetch(confirmationChartUrl, { headers: requestHeaders }).catch(() => null),
        sharesReferenceDaily ? null : fetch(confirmationDailyUrl, { headers: requestHeaders }).catch(() => null),
      ]);
      const [confirmationPayload, confirmationChartPayload, confirmationDailyPayload] = await Promise.all([
        confirmationResponse?.ok ? confirmationResponse.json().catch(() => null) : null,
        confirmationChartResponse?.ok ? confirmationChartResponse.json().catch(() => null) : null,
        confirmationDailyResponse?.ok ? confirmationDailyResponse.json().catch(() => null) : null,
      ]);
      const confirmationResult = confirmationPayload?.optionChain?.result?.[0];
      const confirmationOptions = confirmationResult?.options?.find((options) => options.expirationDate === selectedOptions.expirationDate && hasContracts(options));

      if (confirmationOptions) {
        const peerChart = confirmationChartPayload?.chart?.result?.[0];
        const peerTimestamps = peerChart?.timestamp ?? [];
        const peerCloses = peerChart?.indicators?.quote?.[0]?.close ?? [];
        const confirmationDailyResult = sharesReferenceDaily
          ? (symbol === market.referenceSymbol ? dailyPayload : referenceDailyPayload)?.chart?.result?.[0]
          : confirmationDailyPayload?.chart?.result?.[0];
        const confirmationPreviousSession = previousSession(confirmationDailyResult);
        confirmation = {
          symbol: market.confirmationSymbol,
          price: confirmationResult.quote?.regularMarketPrice ?? null,
          previousClose: confirmationPreviousSession?.close ?? confirmationResult.quote?.regularMarketPreviousClose ?? null,
          previousDayHigh: confirmationPreviousSession?.high ?? null,
          calls: confirmationOptions.calls ?? [],
          puts: confirmationOptions.puts ?? [],
          history: peerTimestamps.flatMap((time, index) => Number.isFinite(peerCloses[index]) ? [{ time, close: peerCloses[index] }] : []),
        };
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
      referencePreviousDayHigh: referencePreviousSession?.high ?? null,
      referencePreviousDayDate: referencePreviousSession?.date ?? null,
      futuresPreviousDayHigh: futuresPreviousSession?.high ?? null,
      futuresPreviousDayClose: futuresPreviousSession?.close ?? null,
      futuresPreviousDayDate: futuresPreviousSession?.date ?? null,
      overnightHistory,
      overnightError: overnightHistory.length ? null : overnightResult?.meta?.symbol ? 'No overnight futures history.' : 'Nasdaq futures history is unavailable.',
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Nie udało się połączyć z Yahoo Finance.' });
  }
}