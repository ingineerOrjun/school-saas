"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Loader2,
  Mail,
  Megaphone,
  Palette,
  Receipt,
  Rocket,
  School2,
  Search,
  ShieldCheck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import { globalSearchApi, type SearchHit } from "@/lib/global-search";
import { getStoredUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  actionsForRole,
  scoreAction,
  type CommandAction,
} from "./command-actions";

// ---------------------------------------------------------------------------
// CommandPalette — Phase 24 Section 1.
//
// Universal Cmd+K (or Ctrl+K) overlay. Two zones:
//
//   1. Local actions — workflows, navigation, settings. Filtered by
//      role + the typed query (fuzzy match against label + keywords).
//      Always shown first; recents bubble to the top.
//
//   2. Server search — students / teachers / guardians / payments /
//      exams / classes from /me/search. Debounced 200ms; only fires
//      when the query is ≥ 2 chars.
//
// Keyboard:
//   • Cmd/Ctrl+K            — toggle open
//   • Esc                   — close
//   • ↑ / ↓                 — move highlight
//   • Enter                 — pick highlighted row (navigate)
//   • Cmd/Ctrl+Enter        — pick + open in new tab (future)
//
// Recents:
//   Last 5 picked actions persist in localStorage. They appear
//   pinned at the top of the action list when the query is empty,
//   so frequent operators get one-keystroke access to their daily
//   moves (cashier → "Collect payment", teacher → "Take attendance").
// ---------------------------------------------------------------------------

const RECENTS_KEY = "scholaris:cmdk:recents";
const MAX_RECENTS = 5;
const DEBOUNCE_MS = 200;

type Selection =
  | { kind: "action"; action: CommandAction }
  | { kind: "hit"; group: string; hit: SearchHit };

const ICON_MAP: Record<string, React.ReactNode> = {
  ClipboardCheck: <ClipboardCheck className="h-4 w-4" />,
  Wallet: <Wallet className="h-4 w-4" />,
  UserPlus: <UserPlus className="h-4 w-4" />,
  FileText: <FileText className="h-4 w-4" />,
  LayoutDashboard: <LayoutDashboard className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  GraduationCap: <GraduationCap className="h-4 w-4" />,
  Layers: <Layers className="h-4 w-4" />,
  Bell: <Bell className="h-4 w-4" />,
  Megaphone: <Megaphone className="h-4 w-4" />,
  School2: <School2 className="h-4 w-4" />,
  Palette: <Palette className="h-4 w-4" />,
  Mail: <Mail className="h-4 w-4" />,
  ShieldCheck: <ShieldCheck className="h-4 w-4" />,
  Rocket: <Rocket className="h-4 w-4" />,
};

const GROUP_ICON: Record<string, React.ReactNode> = {
  students: <Users className="h-3 w-3" />,
  teachers: <GraduationCap className="h-3 w-3" />,
  guardians: <Users className="h-3 w-3" />,
  payments: <Receipt className="h-3 w-3" />,
  exams: <FileText className="h-3 w-3" />,
  classes: <Layers className="h-3 w-3" />,
};

