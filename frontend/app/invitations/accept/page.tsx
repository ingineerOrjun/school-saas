"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import { productizationApi } from "@/lib/productization";
import { qk } from "@/lib/query-keys";

// ---------------------------------------------------------------------------
// /invitations/accept — Phase 23 Section 2 (anonymous endpoint).
//
// Recipient lands here from the email link (?token=...). Steps:
//
//   1. We preview the token: shows "you've been invited to <school>
//      as <role>" so the user knows what they're accepting.
//   2. User sets a password + (optional) display name.
//   3. We POST /me/invitations/accept; on success, redirect to /login
//      with the email pre-filled.
//
// Failure cases all render a clear error card:
//   • Token not found / typo
//   • Already accepted (sign in normally)
//   • Revoked
//   • Expired
// ---------------------------------------------------------------------------

export default function AcceptInvitationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const preview = useQuery({
    queryKey: qk.productization.invitationPreview(token),
    queryFn: () => productizationApi.previewInvitation(token),
    enabled: token.length > 0,
    retry: false,
  });

  const accept = useMutation({
    mutationFn: (input: { password: string; displayName: string }) =>
      productizationApi.acceptInvitation({
        token,
        password: input.password,
        displayName: input.displayName || undefined,
      }),
    onSuccess: (result) => {
      // Redirect to /login with the email pre-filled so the user
      // can sign in immediately. Success card shows briefly via the
      // mutation's `isSuccess`.
      const email = encodeURIComponent(result.user.email);
      setTimeout(() => router.push(`/login?email=${email}`), 1_500);
    },
  });

  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");

  if (token.length === 0) {
    return (
      <Shell>
        <ErrorCard
          title="Missing invitation token"
          message="The invitation link in your email looks incomplete. Please copy and paste the full URL."
        />
      </Shell>
    );
  }

  if (preview.isLoading) {
    return (
      <Shell>
        <div className="rounded-xl border bg-card p-6 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            Checking your invitation…
          </p>
        </div>
      </Shell>
    );
  }

  if (preview.error || !preview.data) {
    return (
      <Shell>
        <ErrorCard
          title="Invitation not found"
          message={
            (preview.error as Error)?.message ??
            "This invitation link is invalid. It may have been revoked or already accepted."
          }
        />
      </Shell>
    );
  }

  if (!preview.data.isPending) {
    return (
      <Shell>
        <ErrorCard
          title="Invitation no longer valid"
          message="This invitation has already been accepted, expired, or revoked. Please sign in normally or ask your admin for a new link."
        />
      </Shell>
    );
  }

  if (accept.isSuccess) {
    return (
      <Shell>
        <div className="rounded-xl border bg-card p-6 text-center">
          <CheckCircle2 className="mx-auto h-6 w-6 text-emerald-500" />
          <p className="mt-2 text-sm font-semibold">Account created</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Redirecting you to sign in…
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="rounded-xl border bg-card p-6">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Invitation
        </p>
        <h1 className="text-xl font-semibold mt-1">
          Join {preview.data.schoolName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You've been invited as a {preview.data.role.toLowerCase()}.
          Set a password to finish creating your account.
        </p>

        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length < 8) return;
            accept.mutate({ password, displayName });
          }}
        >
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              value={preview.data.email}
              disabled
              className="mt-1 w-full h-9 rounded-md border border-input bg-muted/40 px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Display name (optional)
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={preview.data.displayName ?? "Your full name"}
              className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="mt-1 w-full h-9 rounded-md border border-input bg-card px-2 text-sm"
            />
            {password.length > 0 && password.length < 8 && (
              <p className="mt-1 text-[11px] text-amber-700">
                Password must be at least 8 characters.
              </p>
            )}
          </div>

          {accept.error && (
            <p className="text-xs text-red-700">
              {(accept.error as Error).message}
            </p>
          )}

          <button
            type="submit"
            disabled={accept.isPending || password.length < 8}
            className="w-full inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {accept.isPending ? "Creating account…" : "Accept and continue"}
          </button>
        </form>
        <p className="mt-3 text-[11px] text-muted-foreground text-center">
          Invitation expires{" "}
          {new Date(preview.data.expiresAt).toLocaleDateString()}.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function ErrorCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50/40 p-6">
      <div className="flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-red-900">{title}</p>
          <p className="mt-1 text-xs text-red-800 leading-relaxed">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}
