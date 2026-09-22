#!/usr/bin/env python3
"""Build the static US market scan consumed by the GitHub Pages dashboard."""

from __future__ import annotations

import csv
import argparse
import io
import json
import math
import os
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
STOCKS_PATH = DIST / "stocks.json"
SCAN_PATH = DIST / "scan.json"

UNIVERSE_URL = (
    "https://raw.githubusercontent.com/datasets/"
    "s-and-p-500-companies/main/data/constituents.csv"
)
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}"
USER_AGENT = "Mozilla/5.0 (compatible; SallyToTheMoon/1.0)"

try:
    import certifi

    SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    SSL_CONTEXT = ssl.create_default_context()

EXTRAS = [
    ("SPY", "SPDR S&P 500 ETF Trust", "ETF"),
    ("QQQ", "Invesco QQQ Trust", "ETF"),
    ("IWM", "iShares Russell 2000 ETF", "ETF"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "ETF"),
    ("SMH", "VanEck Semiconductor ETF", "ETF"),
    ("SOXX", "iShares Semiconductor ETF", "ETF"),
    ("ARKK", "ARK Innovation ETF", "ETF"),
    ("RKLB", "Rocket Lab USA", "Aerospace & Defense"),
    ("SOFI", "SoFi Technologies", "Financial Technology"),
    ("COIN", "Coinbase Global", "Financial Technology"),
    ("OPEN", "Opendoor Technologies", "Real Estate Technology"),
]


def fetch_text(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CONTEXT) as response:
        return response.read().decode("utf-8")


def refresh_universe() -> list[dict]:
    """Refresh the S&P 500 directory; safely fall back to the last saved copy."""
    try:
        rows = csv.DictReader(io.StringIO(fetch_text(UNIVERSE_URL)))
        stocks = [
            {
                "symbol": row["Symbol"].strip().replace(".", "-"),
                "name": row["Security"].strip(),
                "sector": row["GICS Sector"].strip(),
                "universe": "S&P 500",
            }
            for row in rows
            if row.get("Symbol") and row.get("Security")
        ]
        known = {item["symbol"] for item in stocks}
        for symbol, name, sector in EXTRAS:
            if symbol not in known:
                stocks.append(
                    {
                        "symbol": symbol,
                        "name": name,
                        "sector": sector,
                        "universe": "Major US / ETF",
                    }
                )
        stocks.sort(key=lambda item: item["symbol"])
        STOCKS_PATH.write_text(json.dumps(stocks, indent=2) + "\n")
        return stocks
    except Exception as exc:
        print(f"Universe refresh warning: {exc}")
        if STOCKS_PATH.exists():
            return json.loads(STOCKS_PATH.read_text())
        return [
            {"symbol": symbol, "name": name, "sector": sector, "universe": "Major US / ETF"}
            for symbol, name, sector in EXTRAS
        ]


def sma(values: list[float], length: int) -> float | None:
    return statistics.fmean(values[-length:]) if len(values) >= length else None


def rsi(values: list[float], length: int = 14) -> float:
    if len(values) <= length:
        return 50.0
    moves = [b - a for a, b in zip(values[-length - 1 : -1], values[-length:])]
    gain = statistics.fmean(max(move, 0) for move in moves)
    loss = statistics.fmean(max(-move, 0) for move in moves)
    if loss == 0:
        return 100.0
    return 100 - (100 / (1 + gain / loss))


def atr(highs: list[float], lows: list[float], closes: list[float], length: int = 14) -> float:
    true_ranges = []
    start = max(1, len(closes) - length)
    for index in range(start, len(closes)):
        true_ranges.append(
            max(
                highs[index] - lows[index],
                abs(highs[index] - closes[index - 1]),
                abs(lows[index] - closes[index - 1]),
            )
        )
    return statistics.fmean(true_ranges) if true_ranges else closes[-1] * 0.02


def yahoo_chart(symbol: str, attempts: int = 3) -> dict:
    params = urllib.parse.urlencode(
        {"range": "6mo", "interval": "1d", "includePrePost": "true", "events": "div,splits"}
    )
    last_error = None
    for attempt in range(attempts):
        try:
            payload = json.loads(fetch_text(f"{YAHOO_URL.format(urllib.parse.quote(symbol))}?{params}"))
            result = payload["chart"]["result"][0]
            quote = result["indicators"]["quote"][0]
            adjusted = result["indicators"].get("adjclose", [{}])[0].get("adjclose", quote["close"])
            rows = []
            for index, close in enumerate(adjusted):
                raw_close = quote["close"][index]
                high = quote["high"][index]
                low = quote["low"][index]
                volume = quote["volume"][index]
                if None not in (close, raw_close, high, low, volume):
                    factor = close / raw_close if raw_close else 1
                    rows.append((float(close), float(high) * factor, float(low) * factor, float(volume)))
            if len(rows) < 55:
                raise ValueError("not enough daily history")
            return {"meta": result.get("meta", {}), "rows": rows}
        except Exception as exc:
            last_error = exc
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(str(last_error))


def round_price(value: float) -> float:
    return round(value, 2 if value >= 1 else 4)


def numeric(value: object) -> float | None:
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def market_session(now: datetime) -> str:
    if now.weekday() >= 5:
        return "CLOSED"
    minutes = now.hour * 60 + now.minute
    if 240 <= minutes < 570:
        return "PRE-MARKET"
    if 570 <= minutes < 960:
        return "REGULAR"
    if 960 <= minutes < 1200:
        return "AFTER HOURS"
    return "CLOSED"


