import { useId, useState } from "react";

import { fetchBotStatus } from "../../api/client";
import { clearAccessToken, saveAccessToken, UnauthorizedError } from "../../api/http";
import { Button, Field, Toggle } from "../../ui/controls";
import { Notice } from "../../ui/feedback";

function AuthGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const tokenId = useId();
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
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
        setError("Jeton refusé. Vérifie qu'il est copié en entier, sans espace.");
      } else {
        onAuthenticated();
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="card auth-card" onSubmit={onSubmit}>
        <img className="auth-logo" src="/icons/pytrading-192.png" alt="" width={72} height={72} />
        <h1>PyTrading</h1>
        <p className="meta">
          Accès protégé. Saisis le jeton d'accès (<code>APP_ACCESS_TOKEN</code>) une seule fois sur cet appareil.
        </p>
        <Field label="Jeton d'accès" htmlFor={tokenId}>
          <input
            id={tokenId}
            type="password"
            autoComplete="current-password"
            autoCapitalize="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
          />
        </Field>
        <Toggle
          checked={remember}
          onChange={setRemember}
          label="Rester connecté sur cet appareil"
          hint="Décoche sur un appareil partagé : le jeton sera oublié à la fermeture."
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" block pending={checking} pendingLabel="Vérification…" disabled={!token.trim()}>
          Se connecter
        </Button>
      </form>
    </div>
  );
}

export default AuthGate;
