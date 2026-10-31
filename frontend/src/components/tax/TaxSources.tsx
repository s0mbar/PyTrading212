import { useState } from "react";

import { errorMessage } from "../../api/http";
import { listExports, requestExport, type ExportReport } from "../../api/tax";
import { formatDate } from "../../lib/format";

export type LoadedFile = {
  name: string;
  size: number;
  content: string;
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

const STATUS_LABELS: Record<string, string> = {
  Queued: "En file d'attente",
  Processing: "En préparation",
  Running: "En cours",
  Canceled: "Annulé",
  Failed: "Échec",
  Finished: "Prêt",
};

type TaxSourcesProps = {
  year: number;
  files: LoadedFile[];
  onFilesChange: (files: LoadedFile[]) => void;
  selectedReports: number[];
  onSelectedReportsChange: (ids: number[]) => void;
};

function TaxSources({ year, files, onFilesChange, selectedReports, onSelectedReportsChange }: TaxSourcesProps) {
  const [fileError, setFileError] = useState("");
  const [reports, setReports] = useState<ExportReport[]>([]);
  const [exportsInfo, setExportsInfo] = useState("");
  const [exportsError, setExportsError] = useState("");
  const [exportsLoading, setExportsLoading] = useState(false);

  const onPickFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    setFileError("");

    const tooLarge = picked.filter((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge.length > 0) {
      setFileError(`Fichier(s) trop volumineux (> 20 Mo) : ${tooLarge.map((file) => file.name).join(", ")}`);
    }
    const accepted = picked.filter((file) => file.size <= MAX_FILE_BYTES);
    const loaded = await Promise.all(
      accepted.map(async (file) => ({ name: file.name, size: file.size, content: await file.text() }))
    );
    const known = new Set(files.map((file) => `${file.name}:${file.size}`));
    onFilesChange([...files, ...loaded.filter((file) => !known.has(`${file.name}:${file.size}`))]);
  };

  const refreshReports = async () => {
    setExportsLoading(true);
    setExportsError("");
    try {
      const result = await listExports();
      setReports(result.reports);
      setExportsInfo(
        result.cached
          ? `Liste en cache (Trading 212 limite à 1 actualisation par minute, prochaine dans ${result.next_refresh_seconds} s).`
          : "Liste à jour."
      );
    } catch (err) {
      setExportsError(errorMessage(err, "Impossible de lister les rapports"));
    } finally {
      setExportsLoading(false);
    }
  };

  const onRequestExport = async () => {
    setExportsLoading(true);
    setExportsError("");
    try {
      const { report_id } = await requestExport(year);
      setExportsInfo(
        `Rapport n°${report_id} demandé pour ${year}. Sa génération prend généralement une à quelques minutes : actualisez ensuite la liste.`
      );
    } catch (err) {
      setExportsError(errorMessage(err, "Demande de rapport refusée"));
    } finally {
      setExportsLoading(false);
    }
  };

  const toggleReport = (reportId: number, checked: boolean) => {
    onSelectedReportsChange(
      checked ? [...selectedReports, reportId] : selectedReports.filter((id) => id !== reportId)
    );
  };

  return (
    <div className="sources-grid">
      <section className="source-box">
        <h3>Exports CSV Trading 212</h3>
        <p className="meta">
          App Trading 212 › Historique › Exporter. Pour un prix de revient (PMP) exact, importez{" "}
          <strong>toutes les années depuis l'ouverture du compte</strong> (un fichier par période d'un an maximum).
          Les fichiers sont traités localement par votre backend, rien n'est stocké.
        </p>
        <label className="file-picker">
          <input type="file" accept=".csv,text/csv" multiple onChange={(event) => void onPickFiles(event)} />
          Ajouter des fichiers CSV
        </label>
        {fileError && <p className="error">{fileError}</p>}
        {files.length > 0 && (
          <ul className="file-list">
            {files.map((file) => (
              <li key={`${file.name}:${file.size}`}>
                <span>
                  {file.name} <small>({Math.ceil(file.size / 1024)} Ko)</small>
                </span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => onFilesChange(files.filter((item) => item !== file))}
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="source-box">
        <h3>Rapports générés via l'API</h3>
        <p className="meta">
          Demande à Trading 212 un export CSV de l'année {year} (nécessite la permission « historique » sur la clé
          API). Cochez ensuite les rapports prêts à inclure dans le calcul.
        </p>
        <div className="form-actions">
          <button type="button" className="secondary" disabled={exportsLoading} onClick={() => void onRequestExport()}>
            Demander le rapport {year}
          </button>
          <button type="button" className="secondary" disabled={exportsLoading} onClick={() => void refreshReports()}>
            Actualiser la liste
          </button>
        </div>
        {exportsInfo && <p className="meta">{exportsInfo}</p>}
        {exportsError && <p className="error">{exportsError}</p>}
        {reports.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>N°</th>
                  <th>Période</th>
                  <th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.reportId}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Inclure le rapport ${report.reportId}`}
                        disabled={report.status !== "Finished"}
                        checked={selectedReports.includes(report.reportId)}
                        onChange={(event) => toggleReport(report.reportId, event.target.checked)}
                      />
                    </td>
                    <td>{report.reportId}</td>
                    <td>
                      {formatDate(report.timeFrom)} → {formatDate(report.timeTo)}
                    </td>
                    <td>{STATUS_LABELS[report.status] ?? report.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default TaxSources;
