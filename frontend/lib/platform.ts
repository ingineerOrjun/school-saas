import { api } from "./api";

// ---------------------------------------------------------------------------
// Platform Control Layer client — types + endpoints mirror the
// backend's PlatformController exactly.
//
// Every call here requires a SUPER_ADMIN session. The page-level
// layout in `/platform` does the role gate before any of these run,
// but the backend enforces the same gate via `@Roles(SUPER_ADMIN)`
// — client guards lie under adversarial conditions.
// ---------------------------------------------------------------------------

export type SchoolStatus = "ACTIVE" | "TRIAL" | "SUSPENDED" | "EXPIRED";

export interface PlatformOverview {
  schoolsTotal: number;
  schoolsActive: number;
  schoolsTrial: number;
  schoolsSuspended: number;
  schoolsExpired: number;
  studentsTotal: number;
  teachersTotal: number;
  paymentsTotalAmount: number;
  paymentsTotalCount: number;
  schoolGrowthTrend: Array<{ month: string; count: number }>;
  generatedAt: string;
}

export type SubscriptionPlan = "TRIAL" | "MONTHLY" | "YEARLY" | "UNLIMITED";
export type BillingCycle = "MONTHLY" | "YEARLY" | "ONE_TIME" | "PERPETUAL";

export interface PlatformSchoolRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  status: SchoolStatus;
  expiresAt: string | null;
  studentCount: number;
  teacherCount: number;
  paymentsTotalAmount: number;
  /** Latest subscription summary; null when school has no subscriptions yet. */
  currentSubscription: {
    id: string;
    plan: SubscriptionPlan;
    billingCycle: BillingCycle;
    startDate: string;
    endDate: string | null;
    studentLimit: number | null;
    teacherLimit: number | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRow {
  id: string;
  schoolId: string;
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  startDate: string;
  endDate: string | null;
  studentLimit: number | null;
  teacherLimit: number | null;
  enabledFeatures: Record<string, boolean>;
  notes: string | null;
  createdById: string | null;
  createdByEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubscriptionInput {
  plan: SubscriptionPlan;
  billingCycle: BillingCycle;
  /** ISO date string (YYYY-MM-DD or full ISO). */
  startDate: string;
  /** Required for non-UNLIMITED plans. Backend rejects if missing on those tiers. */
  endDate?: string | null;
  studentLimit?: number | null;
  teacherLimit?: number | null;
  enabledFeatures?: Record<string, boolean>;
  notes?: string | null;
}

export interface PlatformSchoolsQuery {
  q?: string;
  status?: SchoolStatus;
  page?: number;
  pageSize?: number;
}

export interface PlatformSchoolsResponse {
  rows: PlatformSchoolRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateSchoolStatusInput {
  status: SchoolStatus;
  /** Required when transitioning to SUSPENDED or EXPIRED. */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Phase 8 — Audit log types.
//
// `before` / `after` are `unknown` because they're typed at the
// audit-row level as JSON. The action enum tells consumers what
// shape to expect (e.g. SCHOOL_STATUS_CHANGED → `{ status: SchoolStatus }`).
// ---------------------------------------------------------------------------

export type PlatformAuditAction =
  | "SCHOOL_STATUS_CHANGED"
  | "IMPERSONATION_STARTED"
  | "IMPERSONATION_ENDED"
  | "SUBSCRIPTION_CREATED"
  | "FEATURE_FLAG_CHANGED"
  | "USER_FORCE_LOGOUT"
  | "SCHOOL_FORCE_LOGOUT"
  | "ADMIN_PASSWORD_RESET";

/** Minimal user shape returned by /platform/schools/:id/users. */
export interface PlatformSchoolUser {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/** START result — frontend stores accessToken and surfaces a banner. */
export interface StartImpersonationResult {
  accessToken: string;
  user: { id: string; email: string; role: string; schoolId: string };
  school: { id: string; name: string; slug: string };
  startedAt: string;
}

/** END result — fresh SUPER_ADMIN token replaces the impersonation one. */
export interface EndImpersonationResult {
  accessToken: string;
  user: { id: string; email: string; role: string; schoolId: string };
}

export interface PlatformAuditRow {
  id: string;
  action: PlatformAuditAction;
  actorUserId: string;
  actorEmail: string | null;
  actorRole: string | null;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PlatformAuditQuery {
  action?: PlatformAuditAction;
  actorUserId?: string;
  targetType?: string;
  targetId?: string;
  q?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export interface PlatformAuditResponse {
  rows: PlatformAuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Phase 5 — Feature flags (platform side).
// ---------------------------------------------------------------------------

export interface PlatformFeatureCatalogEntry {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  comingSoon: boolean;
}

export interface PlatformFeatureSet {
  features: Record<string, boolean>;
  overrides: Record<string, boolean>;
  subscription: Record<string, boolean> | null;
  defaults: Record<string, boolean>;
}

export interface PlatformFeatureSchoolRow {
  id: string;
  name: string;
  slug: string;
  status: SchoolStatus;
  currentPlan: SubscriptionPlan | null;
  features: Record<string, boolean>;
  overrides: Record<string, boolean>;
  subscription: Record<string, boolean> | null;
}

export interface PlatformFeatureMatrixResponse {
  catalog: PlatformFeatureCatalogEntry[];
  schools: PlatformFeatureSchoolRow[];
}

export interface UpdateFeatureOverridesInput {
  overrides: Record<string, boolean>;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Phase 9 — Security controls.
// ---------------------------------------------------------------------------

export interface ForceLogoutUserResult {
  tokensValidAfter: string;
  user: { id: string; email: string; role: string };
}

export interface ForceLogoutSchoolResult {
  tokensValidAfter: string;
  affectedCount: number;
}

export interface ResetPasswordResult {
  /** Plaintext temporary password — returned ONCE, never recoverable. */
  temporaryPassword: string;
  tokensValidAfter: string;
  user: { id: string; email: string; role: string };
}

export const platformApi = {
  /** Cross-platform overview — KPIs + 12-month school growth trend. */
  getOverview: () => api<PlatformOverview>("/platform/overview"),

  /**
   * Paginated, filterable schools list. Query params are URL-encoded;
   * empty values are dropped.
   */
  listSchools: (query: PlatformSchoolsQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return api<PlatformSchoolsResponse>(
      qs ? `/platform/schools?${qs}` : "/platform/schools",
    );
  },

  /** Single-school detail. */
  getSchool: (schoolId: string) =>
    api<PlatformSchoolRow>(
      `/platform/schools/${encodeURIComponent(schoolId)}`,
    ),

  /**
   * Change a school's lifecycle status. Backend rejects the call
   * with 400 if `reason` is missing on a SUSPENDED/EXPIRED transition.
   */
  updateSchoolStatus: (schoolId: string, input: UpdateSchoolStatusInput) =>
    api<PlatformSchoolRow>(
      `/platform/schools/${encodeURIComponent(schoolId)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    ),

  /** List a school's non-SUPER_ADMIN users — for the impersonation picker. */
  listSchoolUsers: (schoolId: string) =>
    api<PlatformSchoolUser[]>(
      `/platform/schools/${encodeURIComponent(schoolId)}/users`,
    ),

  /** Full subscription history for a school, newest-first. */
  listSubscriptions: (schoolId: string) =>
    api<SubscriptionRow[]>(
      `/platform/schools/${encodeURIComponent(schoolId)}/subscriptions`,
    ),

  /**
   * Create a new subscription period. Append-only — every plan
   * change/extension/renewal posts a new row. The school's
   * status + expiresAt are updated as a side effect.
   */
  createSubscription: (
    schoolId: string,
    input: CreateSubscriptionInput,
  ) =>
    api<SubscriptionRow>(
      `/platform/schools/${encodeURIComponent(schoolId)}/subscriptions`,
      { method: "POST", body: JSON.stringify(input) },
    ),

  /**
   * Start impersonating `userId`. Returns a NEW JWT carrying the
   * target's identity + impersonation sentinels. The caller is
   * responsible for swapping the stored token (see
   * `lib/auth.beginImpersonation`).
   */
  startImpersonation: (userId: string) =>
    api<StartImpersonationResult>(
      `/platform/impersonate/${encodeURIComponent(userId)}`,
      { method: "POST" },
    ),

  /**
   * End the current impersonation session. Returns a fresh
   * SUPER_ADMIN token. Caller swaps it back via
   * `lib/auth.endImpersonation`.
   */
  endImpersonation: () =>
    api<EndImpersonationResult>("/platform/impersonate/end", {
      method: "POST",
      // Do NOT redirect on 401 from this call — that would loop the
      // user through /login during the token-swap window. The
      // service errors with 401 only if the token is genuinely
      // invalid; the cached fallback handler in the banner shows a
      // toast and falls back to /login manually.
      redirectOn401: false,
    }),

  /**
   * Paginated audit log. Empty filter values are stripped from the
   * URL so a bare `listAudit()` returns the most recent N entries.
   */
  listAudit: (query: PlatformAuditQuery = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return api<PlatformAuditResponse>(
      qs ? `/platform/audit?${qs}` : "/platform/audit",
    );
  },

  // ---------- Feature flags (Phase 5) ----------

  /** The feature catalog — drives the matrix column header. */
  getFeatureCatalog: () =>
    api<PlatformFeatureCatalogEntry[]>("/platform/features/catalog"),

  /** Cross-tenant matrix: every school × every feature, with layers. */
  listFeatureMatrix: () =>
    api<PlatformFeatureMatrixResponse>("/platform/features"),

  /** Resolved + layered feature set for one school. */
  getSchoolFeatures: (schoolId: string) =>
    api<PlatformFeatureSet>(
      `/platform/schools/${encodeURIComponent(schoolId)}/features`,
    ),

  /**
   * Replace the school-level override map. Empty `overrides` clears
   * every override (subscription + defaults take over). The backend
   * audits the diff via FEATURE_FLAG_CHANGED.
   */
  setSchoolFeatures: (
    schoolId: string,
    input: UpdateFeatureOverridesInput,
  ) =>
    api<PlatformFeatureSet>(
      `/platform/schools/${encodeURIComponent(schoolId)}/features`,
      { method: "PATCH", body: JSON.stringify(input) },
    ),

  // ---------- Security controls (Phase 9) ----------

  /**
   * Force-logout a single user. Their existing JWTs become invalid;
   * they must sign in again to obtain a fresh token.
   */
  forceLogoutUser: (userId: string, reason?: string) =>
    api<ForceLogoutUserResult>(
      `/platform/users/${encodeURIComponent(userId)}/force-logout`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? undefined }),
      },
    ),

  /**
   * Force-logout every NON-SUPER_ADMIN user at a school. Reason is
   * required by the backend; the dialog enforces this client-side too.
   */
  forceLogoutSchool: (schoolId: string, reason: string) =>
    api<ForceLogoutSchoolResult>(
      `/platform/schools/${encodeURIComponent(schoolId)}/force-logout`,
      { method: "POST", body: JSON.stringify({ reason }) },
    ),

  /**
   * Reset a user's password to a generated temporary one. The
   * plaintext is in the response — copy it to the operator's
   * clipboard before the dialog closes; nothing else can recover it.
   */
  resetUserPassword: (userId: string, reason?: string) =>
    api<ResetPasswordResult>(
      `/platform/users/${encodeURIComponent(userId)}/reset-password`,
      {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? undefined }),
      },
    ),
};
