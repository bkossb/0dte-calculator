import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/options.js';

const expiration = 2000000000;
const dailyValues = {
  '^NDX': [100, 110, 90],
  QQQ: [200, 210, 190],
  '^SPX': [300, 310, 290],
  SPY: [400, 410, 390],
  DIA: [500, 510, 490],
  '^DJI': [600, 610, 590],
  GLD: [700, 710, 690],
};

function mockFetch(input) {
  const url = new URL(input);
  if (url.hostname === 'fc.yahoo.com') {
    return Promise.resolve(new Response('', { headers: { 'set-cookie': 'test=session; Path=/' } }));
  }
  if (url.pathname === '/v1/test/getcrumb') return Promise.resolve(new Response('test-crumb'));

  const symbol = decodeURIComponent(url.pathname.split('/').at(-1));
  if (url.pathname.includes('/finance/options/')) {
    return Promise.resolve(Response.json({
      optionChain: { result: [{
        quote: { regularMarketPrice: 100 },
        expirationDates: [expiration],
        options: [{ expirationDate: expiration, calls: [{ strike: 100 }], puts: [] }],
      }] },
    }));
  }
  if (url.pathname.includes('/finance/chart/')) {
    const [open, high, low] = dailyValues[symbol] ?? [1, 2, 0];
    return Promise.resolve(Response.json({
      chart: { result: [{
        meta: { regularMarketPrice: open, previousClose: open - 50 },
        timestamp: [Math.floor(Date.now() / 1000)],
        indicators: { quote: [{ open: [open], high: [high], low: [low], close: [open] }] },
      }] },
    }));
  }
  throw new Error(`Unexpected request: ${url}`);
}

async function request(symbol) {
  const response = {
    statusCode: 0,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  await handler({ query: { symbol } }, response);
  return response;
}

test('Yahoo responses retain confirmation daily data without failing', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  for (const [symbol, confirmationSymbol] of [
    ['^NDX', 'QQQ'],
    ['^SPX', 'SPY'],
    ['DIA', '^DJI'],
  ]) {
    const response = await request(symbol);
    assert.equal(response.statusCode, 200, `${symbol}: ${response.body?.error}`);
    assert.equal(response.body.confirmation.symbol, confirmationSymbol);
    assert.deepEqual(
      [response.body.confirmationTodayOpen, response.body.confirmationTodayHigh, response.body.confirmationTodayLow],
      dailyValues[confirmationSymbol],
    );
  }

  const response = await request('GLD');
  assert.equal(response.statusCode, 200, response.body?.error);
  assert.equal(response.body.confirmation, null);
  assert.equal(response.body.confirmationTodayOpen, null);
  assert.equal(response.body.confirmationTodayHigh, null);
  assert.equal(response.body.confirmationTodayLow, null);
});

test('DIA retains its option prices while the DJI quote is available without an index option chain', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/options/%5EDJI')) {
      return Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 404 }));
    }
    return mockFetch(input);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await request('DIA');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.quote.price, 100);
  assert.equal(response.body.calls[0].strike, 100);
  assert.equal(response.body.history[0].close, 500);
  assert.equal(response.body.confirmation.price, 600);
  assert.equal(response.body.confirmation.changePercent, (600 / 550 - 1) * 100);
  assert.deepEqual(
    [response.body.confirmationTodayOpen, response.body.confirmationTodayHigh, response.body.confirmationTodayLow],
    [600, 610, 590],
  );
});

test('DIA still fetches DJI quotes when there is no selected option expiration', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestedIndexOptions = false;
  globalThis.fetch = (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/options/DIA')) {
      return Promise.resolve(Response.json({
        optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: [], options: [] }] },
      }));
    }
    if (url.pathname.endsWith('/options/%5EDJI')) requestedIndexOptions = true;
    return mockFetch(input);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await request('DIA');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.confirmation.price, 600);
  assert.equal(response.body.confirmationTodayOpen, 600);
  assert.equal(requestedIndexOptions, false);
});

test('DIA never substitutes its own quote when the DJI chart is unavailable', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/chart/%5EDJI') && url.searchParams.get('interval') !== '1d') {
      return Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 }));
    }
    return mockFetch(input);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const response = await request('DIA');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.quote.price, 100);
  assert.equal(response.body.confirmation.price, null);
  assert.equal(response.body.confirmation.changePercent, null);
  assert.equal(response.body.confirmationTodayOpen, 600);
});
