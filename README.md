# Sally To The Moon Terminal

A compact US swing-trading dashboard designed for GitHub Pages.

## What it covers

- The current S&P 500 directory plus a small set of liquid ETFs and popular US names.
- A transparent 0–100 technical score using trend, momentum, volume and breakout signals.
- Rule-based entry, target and stop levels for planning—not predictions.
- A possible-turnaround flag for early trend improvement.
- Delayed Yahoo Finance market data, refreshed by GitHub Actions.

## Publish

Push this folder to a GitHub repository, open **Settings → Pages**, and select **GitHub Actions** as the source. The included workflow publishes `dist` and refreshes the data hourly on US market weekdays.

This is an educational tool, not financial advice. Confirm current prices with your broker.
