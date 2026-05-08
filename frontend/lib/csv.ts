// ---------------------------------------------------------------------------
// CSV download helpers — single source of truth.
//
// The Payment History page already has its own CSV exporter; that
// pre-dates this utility but the shape is identical (header row +
// quoted body rows + UTF-8 BOM for Excel-on-Windows). New callers
// (Analytics tabs) should import from here instead of duplicating.
//
// Why we ship the BOM: Excel for Windows defaults to whatever the
// system code page is unless it sees a UTF-8 BOM at the start of
// the file, in which case Devanagari names render correctly. The
// BOM is harmless on Mac / LibreOffice / Google Sheets / any modern
// CSV consumer — they just skip it.
// ---------------------------------------------------------------------------

/**
 * Trigger a CSV download from in-memory rows. `header` is the column
 * labels; `rows` is the data, in the same column order. Cells are
 * RFC 4180-quoted: any cell containing a comma, double-quote, or
 * newline gets wrapped in double quotes with internal quotes doubled.
 *
 * Numbers are rendered via `String()`, so locale formatting is the
 * caller's responsibility (we don't want commas in money figures
 * because they'd collide with the column delimiter).
 */
export function downloadCsv(input: {
  filename: string;
  header: string[];
  rows: Array<Array<string | number | null | undefined>>;
}): void {
  const lines = [input.header.map(csvCell).join(",")];
  for (const row of input.rows) {
    lines.push(row.map(csvCell).join(","));
  }
  // Prepend BOM so Windows Excel detects UTF-8 (otherwise Devanagari
  // names + currency symbols come out as mojibake).
  const body = "﻿" + lines.join("\r\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = input.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** RFC 4180-style CSV cell — quote when the value contains a delimiter. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Convenience: today's date in `YYYY-MM-DD` for embedding in default
 * download filenames.
 */
export function csvFilenameStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
