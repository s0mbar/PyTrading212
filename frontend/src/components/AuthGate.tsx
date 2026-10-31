import { useState } from "react";

import { fetchBotStatus } from "../api/client";
import { clearAccessToken, saveAccessToken, UnauthorizedError } from "../api/http";

type AuthGateProps = {
  onAuthenticated: () => void;
};

function AuthGate({ onAuthenticated }: AuthGateProps) {
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError("");
    saveAccessToken(token.trim(), remember);

    try {
      await fetchBotStatus();
      onAuthenticated();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        clearAccessToken();
        setError("Jeton refusé par le backend.");
      } else {
        onAuthenticated();
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <article className="card auth-card">
      <h2>Accès protégé</h2>
      <p className="meta">
        Le backend exige un jeton d'accès (variable <code>APP_ACCESS_TOKEN</code> du fichier <code>.env</code>).
      </p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Jeton d'accès
          <input
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Mémoriser sur cet appareil
        </label>
        <button type="submit" disabled={checking || token.trim().length === 0}>
          {checking ? "Vérification..." : "Se connecter"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </article>
  );
}

export default AuthGate;
