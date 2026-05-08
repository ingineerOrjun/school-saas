"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  Megaphone,
  Plus,
  RotateCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  announcementsApi,
  type AnnouncementDto,
} from "@/lib/announcements";
import { getStoredUser, type Role } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { DualDate } from "@/components/calendar/DualDate";
import { useAcademicSession } from "@/components/academic-session/AcademicSessionProvider";
import { cn } from "@/lib/utils";
import { FeatureGate } from "@/components/platform/FeatureGate";
import { FeatureKey } from "@/lib/features";

/**
 * /announcements — school-wide notice board.
 *
 *   • READS — every authenticated user (teachers + admins).
 *   • WRITES — ADMIN only. The "Add Announcement" button + per-row
 *     delete are gated client-side; the backend re-enforces with
 *     `@Roles(Role.ADMIN)` so a hand-crafted POST 403s either way.
 *
 * Phase 5: gated behind the `announcements` feature flag. The
 * default export wraps the view in a FeatureGate so direct URL
 * navigation lands on a friendly "feature disabled" panel when
 * the school's plan / override has it off. SUPER_ADMIN bypasses.
 */
export default function AnnouncementsPage() {
  return (
    <FeatureGate
      featureKey={FeatureKey.Announcements}
      featureLabel="Announcements"
    >
      <AnnouncementsView />
    </FeatureGate>
  );
}

