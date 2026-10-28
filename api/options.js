const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;
const CHART_RANGES = { '1d': '5m' };
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionsDesk/1.0)' };
let cachedYahooSession = null;

function newYorkDate(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp * 1000));
}

function previousSession(dailyResult) {
  const timestamps = dailyResult?.timestamp ?? [];
  const highs = dailyResult?.indicators?.quote?.[0]?.high ?? [];
  const todayInNewYork = newYorkDate(Date.now() / 1000);
  return timestamps
    .map((time, index) => ({ time, high: highs[index], date: newYorkDate(time) }))
    .filter((bar) => bar.date < todayInNewYork && Number.isFinite(bar.high))
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

export default async function handler(request, response) {
  const symbol = String(request.query.symbol || 'QQQ').trim().toUpperCase();
  const expiration = request.query.date ? Number(request.query.date) : null;
  const range = String(request.query.range || '1d');

  if (!SYMBOL_PATTERN.test(symbol)) {
    return response.status(400).json({ error: 'Nieprawidłowy symbol.' });
  }
  if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= 0)) {
    return response.status(400).json({ error: 'Nieprawidłowy termin wygaśnięcia.' });
  }
  if (!Object.hasOwn(CHART_RANGES, range)) {
    return response.status(400).json({ error: 'Nieprawidłowy zakres wykresu.' });
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
  const qqqDailyUrl = new URL('https://query1.finance.yahoo.com/v8/finance/chart/QQQ');
  qqqDailyUrl.searchParams.set('range', '5d');
  qqqDailyUrl.searchParams.set('interval', '1d');
  const overnightUrl = new URL('https://query1.finance.yahoo.com/v8/finance/chart/NQ=F');
  overnightUrl.searchParams.set('range', '1d');
  overnightUrl.searchParams.set('interval', '5m');
  overnightUrl.searchParams.set('includePrePost', 'true');
  const futuresDailyUrl = new URL('https://query1.finance.yahoo.com/v8/finance/chart/NQ=F');
  futuresDailyUrl.searchParams.set('range', '5d');
  futuresDailyUrl.searchParams.set('interval', '1d');

  try {
    const { cookie, crumb } = await getYahooSession();
    url.searchParams.set('crumb', crumb);
    const requestHeaders = { ...YAHOO_HEADERS, Cookie: cookie };
    const [upstream, chartUpstream, dailyUpstream, qqqDailyUpstream, overnightUpstream, futuresDailyUpstream] = await Promise.all([
      fetch(url, { headers: requestHeaders }),
      fetch(chartUrl, { headers: requestHeaders }).catch(() => null),
      fetch(dailyUrl, { headers: requestHeaders }).catch(() => null),
      symbol === 'QQQ' ? null : fetch(qqqDailyUrl, { headers: requestHeaders }).catch(() => null),
      fetch(overnightUrl, { headers: requestHeaders }).catch(() => null),
      fetch(futuresDailyUrl, { headers: requestHeaders }).catch(() => null),
    ]);
    const [payload, chartPayload, dailyPayload, qqqDailyPayload, overnightPayload, futuresDailyPayload] = await Promise.all([
      upstream.json(),
      chartUpstream?.ok ? chartUpstream.json().catch(() => null) : null,
      dailyUpstream?.ok ? dailyUpstream.json().catch(() => null) : null,
      qqqDailyUpstream?.ok ? qqqDailyUpstream.json().catch(() => null) : null,
      overnightUpstream?.ok ? overnightUpstream.json().catch(() => null) : null,
      futuresDailyUpstream?.ok ? futuresDailyUpstream.json().catch(() => null) : null,
    ]);
    const result = payload?.optionChain?.result?.[0];

    if (!upstream.ok || payload?.optionChain?.error || !result) {
      const message = payload?.optionChain?.error?.description || 'Yahoo Finance nie zwrócił danych dla tego symbolu.';
      return response.status(upstream.status === 429 ? 429 : 502).json({ error: message });
    }

    const selectedOptions = result.options?.[0];
    const hasContracts = (selectedOptions?.calls?.length ?? 0) + (selectedOptions?.puts?.length ?? 0) > 0;
    if (expiration && (selectedOptions?.expirationDate !== expiration || !hasContracts)) {
      return response.status(404).json({ error: `Brak opcji wygasających dziś dla ${symbol} (0DTE).` });
    }

    const chartResult = chartPayload?.chart?.result?.[0];
    const timestamps = chartResult?.timestamp ?? [];
    const closes = chartResult?.indicators?.quote?.[0]?.close ?? [];
    const history = timestamps.flatMap((time, index) => Number.isFinite(closes[index]) ? [{ time, close: closes[index] }] : []);
    const selectedPreviousSession = previousSession(dailyPayload?.chart?.result?.[0]);
    const qqqPreviousSession = symbol === 'QQQ'
      ? selectedPreviousSession
      : previousSession(qqqDailyPayload?.chart?.result?.[0]);
    const futuresPreviousSession = previousSession(futuresDailyPayload?.chart?.result?.[0]);
    const overnightResult = overnightPayload?.chart?.result?.[0];
    const overnightTimestamps = overnightResult?.timestamp ?? [];
    const overnightCloses = overnightResult?.indicators?.quote?.[0]?.close ?? [];
    const overnightHistory = overnightTimestamps.flatMap((time, index) => Number.isFinite(overnightCloses[index]) ? [{ time, close: overnightCloses[index] }] : []);

    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).json({
      symbol,
      quote: {
        price: result.quote?.regularMarketPrice ?? null,
        previousClose: result.quote?.regularMarketPreviousClose ?? null,
        changePercent: result.quote?.regularMarketChangePercent ?? null,
        currency: result.quote?.currency ?? 'USD',
      },
      expirations: result.expirationDates ?? [],
      selectedExpiration: selectedOptions?.expirationDate ?? expiration,
      calls: selectedOptions?.calls ?? [],
      puts: selectedOptions?.puts ?? [],
      chartRange: range,
      history,
      chartError: history.length ? null : chartPayload?.chart?.error?.description || 'Yahoo Finance nie zwrócił danych historycznych.',
      previousDayHigh: selectedPreviousSession?.high ?? null,
      previousDayDate: selectedPreviousSession?.date ?? null,
      qqqPreviousDayHigh: qqqPreviousSession?.high ?? null,
      qqqPreviousDayDate: qqqPreviousSession?.date ?? null,
      futuresPreviousDayHigh: futuresPreviousSession?.high ?? null,
      futuresPreviousDayDate: futuresPreviousSession?.date ?? null,
      overnightHistory,
      overnightError: overnightHistory.length ? null : overnightResult?.meta?.symbol ? 'No overnight futures history.' : 'Nasdaq futures history is unavailable.',
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Nie udało się połączyć z Yahoo Finance.' });
  }
}