"use client";

import * as React from "react";
import { Loader2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";
import {
  feesApi,
  type FeeStructureDto,
  type FeeFrequency,
} from "@/lib/fees";
import { useClasses, type ClassWithSections } from "@/lib/classes";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

export interface ManageStructuresDialogProps {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

/** Sentinel value for the "school-wide" option in the class dropdown. */
const CLASS_ANY = "__any__";

export function ManageStructuresDialog({
  open,
  onClose,
  onChanged,
}: ManageStructuresDialogProps) {
  const [list, setList] = React.useState<FeeStructureDto[]>([]);
  // Phase Ω migration — classes now flow through the shared
  // useClasses() hook. Reopening the dialog re-uses the cache.
  const classesQuery = useClasses();
  const classes: ClassWithSections[] = classesQuery.data ?? [];
  const [loading, setLoading] = React.useState(false);
  const [name, setName] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [frequency, setFrequency] = React.useState<FeeFrequency>("MONTHLY");
  const [classScope, setClassScope] = React.useState<string>(CLASS_ANY);
  const [submitting, setSubmitting] = React.useState(false);

  const refresh = React.useCallback(async () => {
    // Phase Ω — classes come from the shared useClasses() hook
    // above. Only fee structures need an imperative refresh here.
    setLoading(true);
    try {
      const s = await feesApi.listStructures();
      setList(s);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load fees.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setName("");
      setAmount("");
      setFrequency("MONTHLY");
      setClassScope(CLASS_ANY);
      refresh();
    }
  }, [open, refresh]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    const a = Number(amount);
    if (!n || !Number.isFinite(a) || a < 0) {
      toast.error("Enter a name and non-negative amount.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await feesApi.createStructure({
        name: n,
        amount: a,
        frequency,
        classId: classScope === CLASS_ANY ? null : classScope,
      });
      setList((prev) => [created, ...prev]);
      setName("");
      setAmount("");
      setClassScope(CLASS_ANY);
      toast.success(`Added "${created.name}"`);
      onChanged?.();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to add fee.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage fee types"
      description="Define the recurring or one-time fees your school charges. Optionally scope a fee to a specific class (e.g. Grade 10 lab fee)."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose} type="button">
          Done
        </Button>
      }
    >
      <form
        onSubmit={handleCreate}
        className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_auto_auto]"
      >
        <Input
          label="Fee name"
          placeholder="e.g. Monthly tuition"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          maxLength={120}
        />
        <Input
          label="Amount"
          type="number"
          min={0}
          step={0.01}
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={submitting}
          leftIcon={<Wallet className="h-4 w-4" />}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Frequency
          </label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as FeeFrequency)}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value="MONTHLY">Monthly</option>
            <option value="ONE_TIME">One-time</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            loading={submitting}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            Add
          </Button>
        </div>

        {/* Second row: class scope spans the full width so the dropdown
            has room to show class names without truncation. */}
        <div className="sm:col-span-4 flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            Applies to
          </label>
          <select
            value={classScope}
            onChange={(e) => setClassScope(e.target.value)}
            disabled={submitting}
            className="h-10 rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary"
          >
            <option value={CLASS_ANY}>
              All classes (school-wide fee)
            </option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                Only {c.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Class-scoped fees can only be assigned to students in that class.
          </p>
        </div>
      </form>

      <div className="mt-5 border-t border-border/60 pt-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Existing fees
        </p>
        <div className="mt-2 space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : list.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No fees defined yet. Add one above.
            </p>
          ) : (
            list.map((f) => (
              <div
                key={f.id}
                className={cn(
                  "flex items-center justify-between rounded-md border border-border/60 bg-surface/80 px-3 py-2",
                )}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {f.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.frequency === "MONTHLY" ? "Monthly" : "One-time"}
                    {" · "}
                    {f.class ? `Only ${f.class.name}` : "All classes"}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-foreground shrink-0">
                  {formatMoney(f.amount)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

// Centralized via `lib/currency.formatCurrency`.
const formatMoney = formatCurrency;
