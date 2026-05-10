"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, RefreshCw, Send, Trash2 } from "lucide-react";
import {
  productizationApi,
  type InvitationRole,
  type InvitationRow,
} from "@/lib/productization";
import { qk } from "@/lib/query-keys";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /settings/invitations — Phase 23 Section 2.
//
// Admin-side invitation list + composer. Resend / revoke per row.
// Activated invites disappear from the "outstanding" view but still
// show under "history" so the admin sees who accepted when.
// ---------------------------------------------------------------------------

export default function InvitationsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: qk.productization.invitations,
    queryFn: () => productizationApi.listInvitations(),
  });
  const create = useMutation({
    mutationFn: (input: {
      email: string;
      role: InvitationRole;
      displayName?: string;
    }) => productizationApi.createInvitation(input),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.productization.invitations }),
  });
  const resend = useMutation({
    mutationFn: (id: string) => productizationApi.resendInvitation(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.productization.invitations }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => productizationApi.revokeInvitation(id),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.productization.invitations }),
  });

  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [role, setRole] = React.useState<InvitationRole>("TEACHER");

  const rows = list.data ?? [];
  const pending = rows.filter((r) => r.isPending);
  const history = rows.filter((r) => !r.isPending);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Settings
        </p>
        <h1 className="text-2xl font-semibold mt-1">Invitations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send a one-shot link so a new staff member can set their own
          password and join your school.
        </p>
      </div>

      <form
        className="rounded-xl border bg-card p-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (email.trim().length === 0) return;
          create.mutate(
            {
              email: email.trim(),
              role,
              displayName: displayName.trim() || undefined,
            },
            {
              onSuccess: () => {
                setEmail("");
                setDisplayName("");
              },
            },
          );
        }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teacher@example.com"
              className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as InvitationRole)}
              className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="TEACHER">Teacher</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Display name (optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
            />
          </div>
        </div>
        {create.error && (
          <p className="text-xs text-red-700">
            {(create.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={create.isPending || email.trim().length === 0}
          className="inline-flex h-9 items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          {create.isPending ? "Sending…" : "Send invitation"}
        </button>
      </form>

      <Section title="Outstanding" rows={pending}>
        {(r) => (
          <>
            <button
              type="button"
              onClick={() => resend.mutate(r.id)}
              disabled={resend.isPending}
              className="text-xs px-2 h-7 rounded border border-input bg-card hover:bg-muted/40 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              Resend
            </button>
            <button
              type="button"
              onClick={() => revoke.mutate(r.id)}
              disabled={revoke.isPending}
              className="text-xs px-2 h-7 rounded border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              Revoke
            </button>
          </>
        )}
      </Section>

      <Section title="History" rows={history}>
        {(r) => (
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider px-2 h-6 rounded inline-flex items-center",
              r.acceptedAt
                ? "bg-emerald-100 text-emerald-700"
                : r.revokedAt
                  ? "bg-slate-100 text-slate-700"
                  : "bg-amber-100 text-amber-800",
            )}
          >
            {r.acceptedAt
              ? "Accepted"
              : r.revokedAt
                ? "Revoked"
                : "Expired"}
          </span>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  rows,
  children,
}: {
  title: string;
  rows: InvitationRow[];
  children: (row: InvitationRow) => React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="px-4 py-2.5 border-b">
        <p className="text-sm font-semibold">
          {title} ({rows.length})
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          <Mail className="h-4 w-4 inline mr-1 opacity-60" />
          No invitations.
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li
              key={r.id}
              className="px-4 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{r.email}</span>{" "}
                  <span className="text-[10px] text-muted-foreground">
                    {r.role}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Created {new Date(r.createdAt).toLocaleDateString()} ·
                  expires {new Date(r.expiresAt).toLocaleDateString()}
                </p>
              </div>
              <div className="shrink-0 flex items-center gap-2">{children(r)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
