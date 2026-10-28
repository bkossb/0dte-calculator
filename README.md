# 0DTE Calculator

Prosta strona do pobierania danych z Eurex dla 0DTE.

## Co robi

- pobiera overview dla wybranego produktu
- wyświetla daty wygaśnięcia z OI i wolumenem
- po kliknięciu w wiersz pobiera strike chain dla tej daty
- próbuje kontraktowe typy: W, E, M
- wspiera ODAP i ODAX

## Endpoint

```text
https://www.eurex.com/api/v1/overallstatistics/{ID_PRODUKTU}
```

Dla ODAP używany jest ID:

```text
3734540
```

## Uruchomienie lokalnie

1. Otwórz `index.html` w przeglądarce, albo
2. uruchom prosty serwer:

```bash
python3 -m http.server 8000
```

I potem odwiedź:

```text
http://localhost:8000
```

## Wersja hostowana

Po włączeniu GitHub Pages dla repozytorium strona będzie dostępna pod adresem:

```text
https://bkossb.github.io/0dte-calculator/
```

## Wskazówki

- `busdate` to poprzedni dzień handlowy dla 0DTE
- `productdate` to data wygaśnięcia serii
- w praktyce należy próbować `W`, `E`, `M` w kolejności

