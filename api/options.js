const SYMBOL_PATTERN = /^[A-Z0-9.^=-]{1,15}$/;
const YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionsDesk/1.0)' };
let cachedYahooSession = null;

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

  if (!SYMBOL_PATTERN.test(symbol)) {
    return response.status(400).json({ error: 'Nieprawidłowy symbol.' });
  }
  if (expiration !== null && (!Number.isSafeInteger(expiration) || expiration <= 0)) {
    return response.status(400).json({ error: 'Nieprawidłowy termin wygaśnięcia.' });
  }

  const url = new URL(`https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}`);
  if (expiration) url.searchParams.set('date', String(expiration));

  try {
    const { cookie, crumb } = await getYahooSession();
    url.searchParams.set('crumb', crumb);
    const upstream = await fetch(url, {
      headers: { ...YAHOO_HEADERS, Cookie: cookie },
    });
    const payload = await upstream.json();
    const result = payload?.optionChain?.result?.[0];

    if (!upstream.ok || payload?.optionChain?.error || !result) {
      const message = payload?.optionChain?.error?.description || 'Yahoo Finance nie zwrócił danych dla tego symbolu.';
      return response.status(upstream.status === 429 ? 429 : 502).json({ error: message });
    }

    response.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return response.status(200).json({
      symbol,
      quote: {
        price: result.quote?.regularMarketPrice ?? null,
        previousClose: result.quote?.regularMarketPreviousClose ?? null,
        changePercent: result.quote?.regularMarketChangePercent ?? null,
        currency: result.quote?.currency ?? 'USD',
      },
      expirations: result.expirationDates ?? [],
      selectedExpiration: result.options?.[0]?.expirationDate ?? expiration,
      calls: result.options?.[0]?.calls ?? [],
      puts: result.options?.[0]?.puts ?? [],
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return response.status(502).json({ error: 'Nie udało się połączyć z Yahoo Finance.' });
  }
}