"use client";

import { api } from "./api";

const TOKEN_KEY = "scholaris:token";
const USER_KEY = "scholaris:user";
const SCHOOL_KEY = "scholaris:school";

/**
 * Phase 7 — impersonation context, persisted in localStorage so the
 * banner survives a page reload. Cleared on logout + on
 * end-impersonation. Stored alongside (not inside) the user record
 * so domain code reading `getStoredUser` doesn't accidentally get
 * the impersonating super-admin's id.
 */
const IMPERSONATION_KEY = "scholaris:impersonation";

export interface ImpersonationContext {
  /** SUPER_ADMIN id who started the session — used for "Exit" + audit. */
  impersonatedBy: string;
  /** Email of the SUPER_ADMIN, for display in the banner. */
  impersonatedByEmail: string;
  /** Email of the school user being impersonated. */
  targetEmail: string;
  /** Role of the impersonated target — drives the role-pill in the banner. */
  targetRole: Role;
  /** Slug of the school the operator entered, for context labels. */
  schoolSlug: string;
  /** ISO timestamp the impersonation started — drives the duration display. */
  startedAt: string;
}

/**
 * Role hierarchy:
 *   • ADMIN   — full access (school config, users, fees, everything).
 *   • STAFF   — mid-level academic role. Manages subjects, exams,
 *               and enters results/attendance for ANY class without
 *               a teacher-scope check. Cannot manage students, fees,
 *               users, classes, or teachers.
 *   • TEACHER — class-bound. Acts only on TeachingAssignment scope.
 *   • STUDENT / PARENT — read-only roles, not yet wired into the UI.
 */
export type Role =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "STAFF"
  | "TEACHER"
  | "STUDENT"
  | "PARENT";

export interface SafeUser {
  id: string;
  email: string;
  role: Role;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SchoolSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Optional context attached when the user is a TEACHER. Drives the
 * post-login landing decision. Source of truth is `TeachingAssignment`
 * on the backend — the legacy single `Teacher.classId/sectionId` is
 * no longer consulted.
 */
export interface TeacherContext {
  /**
   * True iff the teacher has at least one TeachingAssignment row.
   * Use this (NOT classId) to decide between /attendance and the
   * "ask admin" landing.
   */
  hasAssignments: boolean;
  /**
   * "Primary" class ID — first assignment by createdAt. Useful for
   * deep-linking the landing page to a specific roster. Null when the
   * teacher has no assignments.
   */
  classId: string | null;
  /** First assignment's sectionId, or null for class-bound. */
  sectionId: string | null;
}

export interface AuthResult {
  accessToken: string;
  user: SafeUser;
  school: SchoolSummary;
  /** Populated only for TEACHER users. */
  teacher: TeacherContext | null;
}

export async function login(
  email: string,
  password: string,
): Promise<AuthResult> {
  const result = await api<AuthResult>("/auth/login", {
    auth: false,
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  storeAuth(result);
  return result;
}

export async function registerAdmin(
  email: string,
  password: string,
  schoolName: string,
): Promise<AuthResult> {
  const result = await api<AuthResult>("/auth/register", {
    auth: false,
    method: "POST",
    body: JSON.stringify({ email, password, schoolName }),
  });
  storeAuth(result);
  return result;
}

/**
 * Synchronous local logout — clears every cached auth artefact.
 * Used by the cross-tab storage handler and as the fallback if the
 * server-side revoke fails.
 */
function clearLocalAuth(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(SCHOOL_KEY);
    // Clear impersonation context too — sign-out is the only path
    // out of impersonation other than the explicit "Exit" button.
    window.localStorage.removeItem(IMPERSONATION_KEY);
    // Phase 5 — drop the cached feature flags so the next signed-in
    // user fetches fresh. Stale cache between accounts would cause
    // sidebar entries to flicker on/off on first paint.
    window.localStorage.removeItem("scholaris:features");
  } catch {
    /* no-op */
  }
}

/**
 * Best-effort server-side logout: revokes the session row, then
 * clears local state. The server call uses `redirectOn401: false`
 * because a stale token is exactly the case where logout still
 * needs to clear local state.
 *
 * Phase 17 follow-up — calling /auth/logout marks the session
 * row revoked so the token can't be reused even if it leaks.
 */
export async function logout(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (getToken()) {
      await api("/auth/logout", { method: "POST", redirectOn401: false }).catch(
        () => {
          /* swallow — local clear still happens below */
        },
      );
    }
  } finally {
    clearLocalAuth();
  }
}

/**
 * Synchronous logout for code paths that can't await (cross-tab
 * storage events, hard-redirects). Skips the server call; the
 * server-side session row will be revoked on the next call to
 * `/auth/logout` or the next `tokensValidAfter` flip.
 */
export function logoutSync(): void {
  clearLocalAuth();
}

/**
 * Swap stored auth into "impersonation mode": the new token is the
 * one the platform endpoint returned (carrying the target user's
 * identity), and `IMPERSONATION_KEY` records the SUPER_ADMIN's
 * details so the banner can show "Impersonating <email>" with an
 * exit button.
 *
 * Cached `USER_KEY` becomes the TARGET user — that's intentional,
 * since school-side UI reads from it for things like "show /admin
 * routes only when role===ADMIN". We don't store the SUPER_ADMIN's
 * full user record anywhere; only their id + email for banner +
 * audit display. Exiting impersonation re-fetches the SUPER_ADMIN's
 * record server-side and writes it back as USER_KEY.
 */
export function beginImpersonation(input: {
  accessToken: string;
  targetUser: { id: string; email: string; role: Role; schoolId: string };
  school: { id: string; name: string; slug: string };
  startedAt: string;
  impersonator: { id: string; email: string };
}): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, input.accessToken);
    // Synthesise a SafeUser-shaped record for the target. createdAt /
    // updatedAt aren't available from the impersonation response;
    // use the start timestamp so any code that reads them gets a
    // sensible value.
    const targetSafeUser: SafeUser = {
      id: input.targetUser.id,
      email: input.targetUser.email,
      role: input.targetUser.role,
      schoolId: input.targetUser.schoolId,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    };
    window.localStorage.setItem(USER_KEY, JSON.stringify(targetSafeUser));
    const targetSchool: SchoolSummary = {
      id: input.school.id,
      name: input.school.name,
      slug: input.school.slug,
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    };
    window.localStorage.setItem(SCHOOL_KEY, JSON.stringify(targetSchool));
    const ctx: ImpersonationContext = {
      impersonatedBy: input.impersonator.id,
      impersonatedByEmail: input.impersonator.email,
      targetEmail: input.targetUser.email,
      targetRole: input.targetUser.role,
      schoolSlug: input.school.slug,
      startedAt: input.startedAt,
    };
    window.localStorage.setItem(IMPERSONATION_KEY, JSON.stringify(ctx));
    // Drop the cached feature flags so the next /me/features fetch
    // returns the impersonated school's flags rather than the
    // SUPER_ADMIN's "all on" payload.
    window.localStorage.removeItem("scholaris:features");
  } catch {
    /* storage unavailable — caller should toast + fall back to /login */
  }
}

