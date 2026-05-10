"use client";

import * as React from "react";
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  MessageSquare,
  Printer,
  Search,
  Share2,
  Smartphone,
  Wallet,
  X,
} from "lucide-react";
import {
  feesApi,
  type CreatePaymentInput,
  type StudentFeesReport,
  type PaymentMethod,
} from "@/lib/fees";
import { studentsApi, type StudentDto } from "@/lib/students";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  NumericPad,
  StickyActionBar,
  TouchButton,
} from "./primitives";

// ---------------------------------------------------------------------------
// MobileFeeCollect — Phase 25 Sections 6, 7, 8, 13.
//
// Phone-shaped fee collection workflow. Three screens (one component):
//
//   1. Student select — search-driven typeahead + recents.
//   2. Amount + method — oversized input, on-screen numeric pad,
//                         method chips, balance preview, sticky charge button.
//   3. Success — giant ✓, receipt summary, one-tap print/share.
//
// Goals (Section 7):
//   • Cashier can process a payment in under 10 seconds.
//   • Numeric pad is always visible — no soft-keyboard layout shifts.
//   • Live balance preview prevents over-collection anxiety.
//   • Duplicate-payment protection via the existing clientRequestId.
//
// What this component does NOT cover (deliberately):
//   • Invoice generation (the existing report card on the desktop
//     /fees page handles per-assignment allocation). We charge a
//     general payment; the cashier can split allocations later on
//     the desktop view if needed.
//   • Refunds — admin-only, low-frequency, lives on the existing
//     desktop UI.
//
// Reuses:
//   • feesApi.recordPayment — same call as the desktop flow.
//   • studentsApi.list — same search; we hit it with `q`.
//   • clientRequestId protects against double-tap submits.
// ---------------------------------------------------------------------------

type Screen = "pick" | "amount" | "success";
type RecentStudent = {
  id: string;
  name: string;
  symbol?: string | null;
  ts: number;
};

const RECENTS_KEY = "scholaris:fees:recents";
const MAX_RECENTS = 6;
const METHODS: { value: PaymentMethod; label: string; icon: React.ReactNode }[] =
  [
    { value: "CASH", label: "Cash", icon: <Banknote className="h-4 w-4" /> },
    { value: "BANK", label: "Bank", icon: <CreditCard className="h-4 w-4" /> },
    { value: "ESEWA", label: "eSewa", icon: <Smartphone className="h-4 w-4" /> },
    { value: "OTHER", label: "Other", icon: <Wallet className="h-4 w-4" /> },
  ];

export function MobileFeeCollect() {
  const [screen, setScreen] = React.useState<Screen>("pick");
  const [student, setStudent] = React.useState<RecentStudent | null>(null);
  const [amount, setAmount] = React.useState("");
  const [method, setMethod] = React.useState<PaymentMethod>("CASH");
  // clientRequestId lifecycle: minted when entering the amount screen,
  // refreshed for each new charge attempt. Same key for retries on
  // submit (idempotent on the backend); new key after success.
  const [clientReqId, setClientReqId] = React.useState<string>(() =>
    crypto.randomUUID(),
  );
  const [lastPaymentId, setLastPaymentId] = React.useState<string | null>(null);

  // Student fees report — drives the "balance due" preview.
  const report = useQuery<StudentFeesReport, ApiError>({
    queryKey: ["fees", "student-report", student?.id],
    queryFn: () => feesApi.getStudentFees(student!.id),
    enabled: !!student,
    staleTime: 30_000,
  });

  // Charge mutation.
  const charge = useMutation({
    mutationFn: (input: CreatePaymentInput) => feesApi.recordPayment(input),
    onSuccess: (payment) => {
      setLastPaymentId(payment.id);
      pushRecent({
        id: student!.id,
        name: student!.name,
        symbol: student!.symbol,
        ts: Date.now(),
      });
      setScreen("success");
      // Mint a fresh idempotency key for the next payment.
      setClientReqId(crypto.randomUUID());
    },
  });

  const reset = () => {
    setScreen("pick");
    setStudent(null);
    setAmount("");
    setLastPaymentId(null);
  };

  if (screen === "pick") {
    return (
      <PickStudentScreen
        onSelect={(s) => {
          setStudent(s);
          setAmount("");
          setScreen("amount");
        }}
      />
    );
  }

  if (screen === "amount" && student) {
    return (
      <AmountScreen
        student={student}
        report={report.data ?? null}
        loadingReport={report.isLoading}
        amount={amount}
        method={method}
        onAmountChange={setAmount}
        onMethodChange={setMethod}
        onBack={() => setScreen("pick")}
        onCharge={() => {
          const value = Number(amount);
          if (!Number.isFinite(value) || value <= 0) return;
          charge.mutate({
            studentId: student.id,
            amount: value,
            date: new Date().toISOString().slice(0, 10),
            method,
            clientRequestId: clientReqId,
          });
        }}
        charging={charge.isPending}
        error={charge.error ? (charge.error as Error).message : null}
      />
    );
  }

  if (screen === "success" && student && lastPaymentId) {
    return (
      <SuccessScreen
        student={student}
        amount={Number(amount)}
        balanceAfter={
          report.data
            ? Math.max(0, report.data.totalDue - Number(amount))
            : null
        }
        paymentId={lastPaymentId}
        onAnother={reset}
      />
    );
  }
  return null;
}

