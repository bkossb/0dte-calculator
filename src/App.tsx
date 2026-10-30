import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, RefreshCw, Search } from 'lucide-react';
import type { Chain, ChartLevel, WallConfluence } from './types';
import { CONFLUENCE_TOLERANCE_PCT, instruments } from './config/instruments';
import { compact, display, expirationLabel, heat, numberFormat, percentage, todayExpiration } from './lib/format';
import { etfToCashFactor } from './lib/etfConversion';
import { specialWallMatches, wallCashPrice } from './lib/wallAnalysis';
import { helpText } from './lib/helpText';
import { BROWSER_TIME_ZONE, isValidTimeZone, readTimeZonePreference, TIME_ZONE_STORAGE_KEY, timeZoneOptions } from './lib/timeZone';
import { selectWallContracts, wallMetric } from './lib/walls';
import { HelpTip } from './components/HelpTip';
import { PriceChart } from './components/PriceChart';
import { WallAnalysis, type AnalysisGroup } from './components/WallAnalysis';

const chartLegend = [
  { title: 'PUT WALLS', color: '#f18270', help: helpText.walls },
  { title: 'SPOT', color: '#d8e2da', help: helpText.spot },
  { title: 'PDH', color: '#f3c969', help: helpText.pdh },
  { title: 'PDC', color: '#7aa2f7', help: helpText.pdc },
  { title: 'CALL WALLS', color: '#55c99b', help: helpText.walls },
];
export default function App() {
  const [symbol, setSymbol] = useState('^NDX');
  const [chain, setChain] = useState<Chain | null>(null);
  const [expiration, setExpiration] = useState(todayExpiration());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [goldCfdHigh, setGoldCfdHigh] = useState(() => {
    try { return window.localStorage.getItem('xauusd-previous-high') ?? ''; } catch { return ''; }
  });
  const [showAllWalls, setShowAllWalls] = useState(false);
  const [showGex, setShowGex] = useState(false);
  const [browserTimeZone, setBrowserTimeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [timeZonePreference, setTimeZonePreference] = useState(() => {
    try {
      return readTimeZonePreference(window.localStorage);
    } catch (error) {
      console.error('Nie można odczytać zapisanej strefy czasowej:', error);
      return { selection: BROWSER_TIME_ZONE, warning: 'Nie można odczytać zapisanej strefy czasowej. Używana jest strefa przeglądarki.' };
    }
  });
  const timeZone = timeZonePreference.selection === BROWSER_TIME_ZONE ? browserTimeZone : timeZonePreference.selection;
  const availableTimeZones = useMemo(() => timeZoneOptions(browserTimeZone, timeZonePreference.selection), [browserTimeZone, timeZonePreference.selection]);
  const requestIdRef = useRef(0);
  const activeInstrument = instruments.find((instrument) => instrument.symbol === symbol);
  const cfdSymbol = activeInstrument?.cfdSymbol ?? chain?.cfdSymbol ?? 'US100';

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
      setUpdatedAt(Date.now());
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

  useEffect(() => {
    const updateBrowserTimeZone = () => setBrowserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    window.addEventListener('focus', updateBrowserTimeZone);
    document.addEventListener('visibilitychange', updateBrowserTimeZone);
    return () => {
      window.removeEventListener('focus', updateBrowserTimeZone);
      document.removeEventListener('visibilitychange', updateBrowserTimeZone);
    };
  }, []);

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
  const headerQuoteSymbol = activeInstrument?.headerQuoteSymbol;
  const headerPrice = headerQuoteSymbol ? chain?.confirmation?.price : price;
  const headerChangePercent = headerQuoteSymbol ? chain?.confirmation?.changePercent : chain?.quote.changePercent;
  const headerTodayOpen = headerQuoteSymbol ? chain?.confirmationTodayOpen : chain?.todayOpen;
  const headerTodayHigh = headerQuoteSymbol ? chain?.confirmationTodayHigh : chain?.todayHigh;
  const headerTodayLow = headerQuoteSymbol ? chain?.confirmationTodayLow : chain?.todayLow;
  const changePositive = (headerChangePercent ?? 0) >= 0;
  const currencySymbol = chain?.quote.currency === 'EUR' ? '€' : '$';
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
  const etfSymbol = symbol === '^NDX' ? 'QQQ' : symbol === '^SPX' ? 'SPY' : symbol === 'DIA' ? 'DIA' : null;
  const cashSymbol = symbol === 'DIA' ? '^DJI' : etfSymbol ? symbol : null;
  const etfHigh = symbol === 'DIA' ? chain?.previousDayHigh : chain?.referencePreviousDayHigh;
  const etfDate = symbol === 'DIA' ? chain?.previousDayDate : chain?.referencePreviousDayDate;
  const cashHigh = symbol === 'DIA' ? chain?.confirmation?.previousDayHigh : chain?.previousDayHigh;
  const cashDate = symbol === 'DIA' ? chain?.confirmation?.previousDayDate : chain?.previousDayDate;
  const etfFactor = etfToCashFactor(etfHigh, etfDate, cashHigh, cashDate);
  const goldFactor = symbol === 'GLD'
    ? etfToCashFactor(chain?.previousDayHigh, chain?.previousDayDate, Number(goldCfdHigh.replace(',', '.')) || null, chain?.previousDayDate)
    : null;
  const convertedEtfWalls = useMemo(() => {
    const etfWalls = symbol === 'DIA' ? walls : chain?.confirmation?.symbol === etfSymbol ? confirmationWalls : { call: [], put: [] };
    return [
      ...etfWalls.put.map((contract, index) => ({ contract, side: 'put' as const, label: `P${index + 1}` })),
      ...etfWalls.call.map((contract, index) => ({ contract, side: 'call' as const, label: `C${index + 1}` })),
    ];
  }, [symbol, walls, chain?.confirmation?.symbol, etfSymbol, confirmationWalls]);
  const specialMatches = etfSymbol && symbol !== 'DIA'
    ? specialWallMatches(primaryWalls, convertedEtfWalls, etfFactor)
    : [];
  const specialStatus = !chain ? null
    : symbol === 'DIA' ? 'Poziomy specjalne niedostępne: brak łańcucha opcji DJI do porównania z DIA.'
    : symbol === 'GLD' ? 'Poziomy specjalne niedostępne: brak opcyjnego poziomu XAUUSD do porównania z GLD.'
    : !etfSymbol ? 'Poziomy specjalne niedostępne: brak porównywanego ETF.'
    : etfFactor === null ? 'Poziomy specjalne niedostępne: brak poprawnego przeliczenia ETF na indeks.'
    : primaryWalls.length === 0 || convertedEtfWalls.length === 0 ? 'Poziomy specjalne niedostępne: brak wybranych walli indeksu lub ETF do porównania.'
    : `Poziom specjalny: put–put lub call–call w odległości do 0,1%. Pasujące pary: ${specialMatches.length}.`;
  const analysisGroups: AnalysisGroup[] = chain ? [
    {
      symbol: activeInstrument?.label ?? symbol,
      priceSymbol: symbol === 'DIA' ? 'DJI' : symbol === 'GLD' ? 'XAUUSD' : activeInstrument?.label ?? symbol,
      spot: symbol === 'DIA' ? confirmationPrice : symbol === 'GLD' ? (price && goldFactor ? price * goldFactor : null) : price ?? null,
      emptyMessage: optionsUnavailableMessage || chain.optionsWarning || 'Brak wybranych walli dla dostępnych danych opcyjnych i ceny SPOT.',
      walls: wallConfluence.map((wall) => {
        const peerContracts = wall.side === 'put' ? chain.confirmation?.puts : chain.confirmation?.calls;
        const peerCashPrice = wall.confirmation && etfSymbol && symbol !== 'DIA'
          ? wallCashPrice(wall.confirmation.strike, { factor: etfFactor })
          : null;
        const confirmation = wall.confirmation
          ? peerCashPrice === null
            ? `Confluence ${chain.confirmation?.symbol}; brak przeliczenia jego poziomu.`
            : `Confluence ${chain.confirmation?.symbol}: ≈ ${display(peerCashPrice)} ${activeInstrument?.label ?? symbol}.`
          : chain.confirmationSymbol
            ? confirmationPrice !== null && confirmationPrice > 0 && peerContracts?.length
              ? `Brak confluence ${chain.confirmationSymbol}.`
              : `Brak danych opcyjnych lub SPOT ${chain.confirmationSymbol} do porównania.`
            : null;
        return {
          label: wall.label,
          side: wall.side,
          contract: wall.contract,
          confirmation,
          conversion: symbol === 'DIA'
            ? { symbol: 'DJI', factor: etfFactor }
            : symbol === 'GLD' ? { symbol: 'XAUUSD', factor: goldFactor } : null,
          specialMatches: etfSymbol ? specialMatches.filter((match) => match.side === wall.side && match.cashLabel === wall.label)
            .map((match) => ({ symbol: etfSymbol, label: match.etfLabel, price: match.etfPrice, approximate: true, differencePct: match.differencePct })) : [],
        };
      }),
    },
    ...(etfSymbol && symbol !== 'DIA' ? [{
      symbol: etfSymbol,
      priceSymbol: activeInstrument?.label ?? symbol,
      spot: price ?? null,
      emptyMessage: chain.confirmationWarning || `Brak wybranych walli ${etfSymbol} dla dostępnych danych opcyjnych i ceny SPOT.`,
      walls: convertedEtfWalls.map((wall) => {
        const match = wallConfluence.find((primary) =>
          primary.side === wall.side && primary.confirmation?.contractSymbol === wall.contract.contractSymbol);
        return {
          ...wall,
          confirmation: match ? `Confluence ${activeInstrument?.label ?? symbol}: ${display(match.contract.strike)}.` : `Brak confluence z wybranym wallem ${activeInstrument?.label ?? symbol}.`,
          conversion: { symbol: activeInstrument?.label ?? symbol, factor: etfFactor },
          specialMatches: specialMatches.filter((item) => item.side === wall.side && item.etfLabel === wall.label)
            .map((item) => ({ symbol: activeInstrument?.label ?? symbol, label: item.cashLabel, price: item.cashPrice, approximate: false, differencePct: item.differencePct })),
        };
      }),
    }] : []),
  ] : [];
  const levelValues = [...wallConfluence.map((wall) => wall.consensusStrike), price]
    .filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  const levelMinimum = levelValues.length ? Math.min(...levelValues) : 0;
  const levelMaximum = levelValues.length ? Math.max(...levelValues) : 1;
  const levelSpan = levelMaximum - levelMinimum || Math.max(Math.abs(levelMinimum) * 0.04, 1);
  const scaleMinimum = Math.max(0, levelMinimum - levelSpan * 0.12);
  const scaleMaximum = levelMaximum + levelSpan * 0.12;
  const levelPosition = (value: number) => `${((value - scaleMinimum) / (scaleMaximum - scaleMinimum)) * 100}%`;
  const instrumentChartPoints = useMemo(() => (chain?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.history]);
  const instrumentChartLevels = useMemo<ChartLevel[]>(() => [
    ...walls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}`, kind: 'put' as const })),
    ...(chain?.gex?.putWall ? [{ price: chain.gex.putWall.strike, color: '#c0392b', title: 'GEX P', kind: 'gex' as const }] : []),
    ...(chain?.gex?.gammaFlip ? [{ price: chain.gex.gammaFlip, color: '#b8a1e3', title: 'FLIP', kind: 'gex' as const }] : []),
    ...(price !== null && price !== undefined ? [{ price, color: '#d8e2da', title: 'SPOT', kind: 'reference' as const }] : []),
    ...(chain?.previousDayHigh ? [{ price: chain.previousDayHigh, color: '#f3c969', title: 'PDH', kind: 'reference' as const }] : []),
    ...(chain?.previousDayClose ? [{ price: chain.previousDayClose, color: '#7aa2f7', title: 'PDC', kind: 'reference' as const }] : []),
    ...walls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}`, kind: 'call' as const })),
    ...(chain?.gex?.callWall ? [{ price: chain.gex.callWall.strike, color: '#27ae60', title: 'GEX C', kind: 'gex' as const }] : []),
    ...(symbol !== 'DIA' && etfFactor !== null ? convertedEtfWalls.map((wall) => ({
      price: wall.contract.strike * etfFactor,
      color: wall.side === 'put' ? '#dba292' : '#9ad9b7',
      title: `${etfSymbol} ${wall.label}`,
      kind: wall.side,
    })) : []),
  ], [walls, price, chain?.previousDayHigh, chain?.previousDayClose, chain?.gex, symbol, etfFactor, etfSymbol, convertedEtfWalls]);
  const confirmationChartPoints = useMemo(() => (chain?.confirmation?.history ?? []).map(({ time, close }) => ({ time, value: close })), [chain?.confirmation?.history]);
  const confirmationChartLevels = useMemo<ChartLevel[]>(() => {
    const hasChain = (chain?.confirmation?.calls?.length ?? 0) + (chain?.confirmation?.puts?.length ?? 0) > 0;
    if (hasChain && symbol !== 'DIA') {
      return [
        ...confirmationWalls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}`, kind: 'put' as const })),
        ...(confirmationPrice !== null ? [{ price: confirmationPrice, color: '#d8e2da', title: 'SPOT', kind: 'reference' as const }] : []),
        ...(chain?.confirmation?.previousDayHigh ? [{ price: chain.confirmation.previousDayHigh, color: '#f3c969', title: 'PDH', kind: 'reference' as const }] : []),
        ...(chain?.confirmation?.previousClose ? [{ price: chain.confirmation.previousClose, color: '#7aa2f7', title: 'PDC', kind: 'reference' as const }] : []),
        ...confirmationWalls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}`, kind: 'call' as const })),
      ];
    }
    return [
      ...(hasChain ? confirmationWalls.put.map((wall, index) => ({ price: wall.strike, color: '#f18270', title: `P${index + 1}`, kind: 'put' as const })) : []),
      ...(symbol === 'DIA' && etfFactor !== null ? convertedEtfWalls.map((wall) => ({
        price: wall.contract.strike * etfFactor,
        color: wall.side === 'put' ? '#f18270' : '#55c99b',
        title: `DIA ${wall.label}`,
        kind: wall.side,
      })) : []),
      ...(confirmationPrice !== null ? [{ price: confirmationPrice, color: '#d8e2da', title: 'SPOT', kind: 'reference' as const }] : []),
      ...(chain?.confirmation?.previousDayHigh ? [{ price: chain.confirmation.previousDayHigh, color: '#f3c969', title: 'PDH', kind: 'reference' as const }] : []),
      ...(chain?.confirmation?.previousClose ? [{ price: chain.confirmation.previousClose, color: '#7aa2f7', title: 'PDC', kind: 'reference' as const }] : []),
      ...(hasChain ? confirmationWalls.call.map((wall, index) => ({ price: wall.strike, color: '#55c99b', title: `C${index + 1}`, kind: 'call' as const })) : []),
    ];
  }, [confirmationWalls, confirmationPrice, chain?.confirmation?.previousDayHigh, chain?.confirmation?.previousClose, chain?.confirmation?.calls, chain?.confirmation?.puts, symbol, etfFactor, convertedEtfWalls]);

  function selectInstrument(nextSymbol: string) {
    setSymbol(nextSymbol);
    setExpiration('');
    setChain(null);
    void loadChain(nextSymbol, todayExpiration());
  }

  function selectTimeZone(selection: string) {
    if (selection !== BROWSER_TIME_ZONE && !isValidTimeZone(selection)) {
      setTimeZonePreference((current) => ({ ...current, warning: 'Wybrano nieprawidłową strefę czasową.' }));
      return;
    }
    try {
      window.localStorage.setItem(TIME_ZONE_STORAGE_KEY, selection);
      setTimeZonePreference({ selection, warning: null });
    } catch (error) {
      console.error('Nie można zapisać strefy czasowej:', error);
      setTimeZonePreference({ selection, warning: 'Nie można zapisać strefy czasowej. Ustawienie działa tylko do zamknięcia lub odświeżenia strony.' });
    }
  }

  function explainWall(wall: WallConfluence) {
    const metric = wall.side === 'put' ? putMetric : callMetric;
    const metricName = Number.isFinite(wall.contract.openInterest) && wall.contract.openInterest > 0 ? 'OI' : 'wolumen';
    const matched = wall.confirmation
      ? `Dopasowany ${chain?.confirmation?.symbol}: strike ${display(wall.confirmation.strike)}, odległość od jego SPOT ${display(wall.confirmationOffsetPct)}%.`
      : 'Brak dopasowanego strike’u instrumentu potwierdzającego.';
    return `${wall.label}: ${wall.side === 'put' ? 'put' : 'call'} ${symbol}, strike ${display(wall.contract.strike)}, ${metricName}: ${display(metric(wall.contract), 0)}, odległość od SPOT: ${display(wall.offsetPct)}%.\n\n${matched}\nPokazany poziom: ${display(wall.consensusStrike)}, odległość konsensusu: ${display(wall.consensusOffsetPct)}%.\n\n${helpText.consensus}`;
  }

  const gexDetails = chain?.gex
    ? `Bieżący forward użyty w obliczeniu: ${display(chain.gex.forward)} (${chain.overnightHistory.length ? `ostatnia dostępna cena ${chain.futuresSymbol}` : 'cena instrumentu bazowego'}).`
    : 'Brak wystarczających danych do wyznaczenia GEX.';
  function gexWallDetails(side: 'call' | 'put') {
    const wall = side === 'call' ? chain?.gex?.callWall : chain?.gex?.putWall;
    if (!wall) return 'Brak wyznaczonego poziomu dla tej strony.';
    const row = chain?.gex?.topByGex.find((item) => item.side === side && item.strike === wall.strike);
    return `Strike: ${display(wall.strike)}; szacowany GEX: ${display(wall.gex)}; OI: ${display(wall.openInterest, 0)}${row ? `; IV: ${percentage(row.impliedVolatility)}` : ''}.`;
  }
  const gexLegend = [
    { title: 'GEX P', color: '#c0392b', help: `${helpText.gexPut}\n\n${gexWallDetails('put')}\n${gexDetails}\n\n${helpText.gex}` },
    { title: 'FLIP', color: '#b8a1e3', help: `${helpText.flip}\n\nPoziom: ${display(chain?.gex?.gammaFlip)}.\n${gexDetails}\n\n${helpText.gex}` },
    { title: 'GEX C', color: '#27ae60', help: `${helpText.gexCall}\n\n${gexWallDetails('call')}\n${gexDetails}\n\n${helpText.gex}` },
  ];
  function explainEtfWall(wall: (typeof convertedEtfWalls)[number]) {
    const converted = etfFactor === null ? null : wall.contract.strike * etfFactor;
    return `${etfSymbol} ${wall.label}: strike ${display(wall.contract.strike)} × (${cashSymbol} high ${display(cashHigh)} ÷ ${etfSymbol} high ${display(etfHigh)}) = ${display(converted)}. Wyświetlone liczby są zaokrąglone; obliczenie korzysta z pełnej precyzji.\n\n${helpText.conversion}`;
  }
  function explainChartLevel(level: ChartLevel) {
    if (level.kind === 'gex') {
      return `\n${gexDetails}${level.title === 'GEX C' ? `\n${gexWallDetails('call')}` : level.title === 'GEX P' ? `\n${gexWallDetails('put')}` : ''}`;
    }
    const etfWall = convertedEtfWalls.find((wall) => `${etfSymbol} ${wall.label}` === level.title);
    return etfWall ? `\n\n${explainEtfWall(etfWall)}` : '';
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
            {headerQuoteSymbol && <span className="exchange-tag">{headerQuoteSymbol}</span>}
            {(headerQuoteSymbol || (headerPrice !== null && headerPrice !== undefined)) && <span className="price">{headerPrice === null || headerPrice === undefined ? '—' : `${currencySymbol}${display(headerPrice)}`}</span>}
            {headerChangePercent !== null && headerChangePercent !== undefined && (
              <span className={`price-change ${changePositive ? 'positive' : 'negative'}`}>
                {changePositive ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{display(Math.abs(headerChangePercent), 2)}%
              </span>
            )}
          </div>
          <p className="instrument-subtitle">{activeInstrument?.description ?? symbol}</p>
          {(headerQuoteSymbol || (headerTodayOpen !== null && headerTodayOpen !== undefined)) && (
            <div className="session-stats">
              <span>O <strong>{headerTodayOpen == null ? '—' : `${currencySymbol}${display(headerTodayOpen)}`}</strong></span>
              <span>H <strong>{headerTodayHigh == null ? '—' : `${currencySymbol}${display(headerTodayHigh)}`}</strong></span>
              <span>L <strong>{headerTodayLow == null ? '—' : `${currencySymbol}${display(headerTodayLow)}`}</strong></span>
              <HelpTip label="Otwarcie, maksimum i minimum sesji" text={helpText.session} />
            </div>
          )}
          {!headerQuoteSymbol && chain?.confirmation && chain.confirmationTodayOpen !== null && chain.confirmationTodayOpen !== undefined && (
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
          <HelpTip label="0DTE i termin wygaśnięcia" text={helpText.expiration} />
        </div>
        <div className="toolbar-meta">
          <span>AUTO · 5 MIN</span>
          <button className={`icon-button ${refreshing ? 'spinning' : ''}`} onClick={() => void loadChain(symbol, todayExpiration(), true)} title="Refresh chain and chart" aria-label="Refresh chain and chart" disabled={loading || refreshing}>
            <RefreshCw size={15} />
          </button>
        </div>
      </section>

      <WallAnalysis
        groups={analysisGroups}
        expiration={chain?.selectedExpiration ? `${chain.isNearestExpiration ? 'NEAREST' : '0DTE'} · ${expirationLabel(chain.selectedExpiration)}` : null}
        updated={updatedAt === null ? null : new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(updatedAt)}
        source={symbol === '^GDAXI' ? 'EUREX (OPCJE EOD) · YAHOO FINANCE' : activeInstrument?.dataSource ?? 'YAHOO FINANCE'}
        specialStatus={specialStatus}
        loading={loading}
        error={error}
      />

      <div className="chart-controls" role="group" aria-label="Chart display">
        <span className="control-label">CHART LEVELS · {showAllWalls ? 'ALL WALLS' : '2 NEAREST PER SIDE'}</span>
        <HelpTip label="Poziomy i grupowanie na wykresach" text={helpText.chart} />
        <button type="button" className="chart-toggle" aria-pressed={showAllWalls} onClick={() => setShowAllWalls((current) => !current)}>ALL WALLS</button>
        <button type="button" className="chart-toggle" aria-pressed={showGex} onClick={() => setShowGex((current) => !current)}>GEX + FLIP</button>
        <HelpTip label="GEX i FLIP" text={`${helpText.gex}\n\n${helpText.flip}\n\n${gexDetails}`} />
        <label className="time-zone-control">
          <span className="control-label">TIME ZONE</span>
          <select aria-label="Strefa czasowa wykresów" value={timeZonePreference.selection} onChange={(event) => selectTimeZone(event.target.value)}>
            <option value={BROWSER_TIME_ZONE}>BROWSER · {browserTimeZone}</option>
            {availableTimeZones.map((zone) => <option value={zone} key={zone}>{zone}</option>)}
          </select>
        </label>
        <HelpTip label="Strefa czasowa wykresów" text="Oś czasu, kursor wykresu i czas aktualizacji używają wybranej strefy. Domyślnie jest to strefa przeglądarki; wybór jest zapisywany lokalnie. Zmiana strefy nie zmienia danych ani dat sesji giełdowej i wygaśnięcia." />
      </div>
      {timeZonePreference.warning && <p className="options-warning time-zone-warning" role="alert">{timeZonePreference.warning}</p>}
      <div className="chart-pair">
        {chain?.confirmation && chain.confirmation.symbol === chain.referenceSymbol && confirmationChartPoints.length > 0 && <PriceChart
          title={instruments.find((instrument) => instrument.symbol === chain.confirmation?.symbol)?.label ?? chain.confirmation.symbol}
          source={`${chain.confirmation.symbol} · 5 MIN`}
          subtitle="PEER · SAME-DAY OPTIONS + SPOT"
          points={confirmationChartPoints}
          levels={confirmationChartLevels}
          spot={confirmationPrice}
          showAllWalls={showAllWalls}
          showGex={showGex}
          timeZone={timeZone}
          levelDetails={explainChartLevel}
          lineColor="#72bda5"
          legend={chartLegend}
        />}
        <PriceChart
          title={activeInstrument?.label ?? symbol}
          source={`${symbol} · 5 MIN`}
          subtitle="TODAY · PRE/POST-MARKET · WALLS + PDH"
          points={instrumentChartPoints}
          levels={instrumentChartLevels}
          spot={price ?? null}
          showAllWalls={showAllWalls}
          showGex={showGex}
          timeZone={timeZone}
          levelDetails={explainChartLevel}
          lineColor="#55c99b"
          legend={showGex ? [...chartLegend, ...gexLegend] : chartLegend}
        />
        {chain?.confirmation && chain.confirmation.symbol !== chain.referenceSymbol && confirmationChartPoints.length > 0 && <PriceChart
          title={instruments.find((instrument) => instrument.symbol === chain.confirmation?.symbol)?.label ?? chain.confirmation.symbol}
          source={`${chain.confirmation.symbol} · 5 MIN`}
          subtitle={chain.confirmation.calls.length ? 'PEER · SAME-DAY OPTIONS + SPOT' : 'CASH INDEX · REFERENCE'}
          points={confirmationChartPoints}
          levels={confirmationChartLevels}
          spot={confirmationPrice}
          showAllWalls={showAllWalls}
          showGex={showGex}
          timeZone={timeZone}
          levelDetails={explainChartLevel}
          lineColor="#72bda5"
          legend={chartLegend}
        />}
      </div>

      <section className="levels-panel standalone-levels" aria-label="Option wall price levels">
        <div className="levels-heading">
          <div>
            <h2>Key levels <HelpTip label="Key levels i konsensus" text={`${helpText.walls}\n\n${helpText.consensus}`} /></h2>
            <span className="chain-caption">±{display(wallTolerance * 100, 0)}% SPOT · PEER OFFSET ≤0.25 P.P.</span>
            <HelpTip label="Confluence i potwierdzenie" text={helpText.confluence} />
            {chain?.confirmationWarning && <p className="options-warning">{chain.confirmationWarning}</p>}
          </div>
          <span className="levels-symbol">{chain?.symbol ?? symbol} · {expiration ? expirationLabel(Number(expiration)) : '—'}</span>
        </div>
        <div className="levels-rows">
          {wallConfluence.filter((wall) => wall.side === 'put').map((wall) => <div className="level-row put-level" key={`put-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}<HelpTip label={`${wall.label}: szczegóły poziomu`} text={explainWall(wall)} /></span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">{currencySymbol}{display(wall.consensusStrike)}</strong>
            <span className="level-distance">{display(wall.consensusOffsetPct)}%</span>
            <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span>
          </div>)}
          <div className="level-row spot-level">
            <span className="level-name">SPOT<HelpTip label="SPOT instrumentu bazowego" text={helpText.spot} /></span>
            <div className="level-track"><span className="level-marker" style={price !== null && price !== undefined ? { left: levelPosition(price) } : undefined} /></div>
            <strong className="level-price">{price === null || price === undefined ? '—' : `${currencySymbol}${display(price)}`}</strong>
            <span className="level-distance">UNDERLYING</span>
          </div>
          {wallConfluence.filter((wall) => wall.side === 'call').map((wall) => <div className="level-row call-level" key={`call-${wall.contract.strike}`}>
            <span className="level-name">{wall.label}<HelpTip label={`${wall.label}: szczegóły poziomu`} text={explainWall(wall)} /></span>
            <div className="level-track"><span className="level-marker" style={{ left: levelPosition(wall.consensusStrike) }} /></div>
            <strong className="level-price">{currencySymbol}{display(wall.consensusStrike)}</strong>
            <span className="level-distance">{display(wall.consensusOffsetPct)}%</span>
            <span className={`confluence-tag ${wall.confirmation ? 'confirmed' : 'single-source'}`}>{wall.confirmation ? `CONF ${chain?.confirmation?.symbol}` : chain?.confirmationSymbol ? 'UNCONFIRMED' : 'SINGLE'}</span>
          </div>)}
        </div>
      </section>

      {etfSymbol && <section className="cfd-panel" aria-label={`${etfSymbol} cash index wall conversion`}>
        <div className="cfd-heading">
          <div><h2>{etfSymbol} walls in {cashSymbol} units <HelpTip label={`Przeliczenie ${etfSymbol} na ${cashSymbol}`} text={`${helpText.conversion}\n\n${etfSymbol} high: ${display(etfHigh)} (${etfDate ?? 'brak daty'}); ${cashSymbol} high: ${display(cashHigh)} (${cashDate ?? 'brak daty'}); współczynnik: ${display(etfFactor, 5)}.`} /></h2><span className="chain-caption">PREVIOUS SESSION HIGH · CASH INDEX LEVELS APPROXIMATE {cfdSymbol} CFD, NOT BROKER PRICES</span></div>
          <span className="expiry-badge">{etfSymbol} · {chain?.isNearestExpiration ? 'NEAREST' : '0DTE'}</span>
        </div>
        <div className="cfd-inputs">
          <div className="reference-high">
            <span className="metric-label">{etfSymbol} · PREVIOUS HIGH</span>
            <strong>{display(etfHigh)}</strong>
            <span>{etfDate ?? 'Waiting for daily data'}</span>
          </div>
          <div className="reference-high">
            <span className="metric-label">{cashSymbol} · PREVIOUS HIGH</span>
            <strong>{display(cashHigh)}</strong>
            <span>{cashDate ?? 'Waiting for daily data'}</span>
          </div>
          <div className="conversion-steps">
            <span>{cashSymbol} / {etfSymbol}: <b>{display(etfFactor, 5)}</b></span>
          </div>
          <p className="conversion-formula">Cash index level = {etfSymbol} strike × ({cashSymbol} previous high ÷ {etfSymbol} previous high). Highs must be from the same session.</p>
        </div>
        <div className="conversion-table-wrap">
          <table className="conversion-table">
            <thead><tr><th>LEVEL</th><th>{etfSymbol} STRIKE</th><th>{cashSymbol} CASH LEVEL · {cfdSymbol} APPROX.</th></tr></thead>
            <tbody>
              {convertedEtfWalls.length ? convertedEtfWalls.map((wall) => <tr key={wall.label}>
                <td className={wall.side === 'put' ? 'put-conversion' : 'call-conversion'}>{wall.label}<HelpTip label={`${etfSymbol} ${wall.label}: przeliczenie`} text={explainEtfWall(wall)} /></td>
                <td>{display(wall.contract.strike)}</td>
                <td className="converted-level">{etfFactor === null ? '—' : display(wall.contract.strike * etfFactor)}</td>
              </tr>) : <tr><td className="conversion-empty" colSpan={3}>{loading ? 'Loading ETF walls.' : error || (symbol !== 'DIA' ? chain?.confirmationWarning : null) || optionsUnavailableMessage || `No ${etfSymbol} walls available.`}</td></tr>}
            </tbody>
          </table>
          {!loading && !error && etfFactor === null && <p className="options-warning conversion-notice">Conversion unavailable: both previous highs must be positive and from the same session.</p>}
        </div>
      </section>}

      {symbol === 'GLD' && <section className="cfd-panel" aria-label="GLD to XAUUSD conversion">
        <div className="cfd-heading">
          <div><h2>GLD walls in XAUUSD units</h2><span className="chain-caption">PREVIOUS SESSION HIGH · XAUUSD CFD HIGH FROM YOUR BROKER</span></div>
          <span className="expiry-badge">GLD · {chain?.isNearestExpiration ? 'NEAREST' : '0DTE'}</span>
        </div>
        <div className="cfd-inputs">
          <div className="reference-high">
            <span className="metric-label">GLD · PREVIOUS HIGH</span>
            <strong>{display(chain?.previousDayHigh)}</strong>
            <span>{chain?.previousDayDate ?? 'Waiting for daily data'}</span>
          </div>
          <div className="reference-high">
            <span className="metric-label">XAUUSD · PREVIOUS HIGH</span>
            <input
              inputMode="decimal"
              value={goldCfdHigh}
              placeholder="e.g. 4082.66"
              onChange={(event) => {
                setGoldCfdHigh(event.target.value);
                try { window.localStorage.setItem('xauusd-previous-high', event.target.value); } catch { /* storage unavailable */ }
              }}
            />
          </div>
          <div className="conversion-steps"><span>XAUUSD / GLD: <b>{display(goldFactor, 5)}</b></span></div>
          <p className="conversion-formula">XAUUSD level = GLD strike × (XAUUSD previous high ÷ GLD previous high). Update the XAUUSD high daily.</p>
        </div>
        <div className="conversion-table-wrap">
          <table className="conversion-table">
            <thead><tr><th>LEVEL</th><th>GLD STRIKE</th><th>XAUUSD LEVEL</th></tr></thead>
            <tbody>
              {wallConfluence.length ? wallConfluence.map((wall) => <tr key={wall.label}>
                <td className={wall.side === 'put' ? 'put-conversion' : 'call-conversion'}>{wall.label}</td>
                <td>{display(wall.contract.strike)}</td>
                <td className="converted-level">{goldFactor === null ? '—' : display(wall.contract.strike * goldFactor)}</td>
              </tr>) : <tr><td className="conversion-empty" colSpan={3}>{loading ? 'Loading GLD walls.' : 'No GLD walls available.'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      <section className="chain-panel" aria-label="Options chain">
        <div className="chain-heading">
          <div>
            <h2>Wall strikes <HelpTip label="Wybór walli" text={`${helpText.walls}\n\nBieżące ustawienia: pasmo ±${display(wallTolerance * 100, 0)}%, próg ${Math.round(wallLeaderThreshold * 100)}% lidera, maksimum ${maxWalls} walli na stronę${wallMinMetric > 0 ? `, minimum metryki ${wallMinMetric}` : ''}. Jeśli jest za mało wyników spełniających próg, aplikacja uzupełnia listę najsilniejszymi pozostałymi kandydatami według metryki.`} /></h2>
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
                <th className="call-group" colSpan={5}>CALLS <HelpTip label="Opcje call" text={helpText.calls} /></th>
                <th className="strike-heading" rowSpan={2}>STRIKE <HelpTip label="Strike" text={helpText.strike} /></th>
                <th className="put-group" colSpan={5}>PUTS <HelpTip label="Opcje put" text={helpText.puts} /></th>
              </tr>
              <tr className="column-head">
                <th>OPEN INT.<HelpTip label="Call open interest" text={helpText.oi} /></th><th>VOLUME<HelpTip label="Call wolumen" text={helpText.volume} /></th><th>IV<HelpTip label="Call IV" text={helpText.iv} /></th><th>BID<HelpTip label="Call bid" text={helpText.bid} /></th><th>ASK<HelpTip label="Call ask" text={helpText.ask} /></th>
                <th>BID<HelpTip label="Put bid" text={helpText.bid} /></th><th>ASK<HelpTip label="Put ask" text={helpText.ask} /></th><th>IV<HelpTip label="Put IV" text={helpText.iv} /></th><th>VOLUME<HelpTip label="Put wolumen" text={helpText.volume} /></th><th>OPEN INT.<HelpTip label="Put open interest" text={helpText.oi} /></th>
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
        <footer className="panel-footer"><span>DATA: {activeInstrument?.dataSource ?? 'YAHOO FINANCE'} <HelpTip label="Źródła i opóźnienie danych" text={helpText.source} /></span><span>{updatedAt !== null ? `UPDATED ${new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(updatedAt)}` : 'AWAITING MARKET DATA'} · DELAYED DATA MAY APPLY</span></footer>
      </section>
      <footer className="page-footer"><span>Market Desk</span><span>For informational purposes only. Not investment advice.</span></footer>
    </main>
  );
}