const GROUP_LABEL: Record<string, string> = {
  students: "Students",
  teachers: "Teachers",
  guardians: "Guardians",
  payments: "Payments",
  exams: "Exams",
  classes: "Classes",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [debouncedQuery, setDebouncedQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const user = React.useMemo(() => getStoredUser(), []);
  const role = user?.role ?? "ADMIN";

  // Keyboard: Cmd/Ctrl+K toggles the palette globally.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset state on close + autofocus on open.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setHighlightedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounce the search query so we don't fire one request per
  // keystroke. 200ms feels instant + cuts request volume ~5×.
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Server search — only enabled when typed ≥ 2 chars.
  const search = useQuery({
    queryKey: ["me", "search", debouncedQuery],
    queryFn: () => globalSearchApi.search(debouncedQuery),
    enabled: open && debouncedQuery.trim().length >= 2,
    staleTime: 60_000,
    retry: false,
  });

  // Recent actions (read once per open).
  const recents = React.useMemo(() => readRecents(), [open]);

  // Build the action list.
  const actions = React.useMemo(() => {
    const all = actionsForRole(role);
    const scored = all
      .map((a) => ({ a, score: scoreAction(a, query) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score);
    if (query.trim().length === 0) {
      // Empty query — push recents to the top, then show the rest
      // grouped naturally.
      const recentSet = new Set(recents);
      const recentActions = recents
        .map((id) => all.find((a) => a.id === id))
        .filter((a): a is CommandAction => !!a);
      const others = scored.filter((x) => !recentSet.has(x.a.id)).map((x) => x.a);
      return { recentActions, otherActions: others };
    }
    return { recentActions: [], otherActions: scored.map((x) => x.a) };
  }, [query, recents, role]);

  // Build a flat selection list for keyboard navigation. Order:
  //   recents → other actions → hit groups (in fixed group order).
  const flatSelections: Selection[] = React.useMemo(() => {
    const out: Selection[] = [];
    for (const a of actions.recentActions) {
      out.push({ kind: "action", action: a });
    }
    for (const a of actions.otherActions) {
      out.push({ kind: "action", action: a });
    }
    if (search.data) {
      for (const groupKey of [
        "students",
        "teachers",
        "guardians",
        "payments",
        "exams",
        "classes",
      ] as const) {
        for (const hit of search.data.groups[groupKey]) {
          out.push({ kind: "hit", group: groupKey, hit });
        }
      }
    }
    return out;
  }, [actions, search.data]);

  // Clamp the highlight when the list shrinks.
  React.useEffect(() => {
    if (highlightedIndex >= flatSelections.length) {
      setHighlightedIndex(Math.max(0, flatSelections.length - 1));
    }
  }, [flatSelections.length, highlightedIndex]);

  const pick = (sel: Selection) => {
    if (sel.kind === "action") {
      pushRecent(sel.action.id);
      router.push(sel.action.href);
    } else {
      router.push(sel.hit.href);
    }
    setOpen(false);
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) =>
        Math.min(flatSelections.length - 1, i + 1),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const sel = flatSelections[highlightedIndex];
      if (sel) pick(sel);
    }
  };

  if (!open) return null;

  let cursor = 0;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] flex items-start justify-center pt-[10vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-3">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlightedIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search students, teachers, receipts… or type a command"
            className="flex-1 h-12 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 outline-none"
          />
          {search.isFetching && (
            <Loader2 className="h-3.5 w-3.5 text-slate-400 animate-spin" />
          )}
          <kbd className="text-[10px] font-mono bg-slate-100 text-slate-500 rounded px-1.5 py-0.5 border border-slate-200">
            esc
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-2">
          {/* Recents (only when query empty) */}
          {actions.recentActions.length > 0 && (
            <Group title="Recent">
              {actions.recentActions.map((a) => {
                const idx = cursor++;
                return (
                  <ActionRow
                    key={a.id}
                    action={a}
                    highlighted={idx === highlightedIndex}
                    onMouseEnter={() => setHighlightedIndex(idx)}
                    onClick={() => pick({ kind: "action", action: a })}
                  />
                );
              })}
            </Group>
          )}

          {/* Actions — grouped by `group` key */}
          {actions.otherActions.length > 0 && (
            <>
              {(["workflow", "navigation", "create", "settings"] as const).map((g) => {
                const inGroup = actions.otherActions.filter((a) => a.group === g);
                if (inGroup.length === 0) return null;
                return (
                  <Group key={g} title={GROUP_TITLE[g]}>
                    {inGroup.map((a) => {
                      const idx = cursor++;
                      return (
                        <ActionRow
                          key={a.id}
                          action={a}
                          highlighted={idx === highlightedIndex}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                          onClick={() => pick({ kind: "action", action: a })}
                        />
                      );
                    })}
                  </Group>
                );
              })}
            </>
          )}

          {/* Server search results */}
          {search.data && search.data.hasResults && (
            <>
              {(["students", "teachers", "guardians", "payments", "exams", "classes"] as const).map(
                (g) => {
                  const hits = search.data!.groups[g];
                  if (hits.length === 0) return null;
                  return (
                    <Group key={g} title={GROUP_LABEL[g]} icon={GROUP_ICON[g]}>
                      {hits.map((hit) => {
                        const idx = cursor++;
                        return (
                          <HitRow
                            key={`${g}:${hit.id}`}
                            hit={hit}
                            highlighted={idx === highlightedIndex}
                            onMouseEnter={() => setHighlightedIndex(idx)}
                            onClick={() => pick({ kind: "hit", group: g, hit })}
                          />
                        );
                      })}
                    </Group>
                  );
                },
              )}
            </>
          )}

          {/* Empty results state */}
          {flatSelections.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-700 font-medium">
                No matches
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Try a student name, receipt number, or part of an email.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100 px-3 py-2 flex items-center justify-between text-[10px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span>
              <Kbd>↵</Kbd> select
            </span>
          </div>
          <span>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd> to toggle
          </span>
        </div>
      </div>
    </div>
  );
}

const GROUP_TITLE: Record<CommandAction["group"], string> = {
  workflow: "Quick actions",
  navigation: "Go to",
  create: "Create",
  settings: "Settings",
};

function Group({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="px-3 py-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        {icon}
        {title}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function ActionRow({
  action,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  action: CommandAction;
  highlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onMouseEnter}
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm",
          highlighted ? "bg-slate-100" : "hover:bg-slate-50",
        )}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-700">
          {action.icon ? ICON_MAP[action.icon] ?? null : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-slate-800">{action.label}</span>
          {action.hint && (
            <span className="ml-2 text-[11px] text-slate-500">{action.hint}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function HitRow({
  hit,
  highlighted,
  onMouseEnter,
  onClick,
}: {
  hit: SearchHit;
  highlighted: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onMouseEnter={onMouseEnter}
        onClick={onClick}
        className={cn(
          "w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm",
          highlighted ? "bg-slate-100" : "hover:bg-slate-50",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-slate-800">{hit.primary}</span>
          {hit.secondary && (
            <span className="block truncate text-[11px] text-slate-500">
              {hit.secondary}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block bg-slate-100 text-slate-600 rounded px-1 py-0.5 mx-0.5 font-mono text-[9px] border border-slate-200">
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Recents persistence
// ---------------------------------------------------------------------------

function readRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  try {
    const current = readRecents().filter((x) => x !== id);
    const next = [id, ...current].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage disabled — silent fall-through */
  }
}