def analyze(item: dict, session: str) -> dict:
    symbol = item["symbol"]
    chart = yahoo_chart(symbol)
    rows = chart["rows"]
    closes = [row[0] for row in rows]
    highs = [row[1] for row in rows]
    lows = [row[2] for row in rows]
    volumes = [row[3] for row in rows]
    meta = chart["meta"]
    regular_price = numeric(meta.get("regularMarketPrice"))
    extended_price = numeric(meta.get("fulldayPrice"))
    live_price = extended_price if session in {"PRE-MARKET", "AFTER HOURS"} else regular_price
    if session != "CLOSED" and live_price and live_price > 0:
        closes[-1] = live_price
    close, previous = closes[-1], closes[-2]
    ma20, ma50 = sma(closes, 20), sma(closes, 50)
    old_ma20 = statistics.fmean(closes[-25:-5])
    old_ma50 = statistics.fmean(closes[-55:-5])
    rsi14 = rsi(closes)
    volume_avg = statistics.fmean(volumes[-21:-1]) or 1
    volume_ratio = volumes[-1] / volume_avg
    atr14 = atr(highs, lows, closes)
    regular_change = numeric(meta.get("regularMarketChangePercent"))
    extended_change = numeric(meta.get("fulldayChangePercent"))
    if session in {"PRE-MARKET", "AFTER HOURS"} and extended_change is not None:
        change = extended_change
    elif session == "REGULAR" and regular_change is not None:
        change = regular_change
    else:
        change = ((close / previous) - 1) * 100
    change5 = ((close / closes[-6]) - 1) * 100
    high20_prior = max(highs[-21:-1])
    support = min(lows[-20:])
    resistance = max(highs[-20:])

    score = 50
    score += 12 if close > ma20 else -12
    score += 10 if ma20 > ma50 else -8
    score += 8 if ma20 > old_ma20 else -5
    score += 6 if close > high20_prior else 0
    score += 6 if 48 <= rsi14 <= 68 else (-8 if rsi14 >= 78 or rsi14 <= 30 else 0)
    score += 5 if volume_ratio >= 1.25 else (-3 if volume_ratio < 0.65 else 0)
    score += 3 if change5 > 0 else -3
    score = max(1, min(99, round(score)))
    verdict = "BUY WATCH" if score >= 75 else ("WAIT" if score >= 55 else "AVOID")

    turnaround = bool(
        old_ma20 < old_ma50
        and closes[-6] < old_ma20
        and ma20 > old_ma20
        and change5 > 0
        and close >= ma20 * 0.99
        and 42 <= rsi14 <= 68
    )

    entry_low = min(close, max(ma20, close - 0.55 * atr14))
    entry_high = max(entry_low, min(close, close - 0.10 * atr14))
    entry_mid = (entry_low + entry_high) / 2
    stop = entry_low - 1.25 * atr14
    risk = max(entry_mid - stop, close * 0.01)
    target = entry_mid + 2.0 * risk
    reward_risk = (target - entry_mid) / risk if risk else 0

    return {
        "symbol": symbol,
        "name": item["name"],
        "sector": item.get("sector", ""),
        "universe": item.get("universe", ""),
        "session": session,
        "price": round_price(close),
        "changePercent": round(change, 2),
        "score": score,
        "verdict": verdict,
        "turnaround": turnaround,
        "rsi": round(rsi14, 1),
        "volumeRatio": round(volume_ratio, 2),
        "trend": "Bullish" if close > ma20 and ma20 > ma50 else ("Improving" if close > ma20 else "Bearish"),
        "entryLow": round_price(entry_low),
        "entryHigh": round_price(entry_high),
        "target": round_price(target),
        "stop": round_price(stop),
        "rewardRisk": round(reward_risk, 1),
        "support": round_price(support),
        "resistance": round_price(resistance),
        "sparkline": [round_price(value) for value in closes[-30:]],
    }


def market_summary(quotes: list[dict]) -> tuple[int, str]:
    if not quotes:
        return 50, "Neutral"
    breadth = sum(quote["trend"] == "Bullish" for quote in quotes) / len(quotes)
    buy_rate = sum(quote["verdict"] == "BUY WATCH" for quote in quotes) / len(quotes)
    score = round(min(95, max(5, breadth * 72 + buy_rate * 28)))
    signal = "Bullish" if score >= 65 else ("Cautious" if score < 42 else "Mixed")
    return score, signal


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--extended-hours-only", action="store_true")
    args = parser.parse_args()
    market_now = datetime.now(ZoneInfo("America/New_York"))
    session = market_session(market_now)
    if args.extended_hours_only and session == "CLOSED":
        print("US extended session is closed; keeping the previous scan.")
        return
    DIST.mkdir(parents=True, exist_ok=True)
    stocks = refresh_universe()
    max_workers = min(12, max(4, (os.cpu_count() or 4)))
    quotes, errors = [], []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        jobs = {pool.submit(analyze, item, session): item for item in stocks}
        for job in as_completed(jobs):
            item = jobs[job]
            try:
                quotes.append(job.result())
            except Exception as exc:
                errors.append({"symbol": item["symbol"], "error": str(exc)[:160]})
    quotes.sort(key=lambda quote: (-quote["score"], quote["symbol"]))
    now = datetime.now(ZoneInfo("America/New_York"))
    market_score, market_signal = market_summary(quotes)
    payload = {
        "version": 1,
        "updated": now.isoformat(timespec="minutes"),
        "updatedShort": now.strftime("%b %-d · %-I:%M %p"),
        "marketScore": market_score,
        "marketSignal": market_signal,
        "marketSession": session,
        "universeCount": len(stocks),
        "quotes": quotes,
        "errors": errors,
    }
    SCAN_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"Wrote {len(quotes)} quotes; {len(errors)} errors; market {market_score} {market_signal}")


if __name__ == "__main__":
    main()
