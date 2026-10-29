import type { Contract } from '../types';
import { display } from '../lib/format';
import { wallCashPrice, wallPosition } from '../lib/wallAnalysis';
import { HelpTip } from './HelpTip';

export type AnalysisWall = {
  label: string;
  side: 'put' | 'call';
  contract: Contract;
  confirmation: string | null;
  conversion: { symbol: string; factor: number | null } | null;
};

export type AnalysisGroup = {
  symbol: string;
  priceSymbol: string;
  spot: number | null;
  walls: AnalysisWall[];
  emptyMessage: string;
};

type Props = {
  groups: AnalysisGroup[];
  expiration: string | null;
  updated: string | null;
  source: string;
  loading: boolean;
  error: string;
};

const positionLabels = {
  above: 'powyżej SPOT',
  below: 'poniżej SPOT',
  at: 'na poziomie SPOT',
  unknown: 'odległość od SPOT niedostępna',
};

export function WallAnalysis({ groups, expiration, updated, source, loading, error }: Props) {
  return <section className="analysis-panel" aria-label="Scenariusze dla poziomów opcyjnych">
    <div className="analysis-heading">
      <div>
        <div className="analysis-eyebrow">MARKET CONTEXT</div>
        <h2>Scenariusze dla walli <HelpTip label="Interpretacja walli" text="Scenariusze opisują możliwe reakcje względem poziomu w skali kasowej, a nie prognozę lub prawdopodobieństwo. Poziomy ETF są przybliżeniem na podstawie maksimów poprzedniej sesji, nie ceną CFD brokera. Odległość i scenariusze odnoszą się do ostatniego dostępnego SPOT indeksu kasowego. OI i wolumen nie ujawniają pozycji dealerów. Potwierdzenie oznacza dopasowanie procentowych odległości strike’ów od ich własnych cen SPOT, nie potwierdzenie kierunku ceny." /></h2>
        <p>Poziomy do obserwacji, nie prognoza. OI i wolumen nie określają szansy odbicia ani przebicia. Dane mogą być opóźnione.</p>
      </div>
      <div className="analysis-meta">
        <span>{expiration ?? 'TERMIN NIEDOSTĘPNY'}</span>
        <span>{updated ? `DANE · ${updated}` : 'BRAK AKTUALIZACJI'}</span>
        <span>ŹRÓDŁO · {source}</span>
      </div>
    </div>
    {error && <p className="analysis-warning" role="alert">Błąd pobierania: {error}{groups.length > 0 ? ' Poniżej ostatnie dostępne dane.' : ''}</p>}
    {loading && <p className="analysis-empty">Pobieranie danych do analizy...</p>}
    {!loading && groups.length === 0 && !error && <p className="analysis-empty">Brak danych do analizy walli.</p>}
    {!loading && groups.map((group) => <div className="analysis-group" key={group.symbol}>
      <div className="analysis-group-heading">
        <h3>{group.symbol}{group.symbol !== group.priceSymbol ? ` · ${group.priceSymbol}` : ''}</h3>
        <span>SPOT {group.priceSymbol} · {display(group.spot)}</span>
      </div>
      {group.walls.length === 0 ? <p className="analysis-empty">{group.emptyMessage}</p> : <div className="analysis-grid">
        {group.walls.map((wall) => {
          const cashPrice = wallCashPrice(wall.contract.strike, wall.conversion);
          const { position, offsetPct, scenarios } = wallPosition(cashPrice ?? NaN, group.spot);
          const hasOi = Number.isFinite(wall.contract.openInterest) && wall.contract.openInterest > 0;
          const metric = hasOi ? wall.contract.openInterest : wall.contract.volume;
          const metricAvailable = Number.isFinite(metric) && metric > 0;
          return <article className={`analysis-card analysis-${wall.side}`} key={`${wall.side}-${wall.label}-${wall.contract.strike}`}>
            <div className="analysis-card-heading">
              <span className={`analysis-side ${wall.side}-color`}>{wall.label} · {wall.side.toUpperCase()} WALL</span>
              <strong>{cashPrice !== null && wall.conversion ? '≈ ' : ''}{display(cashPrice)} {group.priceSymbol}</strong>
            </div>
            <p className="analysis-distance">
              {offsetPct === null ? positionLabels[position] : `${offsetPct > 0 ? '+' : ''}${display(offsetPct)}% · ${positionLabels[position]}`}
            </p>
            <p className="analysis-basis">
              {metricAvailable ? `Wybrany według ${hasOi ? 'OI' : 'wolumenu'}: ${display(metric, 0)}.` : 'Brak dodatniego OI i wolumenu dla tego strike’u.'}
              {wall.confirmation && ` ${wall.confirmation}`}
            </p>
            {wall.conversion && <p className="analysis-conversion">
              {wall.conversion.factor === null
                ? `Przeliczenie na ${wall.conversion.symbol} niedostępne.`
                : 'Przybliżenie w skali indeksu kasowego, nie cena CFD brokera.'}
            </p>}
            {scenarios.length > 0
              ? <ul className="analysis-scenarios">{scenarios.map((scenario) => <li key={scenario}>{scenario}</li>)}</ul>
              : <p className="analysis-basis">{cashPrice === null ? 'Scenariusze niedostępne: brak prawidłowego poziomu w skali kasowej.' : 'Scenariusze niedostępne: brak prawidłowego SPOT w skali kasowej.'}</p>}
          </article>;
        })}
      </div>}
    </div>)}
  </section>;
}
