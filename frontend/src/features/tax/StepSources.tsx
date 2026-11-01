import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "../../api/http";
import { listExports, requestExport, type ExportReport } from "../../api/tax";
import { formatDate } from "../../lib/format";
import { Button, Collapsible } from "../../ui/controls";
import { ActionFeedback, Card, Notice, Spinner } from "../../ui/feedback";
import { MAX_FILE_BYTES, yearsInCsv, type LoadedFile, type YearCoverage } from "./taxSources";

// Trading 212 allows one export request every 30 s and one listing per minute.
const REQUEST_SPACING_MS = 31_000;
const MIN_LIST_SPACING_MS = 62_000;

const STATUS_TEXT: Record<YearCoverage["status"], string> = {
  ready: "Prêt",
  pending: "En préparation chez Trading 212…",
  failed: "Échec — à redemander",
  missing: "Pas encore demandé",
};

function Countdown({ until, label }: { until: number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  return (
    <span className="meta">
      {label} {seconds > 0 ? `dans ${seconds} s` : "maintenant…"}
    </span>
  );
}

type StepSourcesProps = {
  year: number;
  coverage: YearCoverage[];
  files: LoadedFile[];
  onFilesChange: (files: LoadedFile[]) => void;
  reports: ExportReport[];
  onReportsChange: (reports: ExportReport[]) => void;
  canContinue: boolean;
  onBack: () => void;
  onNext: () => void;
};

function StepSources({
  year,
  coverage,
  files,
  onFilesChange,
  reports,
  onReportsChange,
  canContinue,
  onBack,
  onNext,
}: StepSourcesProps) {
  const [listing, setListing] = useState(false);
  const [nextListAt, setNextListAt] = useState(0);
  const [requesting, setRequesting] = useState<{ done: number; total: number; nextAt: number } | null>(null);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(
    async (silent: boolean) => {
      setListing(true);
      try {
        const result = await listExports(silent);
        if (!alive.current) {
          return;
        }
        onReportsChange(result.reports);
        setNextListAt(Date.now() + Math.max(result.next_refresh_seconds * 1000, MIN_LIST_SPACING_MS));
        setError("");
      } catch (err) {
        if (alive.current) {
          setError(errorMessage(err, "Impossible de lister les exports Trading 212."));
          setNextListAt(Date.now() + MIN_LIST_SPACING_MS);
        }
      } finally {
        if (alive.current) {
          setListing(false);
        }
      }
    },
    [onReportsChange]
  );

  // First visit: fetch the list once.
  const fetchedOnce = useRef(false);
  useEffect(() => {
    if (!fetchedOnce.current) {
      fetchedOnce.current = true;
      void refresh(false);
    }
  }, [refresh]);

  // While Trading 212 is preparing files, re-check automatically (respecting its rate limit).
  const waiting = coverage.some((item) => item.status === "pending") || requesting !== null;
  useEffect(() => {
    if (!waiting || listing || requesting) {
      return undefined;
    }
    const timer = window.setTimeout(() => void refresh(true), Math.max(1000, nextListAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [waiting, listing, requesting, nextListAt, refresh]);

  const toRequest = coverage.filter((item) => (item.status === "missing" || item.status === "failed") && !item.fromCsv);

  const requestYears = async (years: number[]) => {
    setError("");
    setInfo("");
    for (let index = 0; index < years.length; index += 1) {
      if (!alive.current) {
        return;
      }
      setRequesting({ done: index, total: years.length, nextAt: 0 });
      try {
        await requestExport(years[index]);
      } catch (err) {
        if (alive.current) {
          setError(errorMessage(err, "Demande refusée par Trading 212."));
          setRequesting(null);
        }
        return;
      }
      if (index < years.length - 1) {
        const nextAt = Date.now() + REQUEST_SPACING_MS;
        setRequesting({ done: index + 1, total: years.length, nextAt });
        await new Promise((resolve) => window.setTimeout(resolve, REQUEST_SPACING_MS));
      }
    }
    if (alive.current) {
      setRequesting(null);
      setInfo("Demandes envoyées. Trading 212 prépare les fichiers (souvent 1 à 5 minutes) : la liste se met à jour toute seule.");
      setNextListAt(Date.now() + MIN_LIST_SPACING_MS);
    }
  };

  const addFiles = async (picked: File[]) => {
    setFileError("");
    const csv = picked.filter((file) => /\.csv$/i.test(file.name) || file.type === "text/csv");
    const tooLarge = csv.filter((file) => file.size > MAX_FILE_BYTES);
    const ignored = picked.length - csv.length;
    const problems = [
      tooLarge.length ? `trop volumineux (> 20 Mo) : ${tooLarge.map((file) => file.name).join(", ")}` : "",
      ignored ? `${ignored} fichier(s) non CSV ignoré(s)` : "",
    ].filter(Boolean);
    if (problems.length) {
      setFileError(problems.join(" · "));
    }
    const loaded = await Promise.all(
      csv
        .filter((file) => file.size <= MAX_FILE_BYTES)
        .map(async (file) => {
          const content = await file.text();
          return { name: file.name, size: file.size, content, years: yearsInCsv(content) };
        })
    );
    const known = new Set(files.map((file) => `${file.name}:${file.size}`));
    onFilesChange([...files, ...loaded.filter((file) => !known.has(`${file.name}:${file.size}`))]);
  };

  const missingEarlier = coverage.filter((item) => item.year < year && item.status !== "ready" && !item.fromCsv);

  return (
    <div className="stack">
      <Card title="Tes données, année par année" subtitle="Chaque année doit être couverte par un export Trading 212 OU un fichier CSV.">
        <ul className="coverage">
          {coverage.map((item) => {
            const ok = item.status === "ready" || item.fromCsv;
            return (
              <li key={item.year} className={`coverage-row ${ok ? "ok" : item.status}`}>
                <span className="coverage-year">{item.year}</span>
                <span className="coverage-status">
                  {item.fromCsv ? "Couvert par un fichier CSV" : STATUS_TEXT[item.status]}
                  {item.report && !item.fromCsv && (
                    <small>
                      Export n°{item.report.reportId} · {formatDate(item.report.timeFrom)} → {formatDate(item.report.timeTo)}
                    </small>
                  )}
                </span>
                <span className="coverage-icon" aria-hidden="true">
                  {ok ? "✓" : item.status === "pending" ? <span className="spinner" /> : "•"}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="meta coverage-foot">
          {listing ? (
            <Spinner label="Vérification auprès de Trading 212…" />
          ) : waiting && nextListAt > 0 ? (
            <Countdown until={nextListAt} label="Nouvelle vérification" />
          ) : null}
        </div>
      </Card>

      <Card
        title="Option A — Automatique (recommandé)"
        subtitle="Le serveur demande les exports directement à Trading 212 avec ta clé API. Rien à télécharger."
      >
        {requesting ? (
          <div className="stack-sm">
            <progress value={requesting.done} max={requesting.total} aria-label="Demandes envoyées" />
            <p className="meta">
              Demande {Math.min(requesting.done + 1, requesting.total)} sur {requesting.total}
              {requesting.nextAt > 0 && " — Trading 212 impose 30 s entre deux demandes."}
            </p>
            {requesting.nextAt > 0 && <Countdown until={requesting.nextAt} label="Demande suivante" />}
          </div>
        ) : toRequest.length > 0 ? (
          <Button block onClick={() => void requestYears(toRequest.map((item) => item.year))}>
            Demander {toRequest.length === 1 ? `l'export ${toRequest[0].year}` : `les ${toRequest.length} exports manquants`}
          </Button>
        ) : (
          <Notice tone="success">Rien à demander : toutes les années sont prêtes ou couvertes.</Notice>
        )}
        <div className="button-row">
          {/* Trading 212 allows one listing per minute: too early, the backend answers from its cache. */}
          <Button variant="ghost" disabled={listing} onClick={() => void refresh(false)}>
            Actualiser la liste
          </Button>
          <span className="meta">{reports.length} export(s) trouvé(s) sur ton compte.</span>
        </div>
        <ActionFeedback error={error} success={info} />
      </Card>

      <Card title="Option B — Fichiers CSV" subtitle="Si l'option A ne marche pas, ou pour compléter.">
        <Collapsible title="Comment obtenir mes fichiers CSV ?">
          <ol className="guide-list">
            <li>Ouvre Trading 212 (appli ou site web) et va dans l'<strong>historique</strong> du compte.</li>
            <li>
              Touche <strong>Exporter</strong> (icône de téléchargement en haut de l'historique).
            </li>
            <li>
              Choisis la période <strong>du 1er janvier au 31 décembre</strong> d'une année (un an maximum par
              fichier).
            </li>
            <li>
              Coche <strong>tout</strong> : ordres, dividendes, transactions, intérêts… puis valide l'export.
            </li>
            <li>Le fichier se télécharge (ou arrive par e-mail) : ajoute-le ci-dessous. Recommence pour chaque année.</li>
          </ol>
        </Collapsible>

        <label
          className={dragging ? "dropzone dragging" : "dropzone"}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              event.target.value = "";
              void addFiles(picked);
            }}
          />
          <strong>Choisir des fichiers CSV</strong>
          <span className="meta">ou les glisser ici · traités par ton serveur, jamais conservés</span>
        </label>
        {fileError && <Notice tone="warning">{fileError}</Notice>}
        {files.length > 0 && (
          <ul className="file-list">
            {files.map((file) => (
              <li key={`${file.name}:${file.size}`}>
                <span>
                  {file.name}
                  <small>
                    {Math.ceil(file.size / 1024)} Ko ·{" "}
                    {file.years.length ? `années ${file.years.join(", ")}` : "aucune date reconnue — est-ce bien un export Trading 212 ?"}
                  </small>
                </span>
                <Button variant="ghost" onClick={() => onFilesChange(files.filter((item) => item !== file))}>
                  Retirer
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canContinue && missingEarlier.length > 0 && (
        <Notice tone="warning" title="Historique incomplet">
          Il manque {missingEarlier.map((item) => item.year).join(", ")}. Tu peux continuer, mais le prix de revient des
          titres achetés ces années-là sera inconnu : les plus-values seront signalées « à vérifier ».
        </Notice>
      )}

      <div className="step-nav">
        <Button variant="secondary" onClick={onBack}>
          Retour
        </Button>
        <Button onClick={onNext} disabled={!canContinue}>
          {canContinue ? "Continuer" : `En attente des données ${year}`}
        </Button>
      </div>
    </div>
  );
}

export default StepSources;
