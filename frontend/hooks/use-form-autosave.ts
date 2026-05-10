"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// useFormAutosave + useUnsavedChangesGuard — Phase 24 Section 8.
//
// Two cooperating hooks for forgiving form UX:
//
//   useFormAutosave — saves the in-progress value to localStorage on
//     a debounce. On mount it reads the saved draft and (if present)
//     surfaces a "restore?" prompt to the caller. Lets a user close
//     the tab mid-edit and pick up where they left off.
//
//   useUnsavedChangesGuard — when the form is dirty, blocks
//     accidental navigation (browser close, refresh) with the
//     standard `beforeunload` confirm dialog.
//
// Trade-offs:
//   • Storage cost: tiny (one JSON blob per form id, typically < 2KB).
//   • Privacy: drafts are device-local; never sent to the server.
//     Don't autosave secrets.
//   • Debounce: 800ms. Faster feels jumpy; slower loses too much on
//     a crash. 800ms catches typical typing pauses.
// ---------------------------------------------------------------------------

const DEFAULT_DEBOUNCE_MS = 800;

export interface FormAutosaveOptions<T> {
  /**
   * Stable identifier for the form. Used as the localStorage key —
   * `scholaris:draft:<formId>`. Pick something specific
   * ("student-create-form", not "form").
   */
  formId: string;
  /** Current form value to persist. */
  value: T;
  /**
   * Skip persistence when this is false (e.g., right after a
   * successful submit — the parent clears the draft and disables
   * autosave to avoid re-writing the cleared form).
   */
  enabled?: boolean;
  /** Debounce window in ms. Default 800. */
  debounceMs?: number;
  /** Custom serializer. Default JSON.stringify. */
  serialize?: (value: T) => string;
  /** Custom deserializer. Default JSON.parse. */
  deserialize?: (raw: string) => T;
}

export interface FormAutosaveResult<T> {
  /** Saved draft from a previous session, or null when none / disabled. */
  draft: T | null;
  /**
   * Manually persist the current value (e.g. on a form-level save
   * button before navigating away). Idempotent.
   */
  flush: () => void;
  /** Clear the persisted draft (e.g. after successful submit). */
  clear: () => void;
}

export function useFormAutosave<T>({
  formId,
  value,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  serialize = JSON.stringify,
  deserialize = JSON.parse,
}: FormAutosaveOptions<T>): FormAutosaveResult<T> {
  const key = `scholaris:draft:${formId}`;
  const [draft, setDraft] = React.useState<T | null>(null);
  const lastWritten = React.useRef<string | null>(null);

  // Read saved draft once on mount.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return;
      lastWritten.current = raw;
      setDraft(deserialize(raw));
    } catch {
      // Corrupt draft → discard silently.
      window.localStorage.removeItem(key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Debounced persistence.
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const t = setTimeout(() => {
      try {
        const next = serialize(value);
        if (next === lastWritten.current) return; // no change
        window.localStorage.setItem(key, next);
        lastWritten.current = next;
      } catch {
        // Quota exceeded / disabled storage — silent fall-through.
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [value, enabled, key, debounceMs, serialize]);

  const flush = React.useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const next = serialize(value);
      window.localStorage.setItem(key, next);
      lastWritten.current = next;
    } catch {
      /* ignore */
    }
  }, [key, serialize, value]);

  const clear = React.useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(key);
      lastWritten.current = null;
      setDraft(null);
    } catch {
      /* ignore */
    }
  }, [key]);

  return { draft, flush, clear };
}

/**
 * Block accidental navigation when the form is dirty. Hooks into
 * the browser's `beforeunload` event — the user gets the standard
 * "Leave site? Changes you made may not be saved." prompt.
 *
 * Note: in-app navigations (Next.js router.push) do NOT trigger
 * `beforeunload`. For those, the calling component should listen
 * to the router's events and confirm manually. (Next.js App Router
 * doesn't expose router.events; use the `onBeforeUnload` browser
 * dialog as the safety net + an in-component "are you sure?"
 * dialog on the back button when needed.)
 */
export function useUnsavedChangesGuard(isDirty: boolean): void {
  React.useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore the message text and show a generic
      // prompt. The non-empty `returnValue` is what triggers the
      // dialog at all.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);
}
