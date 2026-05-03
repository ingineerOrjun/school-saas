"use client";

import { api } from "./api";

const TOKEN_KEY = "scholaris:token";
const USER_KEY = "scholaris:user";
const SCHOOL_KEY = "scholaris:school";

export type Role = "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";

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

export function logout() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(SCHOOL_KEY);
  } catch {
    /* no-op */
  }
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
  } catch {
    /* no-op */
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
