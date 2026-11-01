import { useMemo, useState } from "react";

import { errorMessage, UnauthorizedError } from "../../api/http";
import {
  computeTaxReport,
  fetchAccountInfo,
  type AccountInfo,
  type DividendBox,
  type ExportReport,
  type TaxReport,
} from "../../api/tax";
import { Stepper, type Step } from "../../ui/Stepper";
import StepOptions from "./StepOptions";
import StepResult from "./StepResult";
import StepSources from "./StepSources";
import StepYear from "./StepYear";
import { coverage, yearRange, type LoadedFile } from "./taxSources";

const currentYear = new Date().getFullYear();

export type TaxInputs = {
  year: number;
  firstYear: number;
  priorLosses: number;
  treatyRatePct: number;
};

/**
 * Guided IFU flow: 1. year, 2. data (API exports and/or CSV), 3. a few
 * questions, 4. result. Everything stays in memory: no financial data is
 * written to the browser storage.
 */
function TaxView() {
  const [step, setStep] = useState(0);
  const [inputs, setInputs] = useState<TaxInputs>({
    year: currentYear - 1,
    firstYear: currentYear - 1,
    priorLosses: 0,
    treatyRatePct: 15,
  });
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [reports, setReports] = useState<ExportReport[]>([]);
  const [overrides, setOverrides] = useState<Record<string, DividendBox>>({});
  const [report, setReport] = useState<TaxReport | null>(null);
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [computing, setComputing] = useState<number | null>(null); // start time while computing
  const [computeError, setComputeError] = useState("");

  const years = useMemo(() => yearRange(inputs.firstYear, inputs.year), [inputs.firstYear, inputs.year]);
  const yearCoverage = useMemo(() => coverage(years, reports, files), [years, reports, files]);
  const targetCovered = yearCoverage.some((item) => item.year === inputs.year && (item.status === "ready" || item.fromCsv));
  const selectedReports = yearCoverage
    .filter((item) => item.status === "ready" && item.report)
    .map((item) => item.report!.reportId);

  const steps: Step[] = [
    { id: "year", label: "Année", done: step > 0 },
    { id: "sources", label: "Données", done: targetCovered && step > 1 },
    { id: "options", label: "Précisions", done: step > 2 },
    { id: "result", label: "Résultat", done: report !== null },
  ];

  const go = (index: number) => {
    setStep(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const compute = async (categoryOverrides = overrides) => {
    setComputing(Date.now());
    setComputeError("");
    try {
      const result = await computeTaxReport({
        year: inputs.year,
        csv_files: files.map(({ name, content }) => ({ name, content })),
        report_ids: selectedReports,
        prior_capital_losses: Math.max(0, inputs.priorLosses || 0),
        default_treaty_rate: Math.min(50, Math.max(0, inputs.treatyRatePct || 0)) / 100,
        category_overrides: categoryOverrides,
      });
      setReport(result);
      // Account number for the 3916 form: asked once, only now (Trading 212 rate-limits this call).
      if (!accountInfo) {
        fetchAccountInfo()
          .then(setAccountInfo)
          .catch(() => undefined);
      }
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) {
        setComputeError(errorMessage(err, "Calcul impossible."));
      }
    } finally {
      setComputing(null);
    }
  };

  /** Results are reached through « Calculer », which launches the computation if needed. */
  const showResult = () => {
    go(3);
    if (!report) {
      void compute();
    }
  };
  const selectStep = (index: number) => (index === 3 ? showResult() : go(index));

  return (
    <div className="stack">
      <div className="no-print">
        <Stepper steps={steps} current={step} onSelect={selectStep} />
      </div>

      {step === 0 && (
        <StepYear
          inputs={inputs}
          onChange={(next) => {
            setInputs(next);
            setReport(null);
          }}
          onNext={() => go(1)}
        />
      )}
      {step === 1 && (
        <StepSources
          year={inputs.year}
          coverage={yearCoverage}
          files={files}
          onFilesChange={(next) => {
            setFiles(next);
            setReport(null);
          }}
          reports={reports}
          onReportsChange={setReports}
          canContinue={targetCovered}
          onBack={() => go(0)}
          onNext={() => go(2)}
        />
      )}
      {step === 2 && (
        <StepOptions
          inputs={inputs}
          onChange={(next) => {
            setInputs(next);
            setReport(null);
          }}
          onBack={() => go(1)}
          onNext={showResult}
        />
      )}
      {step === 3 && (
        <StepResult
          report={report}
          computingSince={computing}
          error={computeError}
          accountInfo={accountInfo}
          onRetry={() => void compute()}
          onOverrideChange={(instrumentKey, box) => {
            const next = { ...overrides, [instrumentKey]: box };
            setOverrides(next);
            void compute(next);
          }}
          onBack={() => go(2)}
        />
      )}
    </div>
  );
}

export default TaxView;