// ===========================================================================
// Screen 1 — student picker
// ===========================================================================

function PickStudentScreen({
  onSelect,
}: {
  onSelect: (student: RecentStudent) => void;
}) {
  const [query, setQuery] = React.useState("");
  const recents = React.useMemo(() => readRecents(), []);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    // Autofocus on mount so the cashier just starts typing.
    inputRef.current?.focus();
  }, []);

  // Existing API: studentsApi.search(q) — purpose-built typeahead
  // optimized for the cashier workspace. Returns StudentDto[].
  const search = useQuery<StudentDto[], ApiError>({
    queryKey: ["students", "search", query],
    queryFn: () => studentsApi.search(query),
    enabled: query.trim().length >= 2,
    staleTime: 30_000,
  });

  const hits = search.data ?? [];

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, roll, or phone…"
          className="w-full h-12 pl-9 pr-3 rounded-lg border border-input bg-card text-sm"
          inputMode="search"
        />
      </div>

      {query.trim().length < 2 && recents.length > 0 && (
        <div>
          <p className="px-1 mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Recent
          </p>
          <ul className="space-y-1">
            {recents.map((r) => (
              <StudentRow
                key={r.id}
                primary={r.name}
                secondary={r.symbol ? `#${r.symbol}` : null}
                onTap={() => onSelect(r)}
              />
            ))}
          </ul>
        </div>
      )}

      {query.trim().length >= 2 && (
        <ul className="space-y-1">
          {search.isLoading && (
            <li className="text-center py-6 text-xs text-muted-foreground">
              <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
              Searching…
            </li>
          )}
          {!search.isLoading && hits.length === 0 && (
            <li className="text-center py-6 text-xs text-muted-foreground">
              No students match "{query}".
            </li>
          )}
          {hits.map((s) => (
            <StudentRow
              key={s.id}
              primary={`${s.firstName} ${s.lastName}`.trim()}
              secondary={[
                s.symbolNumber ? `#${s.symbolNumber}` : null,
                s.contactNumber ?? null,
              ]
                .filter(Boolean)
                .join(" · ") || null}
              onTap={() =>
                onSelect({
                  id: s.id,
                  name: `${s.firstName} ${s.lastName}`.trim(),
                  symbol: s.symbolNumber,
                  ts: Date.now(),
                })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function StudentRow({
  primary,
  secondary,
  onTap,
}: {
  primary: string;
  secondary: string | null;
  onTap: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        className="w-full min-h-[56px] flex items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-left hover:bg-muted/30 active:scale-[0.99] transition-all"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
          {primary
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">
            {primary}
          </p>
          {secondary && (
            <p className="text-[11px] text-muted-foreground truncate">
              {secondary}
            </p>
          )}
        </div>
      </button>
    </li>
  );
}

// ===========================================================================
// Screen 2 — amount + method
// ===========================================================================

function AmountScreen({
  student,
  report,
  loadingReport,
  amount,
  method,
  onAmountChange,
  onMethodChange,
  onBack,
  onCharge,
  charging,
  error,
}: {
  student: RecentStudent;
  report: StudentFeesReport | null;
  loadingReport: boolean;
  amount: string;
  method: PaymentMethod;
  onAmountChange: (v: string) => void;
  onMethodChange: (m: PaymentMethod) => void;
  onBack: () => void;
  onCharge: () => void;
  charging: boolean;
  error: string | null;
}) {
  const numeric = Number(amount);
  const valid = Number.isFinite(numeric) && numeric > 0;
  const balanceDue = report?.totalDue ?? null;
  const balanceAfter =
    balanceDue !== null && valid ? Math.max(0, balanceDue - numeric) : null;
  const exceedsDue =
    balanceDue !== null && valid && numeric > balanceDue;

  // Quick-pay chips — multiples that match common collection amounts.
  // Uses the totalDue when known; otherwise falls back to round numbers.
  const chips = React.useMemo(() => {
    if (balanceDue && balanceDue > 0) {
      const half = Math.round(balanceDue / 2);
      return [
        { label: "Full due", value: balanceDue },
        { label: "Half", value: half },
        { label: "1,000", value: 1000 },
        { label: "5,000", value: 5000 },
      ];
    }
    return [
      { label: "500", value: 500 },
      { label: "1,000", value: 1000 },
      { label: "5,000", value: 5000 },
      { label: "10,000", value: 10000 },
    ];
  }, [balanceDue]);

  return (
    <div className="space-y-3">
      {/* Student card */}
      <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
          {student.name
            .split(" ")
            .map((p) => p[0])
            .slice(0, 2)
            .join("")
            .toUpperCase() || "?"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{student.name}</p>
          {student.symbol && (
            <p className="text-[11px] text-muted-foreground">
              #{student.symbol}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Change student"
          className="h-9 w-9 rounded-full border border-input flex items-center justify-center text-muted-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Balance preview */}
      <div className="rounded-lg border bg-muted/20 p-3 text-center">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Balance due
        </p>
        <p className="text-2xl font-semibold tabular-nums mt-0.5">
          {loadingReport
            ? "…"
            : balanceDue !== null
              ? balanceDue.toLocaleString("en-IN")
              : "—"}
        </p>
        {balanceAfter !== null && (
          <p
            className={cn(
              "mt-1 text-[11px] tabular-nums",
              balanceAfter === 0 ? "text-emerald-700" : "text-muted-foreground",
            )}
          >
            After this payment: {balanceAfter.toLocaleString("en-IN")}
          </p>
        )}
      </div>

      {/* Amount display */}
      <div className="rounded-lg border bg-card p-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground text-center">
          Amount
        </p>
        <p
          className={cn(
            "text-center text-4xl font-bold tabular-nums mt-1",
            valid ? "text-foreground" : "text-muted-foreground/40",
            exceedsDue && "text-amber-700",
          )}
        >
          {amount === "" ? "0" : amount}
        </p>
        {exceedsDue && (
          <p className="mt-1 text-center text-[11px] text-amber-700">
            Exceeds balance due — extra goes to credit
          </p>
        )}
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => onAmountChange(String(c.value))}
              className="h-8 px-3 rounded-full border border-input bg-background text-xs font-medium hover:bg-muted/40 active:scale-[0.97]"
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Numeric pad */}
      <NumericPad value={amount} onChange={onAmountChange} maxLength={9} />

      {/* Method chips */}
      <div>
        <p className="px-1 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Payment method
        </p>
        <div className="grid grid-cols-4 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onMethodChange(m.value)}
              className={cn(
                "min-h-[56px] flex flex-col items-center justify-center gap-0.5 rounded-lg border text-[11px] font-medium",
                method === m.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-input bg-card text-foreground",
              )}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="text-xs text-red-700 px-1">{error}</p>
      )}

      {/* Sticky charge button */}
      <StickyActionBar>
        <TouchButton
          variant="primary"
          size="lg"
          onClick={onCharge}
          disabled={!valid || charging}
          className="w-full text-base"
        >
          {charging ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Recording…
            </>
          ) : (
            <>
              Charge {valid ? numeric.toLocaleString("en-IN") : ""}
            </>
          )}
        </TouchButton>
      </StickyActionBar>
    </div>
  );
}

// ===========================================================================
// Screen 3 — success + share
// ===========================================================================

function SuccessScreen({
  student,
  amount,
  balanceAfter,
  paymentId,
  onAnother,
}: {
  student: RecentStudent;
  amount: number;
  balanceAfter: number | null;
  paymentId: string;
  onAnother: () => void;
}) {
  const receiptUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/fees/payments?focus=${encodeURIComponent(paymentId)}`
      : "";

  const handleShare = async (channel: "whatsapp" | "sms" | "copy" | "native") => {
    const text = `${student.name} — receipt: ${amount.toLocaleString("en-IN")}. ${receiptUrl}`;
    if (channel === "native" && typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: `Receipt — ${student.name}`,
          text,
          url: receiptUrl,
        });
      } catch {
        /* user cancelled */
      }
      return;
    }
    if (channel === "whatsapp") {
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
      );
      return;
    }
    if (channel === "sms") {
      window.open(`sms:?body=${encodeURIComponent(text)}`);
      return;
    }
    if (channel === "copy") {
      await navigator.clipboard?.writeText(text);
    }
  };

  return (
    <div className="flex flex-col items-center text-center pt-6 pb-24">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 animate-in zoom-in-95 duration-200">
        <CheckCircle2 className="h-10 w-10" />
      </div>
      <p className="mt-4 text-3xl font-bold tabular-nums">
        {amount.toLocaleString("en-IN")}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Recorded for {student.name}
      </p>
      {balanceAfter !== null && (
        <p
          className={cn(
            "mt-2 text-xs tabular-nums",
            balanceAfter === 0 ? "text-emerald-700 font-medium" : "text-muted-foreground",
          )}
        >
          Remaining balance: {balanceAfter.toLocaleString("en-IN")}
        </p>
      )}

      {/* Share row */}
      <div className="mt-6 grid grid-cols-4 gap-2 w-full max-w-xs">
        <ShareTile
          label="Print"
          icon={<Printer className="h-4 w-4" />}
          onClick={() => window.print()}
        />
        <ShareTile
          label="WhatsApp"
          icon={<MessageSquare className="h-4 w-4 text-emerald-600" />}
          onClick={() => handleShare("whatsapp")}
        />
        <ShareTile
          label="SMS"
          icon={<MessageSquare className="h-4 w-4" />}
          onClick={() => handleShare("sms")}
        />
        <ShareTile
          label="Share"
          icon={<Share2 className="h-4 w-4" />}
          onClick={() => handleShare("native")}
        />
      </div>

      <StickyActionBar>
        <TouchButton
          variant="primary"
          size="lg"
          onClick={onAnother}
          className="w-full text-base"
        >
          Next payment
        </TouchButton>
      </StickyActionBar>
    </div>
  );
}

function ShareTile({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[64px] flex flex-col items-center justify-center gap-1 rounded-lg border border-input bg-card text-[10px] font-medium hover:bg-muted/30 active:scale-[0.97] transition-all"
    >
      {icon}
      {label}
    </button>
  );
}

// ===========================================================================
// Recents persistence
// ===========================================================================

function readRecents(): RecentStudent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentStudent[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function pushRecent(s: RecentStudent): void {
  if (typeof window === "undefined") return;
  try {
    const current = readRecents().filter((x) => x.id !== s.id);
    const next = [s, ...current].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
