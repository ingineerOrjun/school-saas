"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, Percent, Banknote } from "lucide-react";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import {
  feesApi,
  todayISO,
  type DiscountType,
  type FeeStructureDto,
} from "@/lib/fees";
import { studentsApi, type StudentDto } from "@/lib/students";
import { classesApi, type ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export interface AssignFeeDialogProps {
  open: boolean;
  onClose: () => void;
  onAssigned?: () => void;
}

/** "Any class" sentinel — lets users pick a school-wide fee + any student. */
const CLASS_ANY = "__any__";

export function AssignFeeDialog({
  open,
  onClose,
  onAssigned,
}: AssignFeeDialogProps) {
  const [structures, setStructures] = React.useState<FeeStructureDto[]>([]);
  const [students, setStudents] = React.useState<StudentDto[]>([]);
  const [classes, setClasses] = React.useState<ClassWithSections[]>([]);
  const [classScope, setClassScope] = React.useState<string>(CLASS_ANY);
  const [feeStructureId, setFeeStructureId] = React.useState<string>("");
  const [dueDate, setDueDate] = React.useState<string>("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [query, setQuery] = React.useState("");

  // Optional scholarship controls.
  const [discountEnabled, setDiscountEnabled] = React.useState(false);
  const [discountType, setDiscountType] =
    React.useState<DiscountType>("PERCENT");
  const [discountValue, setDiscountValue] = React.useState<string>("");

  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setClassScope(CLASS_ANY);
    setFeeStructureId("");
    setDueDate(todayISO());
    setSelected(new Set());
    setQuery("");
    setDiscountEnabled(false);
    setDiscountType("PERCENT");
    setDiscountValue("");
    (async () => {
      try {
        const [s, st, c] = await Promise.all([
          feesApi.listStructures(),
          studentsApi.list(),
          classesApi.list(),
        ]);
        setStructures(s);
        setStudents(st);
        setClasses(c);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : "Failed to load.");
      }
    })();
  }, [open]);

  // Fee structures that apply to the current class scope — either
  // school-wide (classId === null) OR scoped to the selected class.
  const availableStructures = React.useMemo(() => {
    if (classScope === CLASS_ANY) {
      // "Any class" mode: only school-wide fees are safe to pick,
      // because a class-scoped fee would reject any student outside
      // that class on the backend.
      return structures.filter((s) => s.classId === null);
    }
    return structures.filter(
      (s) => s.classId === null || s.classId === classScope,
    );
  }, [structures, classScope]);

  // Students list filters by class when a specific class is chosen.
  const studentsInScope = React.useMemo(() => {
    if (classScope === CLASS_ANY) return students;
    return students.filter((s) => s.classId === classScope);
  }, [students, classScope]);

  const filteredStudents = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return studentsInScope;
    return studentsInScope.filter((s) =>
      `${s.firstName} ${s.lastName} ${s.symbolNumber ?? ""}`
        .toLowerCase()
        .includes(q),
    );
  }, [studentsInScope, query]);

  // Reset fee/student selection whenever the class scope changes — the
  // previously-picked fee might not apply to the new class, and the
  // selected students may not be in it either.
  const handleClassScopeChange = (value: string) => {
    setClassScope(value);
    setFeeStructureId("");
    setSelected(new Set());
  };

  const selectedStructure = availableStructures.find(
    (s) => s.id === feeStructureId,
  );

  // Live preview of the final amount once a fee + discount are chosen.
  const preview = React.useMemo(() => {
    if (!selectedStructure) return null;
    const base = selectedStructure.amount;
    const rawValue = Number(discountValue);
    const value =
      discountEnabled && Number.isFinite(rawValue) && rawValue >= 0
        ? rawValue
        : 0;
    const deducted =
      discountType === "PERCENT"
        ? base * (Math.min(100, value) / 100)
        : value;
    const finalAmount = Math.max(0, base - deducted);
    return {
      base,
      finalAmount,
      discount: Math.max(0, base - finalAmount),
    };
  }, [selectedStructure, discountEnabled, discountType, discountValue]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () =>
    setSelected(new Set(filteredStudents.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());

  const handleSubmit = async () => {
    if (!feeStructureId || !dueDate || selected.size === 0) {
      toast.error("Pick a fee, students, and due date.");
      return;
    }
    // Validate discount inputs only if the optional control is toggled on.
    let discountPayload: {
      discountType?: DiscountType;
      discountValue?: number;
    } = {};
    if (discountEnabled) {
      const v = Number(discountValue);
      if (!Number.isFinite(v) || v < 0) {
        toast.error("Discount value must be a non-negative number.");
        return;
      }
      if (discountType === "PERCENT" && v > 100) {
        toast.error("Percent discount can't exceed 100.");
        return;
      }
      discountPayload = { discountType, discountValue: v };
    }

    setSubmitting(true);
    try {
      const res = await feesApi.assign({
        feeStructureId,
        studentIds: [...selected],
        dueDate,
        ...discountPayload,
      });
      toast.success(
        `Assigned to ${res.created} student${res.created === 1 ? "" : "s"}`,
      );
      onAssigned?.();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to assign fee.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title="Assign fee"
      description="Pick a class and a fee type, then select students to charge. Optionally apply a scholarship discount."
      size="lg"
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
          <Button onClick={handleSubmit} loading={submitting} type="button">
            Assign ({selected.size})
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Step 1: class scope */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            1. Class
          </label>
          <select
            value={classScope}
            onChange={(e) => handleClassScopeChange(e.target.value)}
            disabled={submitting || classes.length === 0}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
          >
            <option value={CLASS_ANY}>Any class (school-wide)</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {classScope === CLASS_ANY
              ? "Only school-wide fees and all students are shown."
              : "Class-specific fees and the students of this class are shown."}
          </p>
        </div>

        {/* Step 2: fee type + due date */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              2. Fee type
            </label>
            <select
              value={feeStructureId}
              onChange={(e) => setFeeStructureId(e.target.value)}
              disabled={submitting || availableStructures.length === 0}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary disabled:bg-muted disabled:cursor-not-allowed"
            >
              <option value="">
                {availableStructures.length === 0
                  ? "No matching fees — create one first"
                  : "Choose a fee…"}
              </option>
              {availableStructures.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {formatMoney(s.amount)}
                  {s.class ? ` (${s.class.name} only)` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              Due date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={submitting}
              className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
            />
          </div>
        </div>

        {/* Optional scholarship / discount */}
        <div className="rounded-lg border border-border/60 bg-surface/40 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={discountEnabled}
              onChange={(e) => setDiscountEnabled(e.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary/25"
            />
            Apply scholarship / discount
          </label>

          {discountEnabled && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr]">
              <div className="inline-flex rounded-md border border-border bg-surface text-sm overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDiscountType("PERCENT")}
                  disabled={submitting}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-2 font-medium transition-colors",
                    discountType === "PERCENT"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Percent className="h-3.5 w-3.5" />
                  Percent
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType("FIXED")}
                  disabled={submitting}
                  className={cn(
                    "inline-flex items-center gap-1.5 px-3 py-2 font-medium transition-colors border-l border-border",
                    discountType === "FIXED"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {/* Banknote: currency-agnostic visual for "fixed
                      amount" — was previously a $-sign which misled
                      readers in an NPR-only app. */}
                  <Banknote className="h-3.5 w-3.5" />
                  Fixed
                </button>
              </div>
              <input
                type="number"
                min={0}
                max={discountType === "PERCENT" ? 100 : undefined}
                step={discountType === "PERCENT" ? 1 : 0.01}
                placeholder={
                  discountType === "PERCENT" ? "e.g. 25 (%)" : "e.g. 500"
                }
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                disabled={submitting}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
              />
            </div>
          )}

          {/* Live preview of base / discount / final — only shows once a
              fee is chosen so there's no dangling "NaN" noise from
              empty inputs. */}
          {preview && (
            <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <PreviewLine
                label="Base"
                value={formatMoney(preview.base)}
                tone="muted"
              />
              <PreviewLine
                label="Discount"
                value={`− ${formatMoney(preview.discount)}`}
                tone={preview.discount > 0 ? "success" : "muted"}
              />
              <PreviewLine
                label="Final per student"
                value={formatMoney(preview.finalAmount)}
                tone="foreground"
                strong
              />
            </div>
          )}
        </div>

        {/* Step 3: students */}
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-foreground">
              3. Students{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({selected.size} selected)
              </span>
            </label>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAll}
                className="text-primary hover:underline"
              >
                All
              </button>
              <span className="text-muted-foreground/50">·</span>
              <button
                type="button"
                onClick={selectNone}
                className="text-muted-foreground hover:text-foreground"
              >
                None
              </button>
            </div>
          </div>
          <input
            type="search"
            placeholder="Search by name or symbol number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mt-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          />
          <div className="mt-2 max-h-60 overflow-y-auto rounded-md border border-border/70">
            {filteredStudents.length === 0 ? (
              <p className="p-4 text-center text-sm italic text-muted-foreground">
                {classScope === CLASS_ANY
                  ? "No students match."
                  : "No students in this class yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {filteredStudents.map((s) => {
                  const isSelected = selected.has(s.id);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                          isSelected ? "bg-primary/5" : "hover:bg-muted/60",
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                              isSelected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border",
                            )}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3" strokeWidth={3} />
                            )}
                          </span>
                          <div>
                            <p className="font-medium text-foreground">
                              {s.firstName} {s.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {s.symbolNumber ? `#${s.symbolNumber}` : "—"}
                              {s.class
                                ? ` · ${s.class.name}${s.section ? ` ${s.section.name}` : ""}`
                                : s.section
                                  ? ` · ${s.section.class.name} ${s.section.name}`
                                  : ""}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PreviewLine({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone: "muted" | "success" | "destructive" | "foreground";
  strong?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : tone === "foreground"
          ? "text-foreground"
          : "text-muted-foreground";
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="uppercase tracking-wider text-[10px] font-semibold text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          strong ? "text-sm font-semibold" : "font-medium",
          toneClass,
        )}
      >
        {value}
      </span>
    </div>
  );
}

// Centralized via `lib/currency.formatCurrency`.
const formatMoney = formatCurrency;