function AnnouncementsView() {
  const router = useRouter();
  const [list, setList] = React.useState<AnnouncementDto[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  // Set so multiple deletes can be in flight at once without their
  // spinners stomping each other.
  const [removingIds, setRemovingIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Role gate — read once on mount; the JWT role doesn't change at
  // runtime so re-reading every render would be noise. `null` for
  // one frame so admin chrome doesn't briefly flash for teachers.
  const [role, setRole] = React.useState<Role | null>(null);
  React.useEffect(() => {
    setRole(getStoredUser()?.role ?? null);
  }, []);
  const isAdmin = role === "ADMIN";

  // Selected session drives the feed filter — switching sessions in
  // the topbar refetches with the new id. `selected` may be null
  // briefly during the provider's initial load; the API call still
  // works (backend applies its strict-default rule).
  const { selected: selectedSession } = useAcademicSession();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await announcementsApi.list(selectedSession?.id);
      setList(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load announcements.",
      );
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [router, selectedSession?.id]);

  // Re-fetch when the user switches academic session in the topbar.
  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreated = (created: AnnouncementDto) => {
    // Prepend — the backend orders newest-first so this matches the
    // canonical view without a re-fetch.
    setList((prev) => (prev ? [created, ...prev] : [created]));
  };

  const handleDelete = async (a: AnnouncementDto) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete "${a.title}"? This cannot be undone.`)) {
      return;
    }
    setRemovingIds((prev) => new Set(prev).add(a.id));
    try {
      await announcementsApi.remove(a.id);
      setList((prev) =>
        prev ? prev.filter((x) => x.id !== a.id) : prev,
      );
      toast.success("Announcement deleted");
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to delete.",
      );
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(a.id);
        return next;
      });
    }
  };

  const isEmpty = !loading && !error && list !== null && list.length === 0;
  const hasItems = !loading && list !== null && list.length > 0;

  return (
    <div className="space-y-6">
      <Header
        count={list?.length ?? 0}
        loading={loading}
        isAdmin={isAdmin}
        onAdd={() => setAddOpen(true)}
        onRefresh={refresh}
      />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Couldn&apos;t load announcements
            </p>
            <p className="mt-1 text-sm text-destructive/90">{error}</p>
          </div>
        </div>
      )}

      {loading && <ListSkeleton />}

      {isEmpty && (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Megaphone className="h-10 w-10" strokeWidth={1.5} />}
            title="No announcements yet"
            description={
              isAdmin
                ? "Post the first one to share school-wide news with every account."
                : "When your admin posts something, it'll show up here."
            }
            action={
              isAdmin
                ? {
                    label: "Post an announcement",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: () => setAddOpen(true),
                  }
                : undefined
            }
          />
        </div>
      )}

      {hasItems && (
        <ul className="space-y-3">
          {list!.map((a) => (
            <AnnouncementCard
              key={a.id}
              announcement={a}
              canDelete={isAdmin}
              removing={removingIds.has(a.id)}
              onDelete={() => handleDelete(a)}
            />
          ))}
        </ul>
      )}

      {/* Modal mounted only when admin — teachers can never trigger
          the open state, so the dialog stays out of their tree. */}
      {isAdmin && (
        <AddAnnouncementDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  count,
  loading,
  isAdmin,
  onAdd,
  onRefresh,
}: {
  count: number;
  loading: boolean;
  isAdmin: boolean;
  onAdd: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between animate-fade-in-up">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Announcements
        </h1>
        <p className="text-sm text-muted-foreground">
          {loading ? (
            <Skeleton className="inline-block h-3 w-32" />
          ) : count === 0 ? (
            "Post school-wide notices for staff and students."
          ) : (
            <>
              <span className="font-medium text-foreground">{count}</span>{" "}
              {count === 1 ? "announcement" : "announcements"} posted.
            </>
          )}
        </p>
      </div>
      {/* flex-wrap so the cluster reflows onto two rows on narrow phones. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          leftIcon={<RotateCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
        {isAdmin && (
          <Button onClick={onAdd} leftIcon={<Plus className="h-4 w-4" />}>
            Add Announcement
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function AnnouncementCard({
  announcement,
  canDelete,
  removing,
  onDelete,
}: {
  announcement: AnnouncementDto;
  canDelete: boolean;
  removing: boolean;
  onDelete: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-lg border border-border bg-surface p-5 transition-opacity",
        removing && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <Megaphone className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground leading-snug break-words">
                {announcement.title}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {/* Relative phrase ("5m ago") for fresh items; for
                    anything older than a week the relative phrase
                    stays empty and we let the <DualDate /> carry the
                    full calendar-aware date alone. */}
                {(() => {
                  const rel = formatRelative(announcement.createdAt);
                  return rel ? <>Posted {rel} · </> : <>Posted </>;
                })()}
                <DualDate date={announcement.createdAt} />
              </p>
            </div>
          </div>
          {/* whitespace-pre-wrap so admins can paste multi-paragraph
              notices with line breaks intact. break-words guards
              against pasted long URLs blowing the layout. */}
          <p className="mt-3 text-sm text-foreground/90 whitespace-pre-wrap break-words leading-relaxed">
            {announcement.message}
          </p>
        </div>

        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={removing}
            aria-label={`Delete ${announcement.title}`}
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground",
              "transition-colors hover:bg-destructive/10 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-destructive/30",
              removing && "cursor-not-allowed opacity-60",
            )}
          >
            {removing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="rounded-lg border border-border bg-surface p-5"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-3 h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Add dialog
// ---------------------------------------------------------------------------

function AddAnnouncementDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (a: AnnouncementDto) => void;
}) {
  const [title, setTitle] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset every time the dialog re-opens so a half-typed draft from
  // a previous open doesn't reappear.
  React.useEffect(() => {
    if (open) {
      setTitle("");
      setMessage("");
      setError(null);
    }
  }, [open]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const trimmedTitle = title.trim();
  const trimmedMessage = message.trim();
  const canSubmit =
    !submitting && trimmedTitle.length > 0 && trimmedMessage.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await announcementsApi.create({
        title: trimmedTitle,
        message: trimmedMessage,
      });
      toast.success("Announcement posted");
      onCreated(created);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to post announcement.";
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Post an announcement"
      description="Visible to every teacher and admin in your school."
      footer={
        <>
          <Button
            variant="ghost"
            type="button"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={submitting}
            disabled={!canSubmit}
            type="button"
          >
            Post
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Title"
          placeholder="e.g. Term holidays starting Friday"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          maxLength={160}
          disabled={submitting}
        />
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="ann-message"
            className="text-sm font-medium text-foreground"
          >
            Message
          </label>
          <textarea
            id="ann-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write the full notice here. Line breaks are preserved."
            required
            rows={6}
            maxLength={5000}
            disabled={submitting}
            className={cn(
              "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground",
              "placeholder:text-muted-foreground/60",
              "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30",
              "disabled:opacity-60 disabled:cursor-not-allowed",
              "resize-y",
            )}
          />
          <p className="text-xs text-muted-foreground text-right tabular-nums">
            {trimmedMessage.length} / 5000
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {/* Hidden submit so Enter-in-input still triggers handleSubmit. */}
        <button type="submit" className="hidden" aria-hidden />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  // >7 days old: drop the relative phrase entirely. The sibling
  // <DualDate /> renders the absolute date in the user's chosen
  // calendar — duplicating it as a Western "Aug 15, 8:05 PM" string
  // would bypass the preference and clutter the meta line.
  return "";
}

// `formatExact` was removed in the dual-date pass: the JSX now pairs
// the relative phrase with a sibling <DualDate />, which renders the
// absolute date in the user's chosen calendar (B.S. / A.D. / Dual).
// `formatRelative` returns an empty string for items older than a
// week so the <DualDate /> stands alone — no redundant Western
// datetime that would bypass the calendar preference.
