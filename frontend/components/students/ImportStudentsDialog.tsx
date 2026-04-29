"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
  X as XIcon,
} from "lucide-react";
import { ApiError } from "@/lib/api";
import {
  studentsApi,
  type BulkStudentInput,
  type Gender,
} from "@/lib/students";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export interface ImportStudentsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful import — parent should refresh the list. */
  onImported: (result: { success: number; failed: number }) => void;
}

/**
 * One row as parsed from the spreadsheet, plus per-row validation
 * results. We keep the raw cells so the user can SEE what was uploaded
 * (helpful for debugging when something looks wrong).
 */
interface ParsedRow {
  rowIndex: number; // 0-based, matches the array we'll send to the API
  raw: Record<string, unknown>;
  // Normalized values (post-trim, post-date-coerce). Present only when
  // the row passes client-side validation; otherwise the row is rendered
  // from `raw` and `errors` carries the reason(s).
  normalized?: BulkStudentInput;
  errors: string[];
  // Server-side outcome after submit (set when the API responds).
  serverError?: string;
  imported?: boolean;
}

const REQUIRED_HEADERS = [
  "Name",
  "SymbolNumber",
  "Gender",
  "DOB",
  "ParentName",
  "ContactNumber",
  "Class",
] as const;

const OPTIONAL_HEADERS = ["Address", "AdmissionDate"] as const;

