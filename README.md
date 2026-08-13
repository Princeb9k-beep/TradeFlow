# Tradeflow

**AI-assisted day-trading platform** — a chart-first workspace that teaches new
traders and sharpens experienced ones. TradingView-style candlestick charts sit
next to the thing TradingView doesn't give you: an AI that reads the setup,
coaches your trades, and keeps your risk in check.

> Educational software. Paper trading on synthetic (or, optionally, real) market
> data. **Nothing here is financial advice.**

---

## What it does

- **Real market data, no key required** — real quotes and candles via Yahoo
  Finance out of the box (stocks, ETFs, and crypto), falling back to a synthetic
  series only when offline. Swap to Alpaca with a key when you want broker-grade
  data + live execution.
- **Charts** — candlestick charts with SMA overlays and AI-drawn support/
  resistance, rendered as dependency-free inline SVG (themes with the app).
- **Paper trading** — a virtual-cash account. Market orders fill at the live
  quote; positions carry live P&L. A **daily-loss lock** enforces discipline.
- **AI Read** — a plain-language take on any chart (bias, key levels, one risk),
  built on real indicators so it works even without an AI key.
- **Natural-language screener** — "oversold names in an uptrend with momentum" →
  a ranked, explainable table, instead of clicking twelve filters.
- **Position sizer** — entry + stop + risk% → exact share count and R-targets.
  The guardrail that keeps new traders alive.
- **Trade journal + AI coach** — log a trade with your thesis and emotion; the
  coach reviews your *process*, not just the pick.
- **Academy** — a learn-by-doing curriculum paired with the simulator.

## Architecture

- **Backend** — FastAPI + async SQLAlchemy (Postgres/asyncpg; aiosqlite for
  tests) + optional Redis + optional Groq. Every response uses one envelope
  (`{success, data, message, meta}`).
  - `app/market_data.py` — provider-agnostic quotes/candles. `synthetic`
    (offline default) or `alpaca` (real), degrading gracefully.
  - `app/brokers.py` — a `Broker` interface with `PaperBroker` (ships now) and a
    gated `LiveBroker`. Real-money routing is a deliberate opt-in behind
    `LIVE_TRADING_ENABLED`; the UI and endpoints are unchanged paper → live.
  - `app/skills/ta.py` — pure, deterministic indicators + position sizing.
  - `app/skills/trade_ai.py` — AI analysis, screener, and trade review, each
    with a rules-based fallback.
- **Frontend** — React + Vite SPA. The Trade cockpit is one page over a small
  API client; the whole thing themes light/dark.

## Run it

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                        # offline smoke tests
uvicorn main:app --reload        # http://localhost:8000  (docs at /docs)
```
Database migrations (needs `DATABASE_URL`):
```bash
cd backend && alembic upgrade head
```

### Frontend
```bash
cd frontend
npm install
npm run dev      # http://localhost:5173 (proxies /auth, /trading to :8000)
npm run build    # production build → frontend/dist (served by FastAPI)
```

## Configuration

Copy `.env.example` to `backend/.env`. With no values set, Tradeflow runs on
synthetic data, without Redis, with AI in rules-based mode — so it works out of
the box. Set `GROQ_API_KEY` for natural-language AI, and
`MARKET_DATA_PROVIDER=alpaca` (+ Alpaca keys) for real market data.

## Roadmap

- [x] Shared core: data, charts, paper account, AI read, screener, sizer, journal
- [x] Real market data by default (Yahoo, keyless) with synthetic fallback
- [ ] Alpaca provider + broker connect for live execution (gated)
- [ ] Beginner vs Pro surfaces over the shared core
- [ ] Alerts + limit/stop orders
- [ ] Broker connect flow for live execution (gated, with disclaimers)
