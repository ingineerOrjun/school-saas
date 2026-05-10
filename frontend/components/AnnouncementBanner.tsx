"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { productizationApi, type AnnouncementRow } from "@/lib/productization";
import { qk } from "@/lib/query-keys";
import { STALE } from "@/lib/query-client";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// AnnouncementBanner — Phase 23 Section 7 (school-side surface).
//
// Polls /me/announcements and renders one stacked card per active,
// audience-matching, non-dismissed announcement. Per-user dismissal:
// clicking X writes a dismissal row server-side (idempotent), then
// optimistically removes the card from view.
//
// Mounted in the school-side dashboard layout — appears on every
// authenticated page. Polling cadence is intentionally slow (5
// minutes); operators don't need sub-second propagation for routine
// release notes.
//
// Renders nothing when there are no banners. The container is
// invisible in that case so layouts don't shift.
// ---------------------------------------------------------------------------

export function AnnouncementBanner() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.productization.activeAnnouncements,
    queryFn: () => productizationApi.listActiveAnnouncements(),
    staleTime: STALE.SEMI_STATIC,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
    // Auth-only call; if the user isn't logged in we just skip.
    enabled: typeof window !== "undefined",
    retry: false,
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => productizationApi.dismissAnnouncement(id),
    onMutate: async (id) => {
      // Optimistic remove. If the call fails we'll refetch on the
      // next poll tick and bring it back.
      await qc.cancelQueries({
        queryKey: qk.productization.activeAnnouncements,
      });
      const previous = qc.getQueryData<AnnouncementRow[]>(
        qk.productization.activeAnnouncements,
      );
      qc.setQueryData<AnnouncementRow[]>(
        qk.productization.activeAnnouncements,
        (rows) => rows?.filter((r) => r.id !== id) ?? [],
      );
      return { previous };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(qk.productization.activeAnnouncements, ctx.previous);
      }
    },
  });

  const rows = query.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      {rows.map((a) => (
        <AnnouncementCard
          key={a.id}
          announcement={a}
          onDismiss={() => dismiss.mutate(a.id)}
        />
      ))}
    </div>
  );
}

function AnnouncementCard({
  announcement,
  onDismiss,
}: {
  announcement: AnnouncementRow;
  onDismiss: () => void;
}) {
  const tone = (announcement.tone || "info").toLowerCase();
  const cls =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/60 text-amber-900"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50/60 text-emerald-900"
        : "border-sky-200 bg-sky-50/60 text-sky-900";
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 flex items-start gap-3",
        cls,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{announcement.title}</p>
        <p className="mt-0.5 text-xs whitespace-pre-wrap leading-relaxed">
          {announcement.body}
        </p>
        {announcement.linkUrl && (
          <a
            href={announcement.linkUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline"
          >
            Learn more
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 text-current opacity-60 hover:opacity-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
