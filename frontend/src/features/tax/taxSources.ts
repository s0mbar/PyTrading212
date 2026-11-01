import type { ExportReport } from "../../api/tax";

export type LoadedFile = {
  name: string;
  size: number;
  content: string;
  /** Calendar years found in the file's dates (Trading 212 "Time" column). */
  years: number[];
};

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const FIRST_YEAR = 2019;

/** Years present in a Trading 212 CSV export, read from its ISO dates. */
export function yearsInCsv(content: string): number[] {
  const years = new Set<number>();
  for (const match of content.matchAll(/(?:^|[,"])(20\d\d)-[01]\d-[0-3]\d/gm)) {
    years.add(Number(match[1]));
  }
  return [...years].sort();
}

export type YearCoverage = {
  year: number;
  report?: ExportReport;
  status: "ready" | "pending" | "failed" | "missing";
  fromCsv: boolean;
};

const PENDING = new Set(["Queued", "Processing", "Running"]);

function reportYear(report: ExportReport): number | null {
  return report.timeFrom ? new Date(report.timeFrom).getUTCFullYear() : null;
}

/** For each needed year: the best API report (finished first, newest first) and CSV coverage. */
export function coverage(years: number[], reports: ExportReport[], files: LoadedFile[]): YearCoverage[] {
  const csvYears = new Set(files.flatMap((file) => file.years));
  return years.map((year) => {
    const candidates = reports
      .filter((report) => reportYear(report) === year)
      .sort((a, b) => b.reportId - a.reportId);
    const finished = candidates.find((report) => report.status === "Finished");
    const pending = candidates.find((report) => PENDING.has(report.status));
    const report = finished ?? pending ?? candidates[0];
    const status: YearCoverage["status"] = finished
      ? "ready"
      : pending
        ? "pending"
        : report
          ? "failed"
          : "missing";
    return { year, report, status, fromCsv: csvYears.has(year) };
  });
}

export function yearRange(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}
