# QQQ Options Desk

Vite + React app for viewing calls and puts from Yahoo Finance. The browser requests `/api/options`; the Vercel function fetches the Yahoo Finance response server-side.

DAX (`^GDAXI`) is sourced from Eurex instead: the function reads DAX® End-of-Day Options (ODAP, weekly contracts) from the Eurex statistics API (`/api/v1/overallstatistics/3734540`) and combines them with the Yahoo Finance index chart. The futures leg (FDAX, quoted roughly 02:00–22:00 CET) comes from the public TradingView WebSocket feed (`EUREX:FDAX1!`, delayed ~15 min).

QQQ, SPY and DIA option walls are also displayed in the corresponding cash index units (NDX, SPX and DJI). Each ETF strike is multiplied by the index's previous-session high divided by the ETF's high from the same session. These cash levels are only approximations of US100, US500 and US30 CFD prices; they do not include a broker's CFD basis. Conversion is unavailable if the highs or their session dates are missing or do not match.

Charts show the two nearest selected put and call walls per chart by default. The shared **All walls** and **GEX + Flip** controls reveal additional lines without changing the tables or calculations. Overlapping labels are grouped on the chart; each value is shown below it, with full precision on hover. Distant levels do not expand the price scale and are listed separately below the chart.

Information buttons explain the displayed market data, wall selection, confluence, ETF conversion, and the GEX/flip estimates. Open them with a pointer, keyboard focus, or tap; Escape dismisses the tooltip. GEX uses assumed call/put signs and the displayed flip is an interpolation between adjacent strike-level values, not an observed dealer position or a market-wide gamma-flip calculation.

For DIA, the header displays the Dow Jones Industrial Average (`^DJI`) price, daily change, and session OHLC. The option chain, wall calculations, conversion, and main chart remain in DIA units.

## Local development

```sh
npm install
npm run dev
```

The options API runs as a Vercel function. For a full local preview, install the Vercel CLI and run `vercel dev`.

## Deploy to Vercel

Import the repository in Vercel and keep the detected Vite settings: build command `npm run build`, output directory `dist`. No environment variables are required.

Yahoo Finance can rate-limit or change its unauthenticated endpoint. Market data may be delayed; this app is for informational purposes, not investment advice.