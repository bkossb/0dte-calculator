import type { ChartLevel } from '../types';

export const helpText = {
  expiration: '0DTE: wygaśnięcie przypada dzisiaj. NEAREST: brak dostępnego dzisiejszego terminu, więc pokazano inny dostępny termin. Dane dotyczą wyświetlonej daty.',
  session: 'O, H i L to otwarcie, maksimum i minimum bieżącej sesji z danych dziennych dostawcy. Cena w nagłówku to ostatnie dostępne kwotowanie; dane mogą być opóźnione.',
  spot: 'SPOT to ostatnia dostępna cena instrumentu bazowego dla wybranego wykresu. Może być opóźniona i nie musi odpowiadać bieżącej cenie CFD.',
  pdh: 'PDH (previous-day high) to maksimum ostatniej wcześniejszej sesji z danych dziennych instrumentu, a nie maksimum z całej doby CFD.',
  pdc: 'PDC (previous-day close) to dostępne u dostawcy zamknięcie poprzedniej sesji. Na wykresie instrumentu porównawczego, gdy brak danych dziennych, aplikacja może użyć poprzedniego zamknięcia z kwotowania.',
  walls: 'P = put wall, C = call wall. Dla każdej strony aplikacja wybiera strike’i w paśmie wokół SPOT na podstawie open interest; dla kontraktu bez dodatniego OI używa wolumenu. Może też uwzględnić dominujący strike po przeciwnej stronie SPOT. Numer jest kolejnością cenową, nie rankingiem siły.',
  confluence: 'Porównywana jest procentowa odległość strike’u od ceny SPOT dla instrumentu głównego i instrumentu potwierdzającego. Dopasowanie musi mieć tę samą stronę call/put, być w wybranym paśmie i różnić się nie więcej niż o 0,25 punktu procentowego. Kandydat jest używany tylko raz. CONF oznacza dopasowanie, UNCONFIRMED jego brak, SINGLE brak instrumentu potwierdzającego.',
  consensus: 'Przy dopasowaniu pokazany poziom wynika ze średniej procentowych odległości obu strike’ów od ich cen SPOT, przeliczonej na skalę instrumentu głównego. Bez dopasowania jest to strike instrumentu głównego. To nie jest bezpośrednio kwotowanie CFD.',
  conversion: 'Strike ETF × (high indeksu z poprzedniej sesji ÷ high ETF z tej samej sesji). Wynik jest w skali indeksu kasowego, nie w rzeczywistych cenach CFD brokera. Maksima mogły wystąpić o różnych porach; wynik jest przybliżeniem.',
  gex: 'GEX jest szacowany modelem Black 76 z gammy, OI, mnożnika i ceny forward: gamma × OI × mnożnik × forward² × 0,01. Aplikacja przyjmuje dodatni znak call i ujemny put. Forward to ostatnia dostępna cena futures, a dla instrumentów Yahoo przy jej braku cena bazowa. Forward i strike są używane bez przeskalowania; dla ETF mogą mieć różne skale, co zniekształca wynik. IV pochodzi z danych opcji albo jest szacowana z ostatniej ceny. Kontrakty bez dodatniego OI lub poprawnej IV są pomijane. To modelowe założenie, nie obserwacja rzeczywistych pozycji dealerów.',
  gexCall: 'GEX C to strike call powyżej użytego forward z największym dodatnim szacowanym GEX. Różni się od call wall wybieranego według OI/wolumenu.',
  gexPut: 'GEX P to strike put poniżej użytego forward z najbardziej ujemnym szacowanym GEX. Różni się od put wall wybieranego według OI/wolumenu.',
  flip: 'FLIP: aplikacja sumuje szacowany GEX call i put osobno dla każdego strike’u, szuka pierwszej zmiany znaku między kolejnymi strike’ami i interpoluje między nimi. Nie przelicza łącznego GEX dla różnych cen bazowych, więc nie jest to standardowo wyznaczony próg całego rynku ani pewny sygnał transakcyjny.',
  chart: 'Domyślnie na każdym wykresie są po dwa najbliższe wybrane walle put i call. ALL WALLS pokazuje pozostałe wybrane walle; GEX + FLIP włącza szacowane poziomy GEX. Grupy oznaczone * mają osobne wartości pod wykresem. Dalsze poziomy są wymienione poza zakresem wykresu.',
  calls: 'Call to opcja związana z prawem kupna instrumentu bazowego po cenie strike; tabela pokazuje dostępne dane dla wybranego terminu.',
  puts: 'Put to opcja związana z prawem sprzedaży instrumentu bazowego po cenie strike; tabela pokazuje dostępne dane dla wybranego terminu.',
  strike: 'Strike to cena wykonania kontraktu opcyjnego. Oznaczenia P i C przy strike’u wskazują walle wybrane przez aplikację.',
  oi: 'Open interest (OI) to liczba otwartych kontraktów według dostawcy. Nie określa bezpośrednio, kto jest kupującym lub sprzedającym; może być aktualizowany z opóźnieniem.',
  volume: 'Wolumen to liczba kontraktów będących przedmiotem obrotu w danym okresie raportowanym przez dostawcę. W tej aplikacji zastępuje OI dla kontraktu, który nie ma dodatniego OI.',
  iv: 'IV (implied volatility) to zmienność implikowana podana przez dostawcę, wyświetlana w procentach. GEX może użyć IV szacowanej z ostatniej ceny, jeśli w danych jej nie ma.',
  bid: 'Bid to najlepsza dostępna cena kupna opcji podana przez dostawcę; nie jest to cena instrumentu bazowego.',
  ask: 'Ask to najlepsza dostępna cena sprzedaży opcji podana przez dostawcę; spread to różnica między ask i bid.',
  source: 'Dane opcji i notowań są pobierane z Yahoo Finance. Dla DAX opcje pochodzą ze statystyk Eurex na koniec dnia, indeks z Yahoo, a futures FDAX z opóźnionego strumienia TradingView. Dostępność i opóźnienie zależą od źródła.',
} as const;

export function chartLevelHelp(level: ChartLevel): string {
  if (level.title === 'SPOT') return helpText.spot;
  if (level.title === 'PDH') return helpText.pdh;
  if (level.title === 'PDC') return helpText.pdc;
  if (level.title === 'FLIP') return `${helpText.flip}\n\n${helpText.gex}`;
  if (level.title === 'GEX C') return `${helpText.gexCall}\n\n${helpText.gex}`;
  if (level.title === 'GEX P') return `${helpText.gexPut}\n\n${helpText.gex}`;
  return `${helpText.walls}${level.title.includes(' ') ? `\n\nPoziom ${level.title} został przeliczony ze strike’u ETF na skalę indeksu kasowego. ${helpText.conversion}` : ''}`;
}
