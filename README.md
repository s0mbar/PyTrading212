# PyTrading212

Application React/Python : console de trading Trading 212, bot algorithmique adaptatif et aide à la
déclaration fiscale française (IFU reconstitué).

## Structure
- `frontend/` : React + TypeScript + Vite (pnpm)
- `backend/` : FastAPI (uv) — client Trading 212, bot 3 couches, données de marché, module fiscal
- `tests/` : tests pytest (backend)
- `docker/` : Dockerfiles multi-stage, configuration nginx et compose

## Configuration
1. Copier `.env.example` en `.env` à la racine et le compléter (le fichier `.env` n'est jamais versionné).
2. Générer un jeton d'accès pour l'API locale :
   `python -c "import secrets; print(secrets.token_urlsafe(32))"` → `APP_ACCESS_TOKEN=...`
3. Côté Trading 212 : restreindre la clé API à votre IP et aux permissions nécessaires
   (lecture du compte, historique, et ordres seulement si vous les utilisez).

| Variable | Rôle |
| --- | --- |
| `api_key_id`, `secret_key` | Clé API Trading 212 |
| `TRADING212_BASE_URL` | `https://demo.trading212.com` ou `https://live.trading212.com` (aucun autre hôte accepté) |
| `APP_ACCESS_TOKEN` | Jeton exigé par le backend (`Authorization: Bearer`). Vide = pas d'authentification |
| `FRONTEND_ORIGIN` | Origine autorisée par CORS |
| `MIN_ORDER_QUANTITY`, `MAX_ORDER_QUANTITY` | Garde-fous sur la taille des ordres |
| `BOT_DEFAULT_POLL_INTERVAL_SECONDS`, `BOT_MAX_TICKERS` | Paramètres du bot |

## Lancement local
Backend :
```bash
cd backend
uv sync
uv run uvicorn app.main:app --app-dir src --reload --host 127.0.0.1 --port 8000
```

Frontend :
```bash
cd frontend
pnpm install
pnpm dev
```

Au premier accès, l'interface demande le jeton `APP_ACCESS_TOKEN`.

## Docker
```bash
cd docker
docker compose up -d --build
```
L'interface est servie sur `http://127.0.0.1:5173` (boucle locale uniquement) ; nginx relaie `/api` vers le
backend, qui n'est pas exposé sur l'hôte. Conteneurs non-root, en lecture seule.

## Qualité
```bash
cd backend && uv run ruff format src ../tests && uv run ruff check src ../tests && uv run pytest
cd frontend && pnpm lint && pnpm build
```

## Fonctionnalités
- Ordres `MARKET`, `LIMIT`, `STOP`, `STOP_LIMIT` (confirmation explicite exigée en LIVE)
- Bot 3 couches : régime de marché, signal + filtre de confiance, gestion du risque (ATR, SL/TP,
  drawdown, cooldown), allocation de cash dédiée, cycles sérialisés
- Historique de marché : `GET /api/market/history?ticker=AAPL_US_EQ&interval=1h&range=3mo`
- **Onglet Fiscalité (IFU)** — Trading 212 ne fournit pas d'IFU aux résidents français :
  - import des exports CSV Trading 212 (plusieurs années, doublons ignorés) ou génération des
    rapports via l'API (`/api/v0/equity/history/exports`) ;
  - plus/moins-values au **prix moyen pondéré (PMP)** en euros, frais inclus, splits gérés ;
  - dividendes bruts (net + retenue à la source), classement 2DC / 2TS modifiable, crédit d'impôt
    2AB plafonné au taux conventionnel ; intérêts sur liquidités en 2TR ;
  - cases 2042 / 2042-C (2DC, 2TS, 2TR, 2AB, 2CK, 3VG, 3VH), ventilation par pays (2047),
    détail des cessions exportable (2074), aide au formulaire 3916, estimation du PFU ;
  - impression / export PDF depuis le navigateur.

## Important
- Le mode `LIVE` exécute des ordres réels. Toujours valider en `DRY_RUN` / compte démo.
- Les ordres API ne sont pas idempotents.
- Le module fiscal est une aide au calcul, pas un conseil fiscal : vérifier les montants avec les
  notices officielles de l'année (impots.gouv.fr).