/**
 * Swap stored auth back to the SUPER_ADMIN. Caller passes the
 * fresh token + user record the END endpoint returned; we drop the
 * impersonation context. School cache is cleared (not repopulated)
 * since the SUPER_ADMIN's "school" is just an FK placeholder, not
 * a real tenant — leaving the impersonated school in place would
 * make the school dashboard show the WRONG school slug.
 */
export function endImpersonation(input: {
  accessToken: string;
  superAdmin: { id: string; email: string; role: Role; schoolId: string };
}): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, input.accessToken);
    const superSafeUser: SafeUser = {
      id: input.superAdmin.id,
      email: input.superAdmin.email,
      role: input.superAdmin.role,
      schoolId: input.superAdmin.schoolId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(USER_KEY, JSON.stringify(superSafeUser));
    window.localStorage.removeItem(SCHOOL_KEY);
    window.localStorage.removeItem(IMPERSONATION_KEY);
    // Drop the impersonated school's cached feature flags so the
    // next fetch returns the SUPER_ADMIN's "all on" payload.
    window.localStorage.removeItem("scholaris:features");
  } catch {
    /* no-op */
  }
}

/** Read current impersonation context, or null when not impersonating. */
export function getImpersonationContext(): ImpersonationContext | null {
  return readJson<ImpersonationContext>(IMPERSONATION_KEY);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser(): SafeUser | null {
  return readJson<SafeUser>(USER_KEY);
}

export function getStoredSchool(): SchoolSummary | null {
  return readJson<SchoolSummary>(SCHOOL_KEY);
}

function storeAuth(result: AuthResult) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, result.accessToken);
    window.localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    window.localStorage.setItem(SCHOOL_KEY, JSON.stringify(result.school));

    // Read-back verification. localStorage.setItem can silently no-op
    // in some browser modes (Safari ITP cross-site, private mode with
    // disk quota, third-party-storage-blocked Chrome). Without a
    // post-write check, the login flow appears to succeed but every
    // subsequent API call lands as 401 because the token never
    // actually persisted. Loud warn so the symptom shows up in
    // DevTools the moment it happens.
    const persisted = window.localStorage.getItem(TOKEN_KEY);
    if (persisted !== result.accessToken) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] Token write did not persist to localStorage. Subsequent API calls will return 401. Likely cause: private browsing or third-party storage blocked.",
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[auth] Failed to write auth state to localStorage:", e);
  }
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
