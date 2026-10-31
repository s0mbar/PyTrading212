import { useCallback, useEffect, useState } from "react";

import { fetchHealth, fetchOverview, type TradingOverview } from "./api/client";
import { errorMessage, getAccessToken, setUnauthorizedHandler, UnauthorizedError } from "./api/http";
import AuthGate from "./components/AuthGate";
import BotPanel from "./components/BotPanel";
import DashboardPanel from "./components/DashboardPanel";
import OrderPanel from "./components/OrderPanel";
import TaxPanel from "./components/tax/TaxPanel";

type Status = "idle" | "loading" | "success" | "error";
type AuthState = "checking" | "required" | "ready";
type TabId = "dashboard" | "orders" | "bot" | "tax";

const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Portefeuille" },
  { id: "orders", label: "Ordres" },
  { id: "bot", label: "Bot" },
  { id: "tax", label: "Fiscalité (IFU)" },
];

function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [tab, setTab] = useState<TabId>("dashboard");
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<TradingOverview | null>(null);
  const [error, setError] = useState<string>("");

  const refresh = useCallback(async () => {
    setStatus("loading");

    try {
      const payload = await fetchOverview();
      setData(payload);
      setError("");
      setStatus("success");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(errorMessage(err, "Unexpected error"));
    }
  }, []);

  const markReady = useCallback(() => {
    setAuthState("ready");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthState("required"));
    fetchHealth()
      .then((health) => {
        if (health.auth_required && !getAccessToken()) {
          setAuthState("required");
        } else {
          markReady();
        }
      })
      .catch(markReady);
    return () => setUnauthorizedHandler(null);
  }, [markReady]);

  return (
    <main className="page">
      <section className="panel">
        <header className="panel-header">
          <div>
            <p className="kicker">PyTrading212</p>
            <h1>Live Trading + Adaptive Bot Console</h1>
          </div>
          {authState === "ready" && (
            <button className="no-print" onClick={() => void refresh()} disabled={status === "loading"}>
              {status === "loading" ? "Loading..." : "Refresh"}
            </button>
          )}
        </header>

        {authState === "checking" && <p className="meta">Connexion au backend...</p>}
        {authState === "required" && <AuthGate onAuthenticated={markReady} />}

        {authState === "ready" && (
          <>
            <p className={`environment-pill ${data?.environment === "LIVE" ? "live" : "demo"}`}>
              Environment: {data?.environment ?? "..."}
            </p>

            {data?.warning && <p className="warning-banner">{data.warning}</p>}

            {status === "error" && (
              <div className="error-box">
                <p className="error-title">Trading 212 connection failed</p>
                <p className="error">{error}</p>
              </div>
            )}

            <p className="meta">
              {data?.fetchedAt ? `Last sync: ${new Date(data.fetchedAt).toLocaleString("fr-FR")}` : ""}
              {data?.cached ? " • cached snapshot" : ""}
            </p>

            <nav className="tabs no-print" role="tablist" aria-label="Sections">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.id}
                  className={tab === item.id ? "tab active" : "tab"}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Panels stay mounted so imported files and form drafts survive tab switches. */}
            <div role="tabpanel" hidden={tab !== "dashboard"}>
              <DashboardPanel data={data} />
            </div>
            <div role="tabpanel" hidden={tab !== "orders"}>
              <OrderPanel onOrderPlaced={refresh} />
            </div>
            <div role="tabpanel" hidden={tab !== "bot"}>
              <BotPanel onCycleDone={refresh} />
            </div>
            <div role="tabpanel" hidden={tab !== "tax"}>
              <TaxPanel />
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export default App;
