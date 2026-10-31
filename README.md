# Nom_Application

Application React/Python PyTrading212 : console de trading live + bot algorithmique adaptatif pour Trading 212.

## Structure
- `frontend/` : React + TypeScript + Vite
- `backend/` : FastAPI + Trading 212 + bot 3 couches + market data ouverte
- `docker/` : Dockerfiles et compose

## Setup local
1. Completer `.env` a la racine.
2. Backend:
   - `cd backend`
   - `uv sync`
   - `uv run uvicorn app.main:app --app-dir src --reload --reload-exclude .venv --host 0.0.0.0 --port 8000`
3. Frontend:
   - `cd frontend`
   - `pnpm install`
   - `pnpm dev`

## Features
- Ordres `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT`
- Bot avec architecture 3 couches:
  - detection de regime (TREND / RANGE / HIGH_VOLATILITY)
  - generation de signal (rules + confidence filter)
  - risk management adaptatif (ATR sizing, SL/TP, drawdown guards, cooldown)
- Allocation cash dediee au bot
- Endpoint historique marche (Yahoo chart API):
  - `GET /api/market/history?ticker=AAPL_US_EQ&interval=1h&range=3mo`

## Variables .env attendues
- `api_key_id`
- `secret_key`
- `TRADING212_BASE_URL`
- `FRONTEND_ORIGIN`
- `MIN_ORDER_QUANTITY`
- `MAX_ORDER_QUANTITY`
- `BOT_DEFAULT_POLL_INTERVAL_SECONDS`
- `BOT_MAX_TICKERS`

## Important
- Le mode `LIVE` execute des ordres reels.
- Toujours valider en `DRY_RUN` avant passage live.
- Les ordres API ne sont pas idempotents.
