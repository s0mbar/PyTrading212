type Cell = string | number | null | undefined;

// Lets Excel detect UTF-8 (accents in names).
const UTF8_BOM = String.fromCharCode(0xfeff);

function escapeCell(value: Cell): string {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formulas and quote separators.
  const safe = /^[=+\-@]/.test(text) && Number.isNaN(Number(text)) ? `'${text}` : text;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Download rows as a semicolon-separated CSV (opens directly in a French Excel). */
export function downloadCsv(filename: string, header: string[], rows: Cell[][]): void {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(";"));
  const blob = new Blob([UTF8_BOM + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Format a number with a comma decimal separator for French spreadsheets. */
export function frenchDecimal(value: number): string {
  return String(value).replace(".", ",");
}
