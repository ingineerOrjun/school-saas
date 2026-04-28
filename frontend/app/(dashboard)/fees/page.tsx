"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Wallet,
  Plus,
  RotateCw,
  AlertTriangle,
  Settings,
  Users,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { feesApi, type DuesRow } from "@/lib/fees";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManageStructuresDialog } from "@/components/fees/ManageStructuresDialog";
import { AssignFeeDialog } from "@/components/fees/AssignFeeDialog";
import { RecordPaymentDialog } from "@/components/fees/RecordPaymentDialog";

export default function FeesPage() {
  const router = useRouter();
  const [dues, setDues] = React.useState<DuesRow[] | null>(null);
  const [structureCount, setStructureCount] = React.useState<number | null>(
    null,
  );
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [manageOpen, setManageOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [payTarget, setPayTarget] = React.useState<{ id: string; name: string } | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, structs] = await Promise.all([
        feesApi.getDues(),
        feesApi.listStructures(),
      ]);
      setDues(rows);
      setStructureCount(structs.length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Failed to load dues.");
      setDues([]);
      setStructureCount(0);
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const stats = React.useMemo(() => {
    if (!dues)
      return { totalDue: 0, totalDiscount: 0, studentsDue: 0, overdue: 0 };
    return dues.reduce(
      (acc, r) => ({
        totalDue: acc.totalDue + r.totalDue,
        totalDiscount: acc.totalDiscount + r.totalDiscount,
        studentsDue: acc.studentsDue + 1,
        overdue: acc.overdue + (r.overdue ? 1 : 0),
      }),
      { totalDue: 0, totalDiscount: 0, studentsDue: 0, overdue: 0 },
    );
  }, [dues]);

  const noStructures = !loading && structureCount === 0;
  const noDues = !loading && !error && (dues?.length ?? 0) === 0;

  return (
    <div className="space-y-6">
      <Header
        onManage={() => setManageOpen(true)}
        onAssign={() => setAssignOpen(true)}
        onRefresh={refresh}
        canAssign={!noStructures}
      />

      {loading ? (
        <DashboardSkeleton />
      ) : error ? (
        <ErrorBanner message={error} onRetry={refresh} />
      ) : noStructures ? (
        <div className="glass rounded-xl">
          <EmptyState
            icon={<Wallet className="h-10 w-10" strokeWidth={1.5} />}
            title="Create a fee structure first"
            description="Define the fees your school charges (e.g. Monthly Tuition, Exam Fee), then assign them to students."
            action={{
              label: "Manage fee types",
              icon: <Plus className="h-4 w-4" />,
              onClick: () => setManageOpen(true),
            }}
          />
        </div>
      ) : (
        <>
          <StatsRow
            totalDue={stats.totalDue}
            totalDiscount={stats.totalDiscount}
            studentsDue={stats.studentsDue}
            overdue={stats.overdue}
          />

          {noDues ? (
            <div className="glass rounded-xl">
              <EmptyState
                icon={<Wallet className="h-10 w-10" strokeWidth={1.5} />}
                title="Nothing owed"
                description="All assigned fees are fully paid. Nice work."
                action={{
                  label: "Assign a fee",
                  icon: <Plus className="h-4 w-4" />,
                  onClick: () => setAssignOpen(true),
                }}
              />
            </div>
          ) : (
            <DuesTable dues={dues!} onPay={setPayTarget} />
          )}
        </>
      )}

      <ManageStructuresDialog
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={refresh}
      />
      <AssignFeeDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onAssigned={refresh}
      />
      <RecordPaymentDialog
        student={payTarget}
        onClose={() => setPayTarget(null)}
        onRecorded={refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Header({
  onManage,
  onAssign,
  onRefresh,
  canAssign,
}: {
  onManage: () => void;
  onAssign: () => void;
  onRefresh: () => void;
  canAssign: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Fees
        </h1>
        <p className="text-sm text-muted-foreground">
          Track what&apos;s owed, record payments, and keep dues under control.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={onManage}
          leftIcon={<Settings className="h-4 w-4" />}
        >
          Fee types
        </Button>
        <Button
          onClick={onAssign}
          disabled={!canAssign}
          leftIcon={<Plus className="h-4 w-4" />}
          className="shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-px transition-all"
        >
          Assign fee
        </Button>
      </div>
    </div>
  );
}

function StatsRow({
  totalDue,
  totalDiscount,
  studentsDue,
  overdue,
}: {
  totalDue: number;
  totalDiscount: number;
  studentsDue: number;
  overdue: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 animate-fade-in-up">
      <StatCard
        label="Total outstanding"
        value={formatMoney(totalDue)}
        tone="primary"
        icon={<Wallet className="h-5 w-5" />}
        hint={
          totalDiscount > 0
            ? `After ${formatMoney(totalDiscount)} in scholarships`
            : undefined
        }
      />
      <StatCard
        label="Students with dues"
        value={studentsDue.toString()}
        tone="muted"
        icon={<Users className="h-5 w-5" />}
      />
      <StatCard
        label="Overdue"
        value={overdue.toString()}
        tone={overdue > 0 ? "destructive" : "muted"}
        icon={<AlertTriangle className="h-5 w-5" />}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon,
  hint,
}: {
  label: string;
  value: string;
  tone: "primary" | "muted" | "destructive";
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        "glass rounded-xl p-5",
        "transition-shadow hover:shadow-sm",
        tone === "destructive" && "border-destructive/30 bg-destructive/[0.04]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            tone === "primary" && "bg-primary/10 text-primary",
            tone === "muted" && "bg-muted text-muted-foreground",
            tone === "destructive" && "bg-destructive/10 text-destructive",
          )}
        >
          {icon}
        </div>
      </div>
      <p
        className={cn(
          "mt-4 text-3xl font-semibold tracking-tight tabular-nums",
          tone === "destructive" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
          {hint}
        </p>
      )}
    </div>
  );
}

function DuesTable({
  dues,
  onPay,
}: {
  dues: DuesRow[];
  onPay: (target: { id: string; name: string }) => void;
}) {
  return (
    <div className="glass rounded-xl overflow-hidden animate-fade-in-up">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-muted/30">
              <Th className="rounded-tl-xl">Student</Th>
              <Th>Class · Section</Th>
              <Th className="text-right">Assigned</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Final due</Th>
              <Th>Status</Th>
              <Th className="text-right rounded-tr-xl">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {dues.map((r, idx) => {
              const isLast = idx === dues.length - 1;
              const isPartial = r.totalPaid > 0 && r.totalDue > 0;
              return (
                <tr
                  key={r.studentId}
                  className={cn(
                    "transition-colors",
                    r.overdue
                      ? "hover:bg-destructive/5"
                      : "hover:bg-primary/5",
                  )}
                >
                  <Td
                    className={cn(
                      "border-t border-border/50",
                      isLast && "rounded-bl-xl",
                    )}
                  >
                    <Link
                      href={`/fees/${r.studentId}`}
                      className="flex flex-col leading-tight hover:text-primary transition-colors"
                    >
                      <span className="font-medium text-foreground">
                        {r.firstName} {r.lastName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.symbolNumber ? `#${r.symbolNumber}` : "—"}
                        {r.totalCredit > 0 && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            + {formatMoney(r.totalCredit)} credit
                          </span>
                        )}
                      </span>
                    </Link>
                  </Td>
                  <Td className="border-t border-border/50 text-muted-foreground">
                    {r.className
                      ? `${r.className} · ${r.sectionName}`
                      : "Unassigned"}
                  </Td>
                  <Td className="border-t border-border/50 text-right tabular-nums text-muted-foreground">
                    <div className="flex flex-col items-end leading-tight">
                      <span
                        className={cn(
                          r.totalDiscount > 0 &&
                            "line-through decoration-muted-foreground/60 text-muted-foreground/70",
                        )}
                      >
                        {formatMoney(r.totalBase)}
                      </span>
                      {r.totalDiscount > 0 && (
                        <span className="text-[11px] font-medium text-success">
                          − {formatMoney(r.totalDiscount)} discount
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="border-t border-border/50 text-right tabular-nums text-muted-foreground">
                    {formatMoney(r.totalPaid)}
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-right tabular-nums font-semibold",
                      r.overdue
                        ? "text-destructive"
                        : r.totalDue === 0
                          ? "text-success"
                          : "text-foreground",
                    )}
                  >
                    <div className="flex flex-col items-end leading-tight">
                      <span>{formatMoney(r.totalDue)}</span>
                      {r.totalDiscount > 0 && (
                        <span className="text-[11px] font-normal text-muted-foreground">
                          Original {formatMoney(r.totalBase)} · Discount{" "}
                          {formatMoney(r.totalDiscount)}
                        </span>
                      )}
                      {r.totalDue === 0 && r.totalCredit > 0 && (
                        <span className="text-[11px] font-normal text-primary">
                          + {formatMoney(r.totalCredit)} credit available
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="border-t border-border/50">
                    <StatusPill
                      overdue={r.overdue}
                      partial={isPartial}
                      oldestDueDate={r.oldestDueDate}
                    />
                  </Td>
                  <Td
                    className={cn(
                      "border-t border-border/50 text-right",
                      isLast && "rounded-br-xl",
                    )}
                  >
                    <Button
                      size="sm"
                      onClick={() =>
                        onPay({
                          id: r.studentId,
                          name: `${r.firstName} ${r.lastName}`,
                        })
                      }
                    >
                      Record payment
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({
  overdue,
  partial,
  oldestDueDate,
}: {
  overdue: boolean;
  partial: boolean;
  oldestDueDate: string | null;
}) {
  if (overdue) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
        Overdue
        {oldestDueDate && (
          <span className="opacity-75 tabular-nums">· since {oldestDueDate}</span>
        )}
      </span>
    );
  }
  if (partial) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700">
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/70 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Unpaid
    </span>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={cn(
        "h-11 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <td className={cn("px-4 py-3 align-middle", className)}>{children}</td>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass rounded-xl p-5 space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
          </div>
        ))}
      </div>
      <div className="glass rounded-xl p-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="glass rounded-xl p-6 flex items-start gap-4 border-destructive/20">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <h3 className="text-md font-semibold tracking-tight text-foreground">
          Couldn&apos;t load dues
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
          className="mt-4"
        >
          Try again
        </Button>
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}
