import { useCallback, useMemo, useState } from "react";

import {
  fetchBotStatus,
  runBotOnce,
  updateBotConfig,
  type BotConfig,
  type BotMode,
  type BotStatus,
  type Position,
} from "../../api/client";
import { errorMessage, UnauthorizedError } from "../../api/http";
import { useAction } from "../../hooks/useAction";
import { usePolling } from "../../hooks/usePolling";
import { formatMoney, formatRelative } from "../../lib/format";
import { Button, Collapsible, NumberField, Segmented, Toggle } from "../../ui/controls";
import { Dialog } from "../../ui/Dialog";
import { ActionFeedback, Card, Notice, Skeleton, Stat } from "../../ui/feedback";
import {
  ADVANCED_GROUPS,
  BUDGET_FIELDS,
  matchingPreset,
  PRESETS,
  REGIME_LABELS,
  sameConfig,
  validateBotConfig,
  type NumericFieldMeta,
} from "./botConfig";
import DecisionList from "./DecisionList";
import TickerChips from "./TickerChips";

const POLL_MS = 15_000;

type BotViewProps = {
  active: boolean;
  positions: Position[];
  onCycleDone: () => Promise<void>;
};

function BotView({ active, positions, onCycleDone }: BotViewProps) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [draft, setDraft] = useState<BotConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pendingLive, setPendingLive] = useState<BotConfig | null>(null);
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const action = useAction();

  const load = useCallback(async () => {
    try {
      const next = await fetchBotStatus({ silent: true });
      setStatus(next);
      // The form is filled once; later polls refresh the status without erasing edits.
      setDraft((current) => current ?? next.config);
      setLoadError("");
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        setLoadError(errorMessage(err, "État du bot indisponible."));
      }
    }
  }, []);

  usePolling(load, POLL_MS, active);

  const errors = useMemo(() => (draft ? validateBotConfig(draft) : {}), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  // Starting is validated as if already enabled (requires at least one ticker).
  const startErrors = useMemo(() => (draft ? validateBotConfig({ ...draft, enabled: true }) : {}), [draft]);
  const canStart = Object.keys(startErrors).length === 0;
  const dirty = Boolean(draft && status && !sameConfig(draft, status.config));
  const suggestions = useMemo(
    () =>
      positions
        .map((position) => ({ ticker: position.instrument?.ticker ?? "", name: position.instrument?.name ?? "" }))
        .filter((item) => item.ticker),
    [positions]
  );

  if (!status || !draft) {
    return loadError ? (
      <Notice tone="danger" title="Bot indisponible">
        {loadError}
      </Notice>
    ) : (
      <Card>
        <Skeleton lines={5} />
      </Card>
    );
  }

  const saved = status.config;
  const update = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  const persist = async (next: BotConfig, message: string, keepEdits = false) => {
    const result = await action.run(() => updateBotConfig(next), message);
    if (result) {
      setStatus(result);
      setDraft((current) => (keepEdits && current ? { ...current, enabled: result.config.enabled } : result.config));
    }
  };

  /** Any change that lets the bot place REAL orders goes through a confirmation. */
  const save = (next: BotConfig, message: string) => {
    const becomesLive = next.enabled && next.mode === "LIVE" && !(saved.enabled && saved.mode === "LIVE");
    if (becomesLive) {
      setLiveConfirmed(false);
      setPendingLive(next);
      return;
    }
    void persist(next, message);
  };

  const start = () => save({ ...draft, enabled: true }, "Bot démarré.");
  // Stopping never waits for the form to be valid: it applies to the saved configuration.
  const stop = () => {
    void persist({ ...saved, enabled: false }, "Bot arrêté.", true);
  };
  const runOnce = async () => {
    const result = await action.run(
      () => runBotOnce(),
      saved.mode === "LIVE" ? "Cycle exécuté (mode réel)." : "Cycle exécuté en simulation : aucun ordre réel."
    );
    if (result) {
      setStatus(result);
      await onCycleDone();
    }
  };

  const running = saved.enabled;
  const isLive = saved.mode === "LIVE";
  const allocation = status.allocation;
  const nextCycle =
    running && status.last_cycle_at
      ? new Date(new Date(status.last_cycle_at).getTime() + saved.poll_interval_seconds * 1000).toISOString()
      : null;
  const preset = matchingPreset(draft);

  const numberInput = (meta: NumericFieldMeta) => {
    const scale = meta.scale ?? 1;
    return (
      <NumberField
        key={meta.key}
        label={meta.label}
        hint={meta.hint}
        unit={meta.unit}
        value={draft[meta.key] / scale}
        min={meta.min / scale}
        max={meta.max / scale}
        step={meta.step / scale}
        error={errors[meta.key]}
        onChange={(value) => update(meta.key, Math.round(value * scale * 10_000) / 10_000)}
      />
    );
  };

  return (
    <div className="stack">
      <Card className={`bot-status ${running ? (isLive ? "is-live" : "is-running") : "is-stopped"}`}>
        <div className="bot-status-head">
          <span className="status-dot" aria-hidden="true" />
          <div>
            <h2>{running ? (isLive ? "Bot actif — ordres RÉELS" : "Bot actif — simulation") : "Bot arrêté"}</h2>
            <p className="meta">
              {running
                ? `Dernière analyse ${formatRelative(status.last_cycle_at)}${nextCycle ? ` · prochaine ${formatRelative(nextCycle)}` : ""}`
                : "Il n'analyse rien et ne passe aucun ordre."}
              {" · "}
              {status.daily_trades} trade(s) aujourd'hui
            </p>
          </div>
        </div>

        <div className="stats-grid compact">
          <Stat label="Budget du bot" value={formatMoney(allocation.allocated_cash)} />
          <Stat label="Engagé" value={formatMoney(allocation.allocated_in_use)} />
          <Stat label="Restant" value={formatMoney(allocation.allocated_remaining)} />
          <Stat label="Liquidités du compte" value={formatMoney(allocation.free_cash)} />
        </div>
        {allocation.allocated_cash > 0 && (
          <progress
            className="budget-bar"
            value={allocation.allocated_in_use}
            max={allocation.allocated_cash}
            aria-label="Part du budget engagée"
          />
        )}

        {Object.keys(status.regime_by_ticker).length > 0 && (
          <ul className="chips chips-static">
            {Object.entries(status.regime_by_ticker).map(([ticker, regime]) => (
              <li key={ticker} className="chip">
                {ticker} · {REGIME_LABELS[regime] ?? regime}
              </li>
            ))}
          </ul>
        )}

        <div className="button-row">
          {running ? (
            <Button variant="danger" onClick={stop} pending={action.pending} pendingLabel="Arrêt…">
              Arrêter le bot
            </Button>
          ) : (
            <Button onClick={start} disabled={!canStart} pending={action.pending} pendingLabel="Démarrage…">
              {dirty ? "Enregistrer et démarrer" : "Démarrer le bot"}
            </Button>
          )}
          <Button variant="secondary" onClick={() => void runOnce()} disabled={action.pending || saved.tickers.length === 0}>
            Tester un cycle maintenant
          </Button>
        </div>
        {!running && !canStart && (
          <p className="field-hint">
            {startErrors.tickers ? "Pour démarrer, ajoute au moins un titre à surveiller (étape 1)." : "Corrige les réglages signalés avant de démarrer."}
          </p>
        )}
        <ActionFeedback error={action.error || loadError} success={action.success} />
      </Card>

      <Card title="1. Que surveiller ?" subtitle="Les titres que le bot analyse à chaque cycle.">
        <TickerChips
          tickers={draft.tickers}
          onChange={(tickers) => update("tickers", tickers)}
          suggestions={suggestions}
          error={errors.tickers}
        />
      </Card>

      <Card title="2. Avec quel budget ?" subtitle="Le bot ne touche qu'à cette enveloppe, jamais au reste du compte.">
        <div className="form-grid">{BUDGET_FIELDS.map(numberInput)}</div>
      </Card>

      <Card title="3. Quel niveau de risque ?" subtitle="Un profil règle d'un coup les paramètres de risque et les garde-fous.">
        <div className="presets" role="radiogroup" aria-label="Profil de risque">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={preset === item.id}
              className={preset === item.id ? "preset active" : "preset"}
              onClick={() => setDraft((current) => (current ? { ...current, ...item.values } : current))}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        {!preset && <p className="meta">Réglages personnalisés (voir « Réglages avancés »).</p>}
      </Card>

      <Card title="4. Simulation ou réel ?">
        <Segmented<BotMode>
          label="Mode d'exécution"
          value={draft.mode}
          onChange={(mode) => update("mode", mode)}
          options={[
            { value: "DRY_RUN", label: "Simulation" },
            { value: "LIVE", label: "Réel", tone: "live" },
          ]}
        />
        <p className="field-hint">
          {draft.mode === "LIVE"
            ? "Le bot passera de vrais ordres sur ton compte, dans la limite de son budget."
            : "Le bot décide et journalise, mais n'envoie aucun ordre. Idéal pour valider une stratégie."}
        </p>
      </Card>

      <Card title="Réglages avancés" subtitle="Optionnels : les profils ci-dessus suffisent dans la plupart des cas.">
        {ADVANCED_GROUPS.map((group) => (
          <Collapsible
            key={group.title}
            title={group.title}
            badge={group.numbers.some((meta) => errors[meta.key]) ? "à corriger" : undefined}
          >
            <p className="meta">{group.intro}</p>
            <div className="form-grid">{group.numbers.map(numberInput)}</div>
            {group.title.startsWith("Exécution") && (
              <div className="form-grid">
                <div className="field">
                  <span className="field-label">Type d'ordre envoyé</span>
                  <Segmented
                    label="Type d'ordre envoyé par le bot"
                    value={draft.execution_order_type}
                    onChange={(value) => update("execution_order_type", value)}
                    options={[
                      { value: "MARKET", label: "Marché" },
                      { value: "LIMIT", label: "Limite" },
                      { value: "STOP", label: "Stop" },
                      { value: "STOP_LIMIT", label: "Stop lim." },
                    ]}
                  />
                </div>
                <div className="field">
                  <span className="field-label">Validité</span>
                  <Segmented
                    label="Validité des ordres du bot"
                    value={draft.execution_time_validity}
                    onChange={(value) => update("execution_time_validity", value)}
                    options={[
                      { value: "DAY", label: "Jour" },
                      { value: "GOOD_TILL_CANCEL", label: "Jusqu'à annulation" },
                    ]}
                  />
                </div>
              </div>
            )}
            {group.toggles.map((toggle) => (
              <Toggle
                key={toggle.key}
                checked={draft[toggle.key]}
                onChange={(checked) => update(toggle.key, checked)}
                label={toggle.label}
                hint={toggle.hint}
              />
            ))}
          </Collapsible>
        ))}
      </Card>

      {dirty && (
        <div className="save-bar" role="region" aria-label="Modifications non enregistrées">
          <span>{hasErrors ? "Corrige les champs signalés." : "Modifications non enregistrées."}</span>
          <div className="button-row">
            <Button variant="ghost" onClick={() => setDraft(saved)} disabled={action.pending}>
              Annuler
            </Button>
            <Button onClick={() => save(draft, "Configuration enregistrée.")} disabled={hasErrors} pending={action.pending} pendingLabel="Enregistrement…">
              Enregistrer
            </Button>
          </div>
        </div>
      )}

      <Card title="Journal des décisions" subtitle="Rafraîchi automatiquement toutes les 15 s.">
        <DecisionList decisions={status.recent_decisions} />
      </Card>

      <Dialog
        open={pendingLive !== null}
        tone="danger"
        title="Passer le bot en argent réel ?"
        onClose={() => setPendingLive(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingLive(null)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              disabled={!liveConfirmed}
              pending={action.pending}
              onClick={() => {
                const next = pendingLive;
                setPendingLive(null);
                if (next) {
                  void persist(next, "Bot démarré en mode réel.");
                }
              }}
            >
              Activer le mode réel
            </Button>
          </>
        }
      >
        <p>
          Le bot pourra acheter et vendre automatiquement sur ton compte Trading 212, jusqu'à{" "}
          <strong>{formatMoney(pendingLive?.allocated_cash_amount ?? 0)}</strong>, sur{" "}
          {pendingLive?.tickers.join(", ") || "aucun titre"}.
        </p>
        <p className="meta">Conseil : laisse-le d'abord tourner quelques jours en simulation et relis son journal.</p>
        <Toggle checked={liveConfirmed} onChange={setLiveConfirmed} label="J'ai compris : il utilisera de l'argent réel" />
      </Dialog>
    </div>
  );
}

export default BotView;
