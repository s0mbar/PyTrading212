import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { fetchHealth, fetchOverview, type TradingOverview } from "./api/client";
import { clearAccessToken, errorMessage, getAccessToken, setUnauthorizedHandler, UnauthorizedError } from "./api/http";
import AuthGate from "./features/auth/AuthGate";
import BotView from "./features/bot/BotView";
import OrderView from "./features/order/OrderView";
import PortfolioView from "./features/portfolio/PortfolioView";
import { useHashRoute } from "./hooks/useHashRoute";
import { usePolling } from "./hooks/usePolling";
import { formatRelative } from "./lib/format";
import { Button } from "./ui/controls";
import { Card, GlobalProgress, Notice, Skeleton } from "./ui/feedback";
import { IconBot, IconLogout, IconOrder, IconRefresh, IconTax, IconWallet } from "./ui/icons";

// The tax module is the heaviest screen: loaded only when opened.
const TaxView = lazy(() => import("./features/tax/TaxView"));

const ROUTES = ["portefeuille", "ordre", "bot", "impots"] as const;
type Route = (typeof ROUTES)[number];

const NAV: { route: Route; label: string; Icon: typeof IconWallet }[] = [
  { route: "portefeuille", label: "Portefeuille", Icon: IconWallet },
  { route: "ordre", label: "Ordre", Icon: IconOrder },
  { route: "bot", label: "Bot", Icon: IconBot },
  { route: "impots", label: "Impôts", Icon: IconTax },
];

type AuthState = "checking" | "required" | "ready";

function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [route, navigate] = useHashRoute(ROUTES, "portefeuille");
  const [data, setData] = useState<TradingOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [orderTicker, setOrderTicker] = useState({ ticker: "", nonce: 0 });
  const [taxOpened, setTaxOpened] = useState(false);
  // Once opened (button, link or back button), the tax screen stays mounted.
  if (route === "impots" && !taxOpened) {
    setTaxOpened(true);
  }

  const refresh = useCallback(async (silent = false) => {
    setLoading(true);
    try {
      setData(await fetchOverview({ silent }));
      setError("");
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        setError(errorMessage(err, "Trading 212 injoignable."));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthState("required"));
    let cancelled = false;
    fetchHealth()
      .then((health) => {
        if (!cancelled) {
          setAuthState(health.auth_required && !getAccessToken() ? "required" : "ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAuthState("ready");
        }
      });
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, []);

  // Account overview: refreshed every minute while visible (the backend caches Trading 212 calls).
  usePolling(() => refresh(true), 60_000, authState === "ready");

  const prepareOrder = (ticker: string) => {
    setOrderTicker((current) => ({ ticker, nonce: current.nonce + 1 }));
    navigate("ordre");
  };

  const logout = () => {
    clearAccessToken();
    setData(null);
    setAuthState("required");
  };

  if (authState === "checking") {
    return (
      <div className="auth-screen">
        <GlobalProgress />
        <Card>
          <Skeleton lines={2} />
        </Card>
      </div>
    );
  }
  if (authState === "required") {
    return <AuthGate onAuthenticated={() => setAuthState("ready")} />;
  }

  const positions = data?.portfolio?.data ?? [];
  const isLive = data?.environment === "LIVE";

  return (
    <div className="app">
      <GlobalProgress />
      <header className="topbar no-print">
        <div className="brand">
          <img src="/icons/favicon-64.png" alt="" width={28} height={28} />
          <span>PyTrading</span>
          {data?.environment && (
            <span className={isLive ? "env env-live" : "env"}>{isLive ? "Compte réel" : "Démo"}</span>
          )}
        </div>
        <div className="topbar-actions">
          <span className="sync meta" title={data?.fetchedAt ? new Date(data.fetchedAt).toLocaleString("fr-FR") : ""}>
            {data?.fetchedAt ? `MAJ ${formatRelative(data.fetchedAt)}` : ""}
          </span>
          <button
            type="button"
            className={loading ? "icon-button spinning" : "icon-button"}
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Actualiser"
            title="Actualiser"
          >
            <IconRefresh />
          </button>
          <button type="button" className="icon-button" onClick={logout} aria-label="Se déconnecter" title="Se déconnecter">
            <IconLogout />
          </button>
        </div>
      </header>

      <nav className="tabbar no-print" aria-label="Sections">
        {NAV.map(({ route: item, label, Icon }) => (
          <button
            key={item}
            type="button"
            className={route === item ? "tab active" : "tab"}
            aria-current={route === item ? "page" : undefined}
            onClick={() => navigate(item)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="content">
        {error && (
          <Notice tone="danger" title="Connexion à Trading 212 impossible">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => void refresh()}>
              Réessayer
            </Button>
          </Notice>
        )}
        {data?.warning && <Notice tone="warning">{data.warning}</Notice>}

        {route === "portefeuille" && <PortfolioView data={data} loading={loading} onOrder={prepareOrder} />}
        {route === "ordre" && (
          <OrderView
            key={orderTicker.nonce}
            positions={positions}
            environment={data?.environment}
            initialTicker={orderTicker.ticker}
            onOrderPlaced={() => refresh()}
          />
        )}
        {/* Bot and tax screens stay mounted: unsaved settings and imported files survive tab changes. */}
        <div hidden={route !== "bot"}>
          <BotView active={route === "bot"} positions={positions} onCycleDone={() => refresh(true)} />
        </div>
        {taxOpened && (
          <div hidden={route !== "impots"}>
            <Suspense
              fallback={
                <Card>
                  <Skeleton lines={4} />
                </Card>
              }
            >
              <TaxView />
            </Suspense>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
