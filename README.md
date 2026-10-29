# QQQ Options Desk

Vite + React app for viewing calls and puts from Yahoo Finance. The browser requests `/api/options`; the Vercel function fetches the Yahoo Finance response server-side.

DAX (`^GDAXI`) is sourced from Eurex instead: the function reads DAX® End-of-Day Options (ODAP, weekly contracts) from the Eurex statistics API (`/api/v1/overallstatistics/3734540`) and combines them with the Yahoo Finance index chart. The futures leg (FDAX, quoted roughly 02:00–22:00 CET) comes from the public TradingView WebSocket feed (`EUREX:FDAX1!`, delayed ~15 min) and provides the overnight chart plus futures previous-day high/close for the CFD conversion. Option wall levels are mapped to FDAX via the previous-day-high ratio; entering your broker's DE40 previous high additionally rescales the overnight chart and levels to your CFD.

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