export function ImportStudentsDialog({
  open,
  onClose,
  onImported,
}: ImportStudentsDialogProps) {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ParsedRow[]>([]);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Count of rows the server skipped because their symbolNumber already
  // exists in this school. Surfaced as a banner so re-imports are
  // explicit instead of silently producing "0 imported".
  const [skippedExisting, setSkippedExisting] = React.useState(0);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Reset state when the dialog opens.
  React.useEffect(() => {
    if (open) {
      setFileName(null);
      setRows([]);
      setParseError(null);
      setSubmitting(false);
      setSkippedExisting(0);
    }
  }, [open]);

  const validRows = React.useMemo(
    () => rows.filter((r) => r.errors.length === 0 && !r.serverError),
    [rows],
  );

  const handlePickFile = () => fileInputRef.current?.click();

  /**
   * Generate a .xlsx template with the exact header row the server
   * expects, plus one fully-filled example row so first-time users see
   * what each column should look like (especially the date format and
   * the 10-digit phone).
   */
  const handleDownloadSample = () => {
    const headers: (typeof REQUIRED_HEADERS)[number][] | string[] = [
      ...REQUIRED_HEADERS,
      ...OPTIONAL_HEADERS,
    ];
    const example = {
      Name: "Aarav Sharma",
      SymbolNumber: "1001",
      Gender: "MALE",
      DOB: "2010-05-12",
      ParentName: "Ram Sharma",
      ContactNumber: "9876543210",
      Class: "Grade 5",
      Address: "Ward 5, Lalitpur",
      AdmissionDate: "2026-04-01",
    };

    // Build the sheet header-first so column order matches the spec
    // exactly (Excel sometimes reorders by alphabetical when given an
    // object — pinning `header` prevents that).
    const sheet = XLSX.utils.json_to_sheet([example], { header: headers });
    // Sensible default column widths so the example is readable as soon
    // as the file opens.
    sheet["!cols"] = headers.map((h) => ({
      wch: Math.max(12, h.length + 2),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Students");
    XLSX.writeFile(wb, "scholaris-students-template.xlsx");
    toast.success("Template downloaded.");
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-picking the same file
    setFileName(file.name);
    setParseError(null);
    try {
      const buf = await file.arrayBuffer();
      // `cellDates: true` makes XLSX coerce Excel date serials to JS
      // Date objects automatically — handles the spreadsheet date
      // serial gotcha without us doing the math.
      const wb = XLSX.read(buf, { cellDates: true });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) {
        setParseError("The file has no sheets.");
        setRows([]);
        return;
      }
      const sheet = wb.Sheets[sheetName];
      // `defval: ""` means missing cells render as "" instead of being
      // dropped. `raw: false` formats cells via SSF (we still get the
      // raw Date for date columns thanks to cellDates).
      const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        sheet,
        { defval: "", raw: true },
      );
      const parsed = records.map((row, idx) => validateRow(row, idx));
      setRows(parsed);
      if (parsed.length === 0) {
        setParseError("The first sheet is empty.");
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Failed to parse file: ${err.message}`
          : "Failed to parse file.",
      );
      setRows([]);
    }
  };

  const handleImport = async () => {
    if (validRows.length === 0) return;
    setSubmitting(true);
    try {
      const result = await studentsApi.bulkCreate(
        validRows.map((r) => r.normalized!),
      );
      // Map server-side failures back onto our rows. The server gets a
      // contiguous array of valid rows, so its rowIndex is the position
      // in that filtered list — translate it back to our parent index.
      const validIdxs = validRows.map((r) => r.rowIndex);
      setRows((prev) => {
        const next = [...prev];
        for (const f of result.failed) {
          const parentIdx = validIdxs[f.rowIndex];
          if (parentIdx !== undefined) {
            next[parentIdx] = { ...next[parentIdx], serverError: f.reason };
          }
        }
        // Mark survivors as imported so the UI shows them as ✓.
        const failedSet = new Set(result.failed.map((f) => f.rowIndex));
        validRows.forEach((r, idxInValid) => {
          if (!failedSet.has(idxInValid)) {
            next[r.rowIndex] = { ...next[r.rowIndex], imported: true };
          }
        });
        return next;
      });
      // Count duplicates separately so we can surface them in a
      // tailored banner — re-imports are common and "Y failed" alone
      // doesn't tell the user WHY (validation? duplicates? class?).
      const existingDupes = result.failed.filter((f) =>
        /already exists/i.test(f.reason),
      ).length;
      setSkippedExisting(existingDupes);

      const otherFailures = result.failed.length - existingDupes;
      const parts: string[] = [];
      if (result.successCount > 0) {
        parts.push(
          `Imported ${result.successCount} ${result.successCount === 1 ? "student" : "students"}.`,
        );
      }
      if (existingDupes > 0) {
        parts.push(
          `${existingDupes} skipped (already exist).`,
        );
      }
      if (otherFailures > 0) {
        parts.push(
          `${otherFailures} ${otherFailures === 1 ? "row" : "rows"} failed.`,
        );
      }
      const msg = parts.length > 0 ? parts.join(" ") : "No rows were imported.";
      if (result.successCount > 0) {
        toast.success(msg);
      } else {
        toast.message(msg);
      }

      onImported({
        success: result.successCount,
        failed: result.failed.length,
      });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Bulk import failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const totalCount = rows.length;
  const invalidCount = rows.filter((r) => r.errors.length > 0).length;
  const importedCount = rows.filter((r) => r.imported).length;
  const failedCount = rows.filter((r) => r.serverError).length;

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Import students"
      description="Upload a .xlsx or .csv file. The first sheet will be used. Rows with errors are skipped — only valid rows are imported."
      size="xl"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
            type="button"
          >
            Cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={validRows.length === 0 || submitting}
            loading={submitting}
            type="button"
          >
            Import {validRows.length} valid{" "}
            {validRows.length === 1 ? "row" : "rows"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* File picker */}
        <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handlePickFile}
              disabled={submitting}
              leftIcon={<Upload className="h-4 w-4" />}
            >
              Choose file
            </Button>
            {/* First-time users almost always succeed on attempt #1 if
                they start from the template — the column names + an
                example row resolve the most common formatting mistakes. */}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownloadSample}
              disabled={submitting}
              leftIcon={<Download className="h-4 w-4" />}
            >
              Download Sample File
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {fileName ? (
              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                <FileSpreadsheet className="h-4 w-4 text-primary" />
                <span className="font-medium">{fileName}</span>
                <span className="text-muted-foreground">
                  · {totalCount} {totalCount === 1 ? "row" : "rows"}
                </span>
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                .xlsx or .csv — first sheet only
              </span>
            )}
          </div>

          <div className="mt-3 text-[11px] text-muted-foreground">
            <p className="font-semibold uppercase tracking-wider">
              Required columns
            </p>
            <p className="mt-0.5 font-mono">
              {REQUIRED_HEADERS.join(" · ")}
            </p>
            <p className="mt-2 font-semibold uppercase tracking-wider">
              Optional
            </p>
            <p className="mt-0.5 font-mono">
              {OPTIONAL_HEADERS.join(" · ")}
            </p>
          </div>
        </div>

        {/* Parse error */}
        {parseError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Duplicate-skip banner — shown after submit when one or more
            rows were rejected because their symbolNumber already exists
            in the school. Stays visible alongside the per-row errors so
            the user can match the count to specific rows. */}
        {skippedExisting > 0 && (
          <div className="rounded-md border border-amber-300/50 bg-amber-50 p-3 text-sm text-amber-900 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>
              <strong className="font-semibold">
                {skippedExisting}{" "}
                {skippedExisting === 1 ? "student was" : "students were"} skipped
              </strong>{" "}
              because they already exist in this school. Look for{" "}
              <em>&quot;already exists&quot;</em> in the Issues column to spot
              the rows.
            </span>
          </div>
        )}

        {/* Stats strip */}
        {totalCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Stat
              label="Total"
              value={totalCount}
              tone="muted"
            />
            <Stat
              label="Valid"
              value={validRows.length}
              tone="success"
            />
            {invalidCount > 0 && (
              <Stat
                label="Invalid"
                value={invalidCount}
                tone="danger"
              />
            )}
            {importedCount > 0 && (
              <Stat
                label="Imported"
                value={importedCount}
                tone="success"
              />
            )}
            {failedCount > 0 && (
              <Stat
                label="Server failed"
                value={failedCount}
                tone="danger"
              />
            )}
          </div>
        )}

        {/* Preview table */}
        {rows.length > 0 && (
          <div className="rounded-lg border border-border overflow-auto max-h-[60vh]">
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 bg-muted z-10">
                <tr>
                  <Th>#</Th>
                  <Th>Status</Th>
                  <Th>Name</Th>
                  <Th>Symbol</Th>
                  <Th>Gender</Th>
                  <Th>DOB</Th>
                  <Th>Parent</Th>
                  <Th>Contact</Th>
                  <Th>Class</Th>
                  <Th>Issues</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <RowView key={row.rowIndex} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Row view
// ---------------------------------------------------------------------------

function RowView({ row }: { row: ParsedRow }) {
  const hasClientError = row.errors.length > 0;
  const hasServerError = !!row.serverError;
  const isImported = row.imported;
  const cellTone = hasClientError || hasServerError
    ? "bg-destructive/[0.04]"
    : isImported
      ? "bg-success/[0.04]"
      : "";
  const r = row.raw;
  return (
    <tr className={cn("border-b border-border/50", cellTone)}>
      <Td className="text-muted-foreground tabular-nums">{row.rowIndex + 1}</Td>
      <Td>
        {isImported ? (
          <span className="inline-flex items-center gap-1 text-success font-semibold">
            <CheckCircle2 className="h-3 w-3" />
            Imported
          </span>
        ) : hasServerError ? (
          <span className="inline-flex items-center gap-1 text-destructive font-semibold">
            <XIcon className="h-3 w-3" />
            Server error
          </span>
        ) : hasClientError ? (
          <span className="inline-flex items-center gap-1 text-destructive font-semibold">
            <AlertCircle className="h-3 w-3" />
            Invalid
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-success">
            <CheckCircle2 className="h-3 w-3" />
            Valid
          </span>
        )}
      </Td>
      <Td className="font-medium">{String(r["Name"] ?? "")}</Td>
      <Td className="font-mono">{String(r["SymbolNumber"] ?? "")}</Td>
      <Td>{String(r["Gender"] ?? "")}</Td>
      <Td className="font-mono">{formatPreviewDate(r["DOB"])}</Td>
      <Td>{String(r["ParentName"] ?? "")}</Td>
      <Td className="font-mono">{String(r["ContactNumber"] ?? "")}</Td>
      <Td>{String(r["Class"] ?? "")}</Td>
      <Td className="text-destructive max-w-[280px]">
        {row.serverError ?? row.errors.join(" · ") ?? ""}
      </Td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2.5 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("px-2.5 py-1.5 align-top whitespace-nowrap", className)}>
      {children}
    </td>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "muted" | "success" | "danger";
}) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    success: "bg-success/10 text-success",
    danger: "bg-destructive/10 text-destructive",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 rounded-md px-2 py-0.5 text-xs",
        tones[tone],
      )}
    >
      <span className="text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CONTACT_RE = /^[0-9]{10}$/;

/**
 * Validate one parsed row against the same rules the backend enforces.
 * Returning `normalized` only when ALL checks pass keeps the import path
 * cheap — invalid rows are flagged in the preview and never sent to
 * the server.
 */
function validateRow(
  raw: Record<string, unknown>,
  rowIndex: number,
): ParsedRow {
  const errors: string[] = [];
  const get = (key: string) => {
    const v = raw[key];
    if (v === null || v === undefined) return "";
    if (v instanceof Date) return v;
    return String(v).trim();
  };

  // Name → split into first + last on first whitespace.
  const nameRaw = String(get("Name") || "");
  const nameParts = nameRaw.split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");
  if (!firstName || !lastName) {
    errors.push("Name must include first and last name");
  }

  // Gender enum
  const genderRaw = String(get("Gender") || "").toUpperCase();
  let gender: Gender | null = null;
  if (genderRaw === "MALE" || genderRaw === "M") gender = "MALE";
  else if (genderRaw === "FEMALE" || genderRaw === "F") gender = "FEMALE";
  else if (genderRaw === "OTHER" || genderRaw === "O") gender = "OTHER";
  else errors.push("Gender must be MALE, FEMALE, or OTHER");

  // Date of birth — accepts a JS Date (Excel) or ISO/parseable string.
  const dobRaw = get("DOB");
  let dob: string | null = null;
  if (dobRaw instanceof Date && !Number.isNaN(dobRaw.getTime())) {
    dob = toIsoDate(dobRaw);
  } else if (typeof dobRaw === "string" && dobRaw) {
    const d = new Date(dobRaw);
    if (!Number.isNaN(d.getTime())) dob = toIsoDate(d);
    else errors.push("DOB is not a valid date");
  } else {
    errors.push("DOB is required");
  }

  // Parent name
  const parentName = String(get("ParentName") || "");
  if (!parentName) errors.push("ParentName is required");

  // Contact number — strip non-digits FIRST, then check the regex.
  const contactRaw = String(get("ContactNumber") || "");
  const contactDigits = contactRaw.replace(/\D/g, "");
  if (!CONTACT_RE.test(contactDigits)) {
    errors.push("ContactNumber must be 10 digits");
  }

  // Class is required by the spec — kept as a free-form name; backend
  // resolves to classId.
  const className = String(get("Class") || "");
  if (!className) errors.push("Class is required");

  // SymbolNumber — required per spec
  const symbolRaw = String(get("SymbolNumber") || "");
  if (!symbolRaw) errors.push("SymbolNumber is required");

  // Optional fields
  const address = String(get("Address") || "");
  let admissionDate: string | null = null;
  const admRaw = get("AdmissionDate");
  if (admRaw) {
    if (admRaw instanceof Date && !Number.isNaN(admRaw.getTime())) {
      admissionDate = toIsoDate(admRaw);
    } else if (typeof admRaw === "string") {
      const d = new Date(admRaw);
      if (!Number.isNaN(d.getTime())) admissionDate = toIsoDate(d);
      else errors.push("AdmissionDate is not a valid date");
    }
  }

  if (errors.length > 0) {
    return { rowIndex, raw, errors };
  }

  return {
    rowIndex,
    raw,
    errors: [],
    normalized: {
      firstName,
      lastName,
      symbolNumber: symbolRaw,
      gender: gender as Gender,
      dateOfBirth: dob as string,
      parentName,
      contactNumber: contactDigits,
      address: address || null,
      admissionDate,
      className,
    },
  };
}

function toIsoDate(d: Date): string {
  // Use local components so an Excel cell typed "2010-05-12" doesn't
  // shift to "2010-05-11" in negative-UTC zones.
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatPreviewDate(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return toIsoDate(v);
  return String(v ?? "");
}
