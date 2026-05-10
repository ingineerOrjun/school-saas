import { api } from "./api";

// ---------------------------------------------------------------------------
// Operations Center API client — types + endpoints mirror the backend
// OperationsController exactly (one method per ops section).
//
// Every endpoint requires a SUPER_ADMIN session. Mounted under
// /platform/operations so the existing platform throttle bucket
// (300/min/user) covers it.
// ---------------------------------------------------------------------------

export type OpsWindow = "15m" | "1h" | "24h";
export type SeverityTone = "green" | "amber" | "red";
export type SubsystemStatus = "HEALTHY" | "DEGRADED" | "DOWN";

// Section 1 — Live overview ---------------------------------------------------

export interface OpsOverview {
  generatedAt: string;
  activeSchools: number;
  onlineUsers: number;
  activeSessions: number;
  requestsPerMin: number;
  queueDepth: number;
  failedJobsLastHour: number;
  errorsLastHour: number;
  errorRatePct5m: number;
  avgLatencyMs5m: number;
  activeImpersonations: number;
  activeIncidents: number;
  subsystemStatus: SubsystemStatus;
  severityTones: {
    requests: SeverityTone;
    queue: SeverityTone;
    errors: SeverityTone;
    incidents: SeverityTone;
  };
}

// Section 2 — Request monitoring ---------------------------------------------

export interface EndpointWindowStat {
  routeKey: string;
  count: number;
  avgDurationMs: number;
  p95DurationMs: number;
  errors4xx: number;
  errors5xx: number;
  throttled: number;
}

export interface RpmBucket {
  at: string;
  count: number;
  errors: number;
  throttled: number;
}

export interface OpsRequestMonitoring {
  generatedAt: string;
  window: OpsWindow;
  totals: {
    requests: number;
    errors: number;
    throttled: number;
    avgDurationMs: number;
    errorRatePct: number;
  };
  topByVolume: EndpointWindowStat[];
  slowest: EndpointWindowStat[];
  mostThrottled: EndpointWindowStat[];
  errorHeavy: EndpointWindowStat[];
  rpmSeries: RpmBucket[];
}

// Section 3 — Job queue monitor ----------------------------------------------

export type JobStatus =
  | "PENDING"
  | "SCHEDULED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD";

export interface JobRow {
  id: string;
  name: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface PerHandlerRow {
  name: string;
  total: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
}

export interface OpsJobMonitor {
  generatedAt: string;
  queue: Record<JobStatus, number>;
  perHandler: PerHandlerRow[];
  recentFailed: JobRow[];
  recentPending: JobRow[];
}

export interface JobInspectRow extends JobRow {
  payload: unknown;
  dedupeKey: string | null;
  updatedAt: string;
}

// Section 4 — Subsystem health ------------------------------------------------

export interface SubsystemHealth {
  key: string;
  label: string;
  status: SubsystemStatus;
  detail: string;
  checkedAt: string;
  uptime24h: number;
}

export interface OpsHealth {
  generatedAt: string;
  subsystems: SubsystemHealth[];
  worstStatus: SubsystemStatus;
}

// Section 5 — Security feed ---------------------------------------------------

export type SecurityEventCategory =
  | "FAILED_LOGIN"
  | "FORCE_LOGOUT"
  | "PASSWORD_RESET"
  | "IMPERSONATION"
  | "MAINTENANCE"
  | "ROLE_CHANGE"
  | "THROTTLE_SPIKE";

export interface OpsSecurityEvent {
  id: string;
  category: SecurityEventCategory;
  severity: SeverityTone;
  at: string;
  actor: string | null;
  schoolName: string | null;
  description: string;
  sourceId: string | null;
}

export interface OpsSecurityFeed {
  generatedAt: string;
  events: OpsSecurityEvent[];
}

// Section 6 — Session monitor ------------------------------------------------

export interface OpsSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ip: string | null;
  userAgent: string | null;
  user: { id: string; email: string; role: string };
  school: { id: string; name: string; slug: string } | null;
  online: boolean;
}

export interface OpsSessionMonitor {
  generatedAt: string;
  totals: { active: number; onlineLast15m: number };
  rows: OpsSession[];
}

// Section 7 — School health grid ---------------------------------------------

export interface OpsSchoolHealthRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string | null;
  onlineUsers: number;
  activityCount24h: number;
  queueFailures24h: number;
  latestCritical: {
    title: string;
    severity: string;
    createdAt: string;
  } | null;
}

export interface OpsSchoolHealth {
  generatedAt: string;
  rows: OpsSchoolHealthRow[];
}

// Section 8 — Event stream ---------------------------------------------------

export type OpsEventKind =
  | "AUDIT"
  | "FAILED_JOB"
  | "FAILED_DELIVERY"
  | "ERROR"
  | "LOGIN_FAIL"
  | "INCIDENT";

export interface OpsEvent {
  id: string;
  at: string;
  kind: OpsEventKind;
  severity: SeverityTone;
  description: string;
  tag: string | null;
}

export interface OpsEventStream {
  generatedAt: string;
  events: OpsEvent[];
}

// Section 9 — Incident broadcast (Phase 22 — persistent shape) -------------

export type IncidentSeverity = "INFO" | "WARNING" | "CRITICAL";
export type IncidentStatus = "ACTIVE" | "RESOLVED";
export type IncidentScope = "ALL_SCHOOLS" | "SPECIFIC_SCHOOLS";

export interface Incident {
  id: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  title: string;
  body: string;
  targetScope: IncidentScope;
  targetSchoolIds: string[];
  createdById: string;
  resolvedById: string | null;
  resolvedAt: string | null;
  inAppFanOut: number;
  emailFanOut: number;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BroadcastIncidentInput {
  severity: IncidentSeverity;
  title: string;
  body: string;
  targetScope: IncidentScope;
  targetSchoolIds: string[];
  reason?: string;
}

// Phase 22 — Section 8 — Abuse detection -----------------------------------

export interface OpsAbuseDetection {
  generatedAt: string;
  topThrottledIps: Array<{ ip: string; count: number }>;
  topThrottledUsers: Array<{ userId: string; count: number }>;
  topThrottledRoutes: Array<{ routeKey: string; count: number }>;
  abuseDetected: boolean;
}

// Phase 22 — Section 2 — Dead letter queue ---------------------------------

export interface DeadLetterRow {
  id: string;
  name: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  completedAt: string | null;
  correlationId: string | null;
  payload: unknown;
}

export interface OpsDeadLetterQueue {
  generatedAt: string;
  rows: DeadLetterRow[];
}

// Phase 22 — Section 3 — Circuit breakers ----------------------------------

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastTransitionAt: string;
  nextHalfOpenAt: string | null;
  totalSuccess: number;
  totalFailure: number;
  totalShortCircuited: number;
}

export interface OpsBreakers {
  generatedAt: string;
  breakers: CircuitSnapshot[];
}

// Phase 22 — Section 5 — Correlation lookup --------------------------------

export interface OpsCorrelationTrace {
  correlationId: string;
  generatedAt: string;
  audit: Array<{
    id: string;
    action: string;
    actor: string | null;
    target: string | null;
    at: string;
  }>;
  jobs: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
    lastError: string | null;
  }>;
  notifications: Array<{
    id: string;
    templateKey: string;
    severity: string;
    title: string | null;
    createdAt: string;
  }>;
  incidents: Incident[];
}

// Phase 22 — Section 11 — Backups ------------------------------------------

export interface BackupCapability {
  configured: boolean;
  storageProvider: string | null;
  lastSuccessAt: string | null;
  notice: string;
}

export interface BackupSnapshot {
  id: string;
  kind: "FULL" | "INCREMENTAL" | "WAL";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  storage: string;
  location: string;
  sizeBytes: number;
  sha256: string | null;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  pitrAnchor: string;
}

export interface OpsBackups {
  capability: BackupCapability;
  snapshots: BackupSnapshot[];
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const operationsApi = {
  /** Section 1 — eight-stat live KPI row. */
  getOverview: () => api<OpsOverview>("/platform/operations/overview"),

  /** Section 2 — request monitoring for the chosen window. */
  getRequests: (window: OpsWindow) =>
    api<OpsRequestMonitoring>(
      `/platform/operations/requests?window=${encodeURIComponent(window)}`,
    ),

  /** Section 3 — queue overview (stats, per-handler, recent rows). */
  getJobs: () => api<OpsJobMonitor>("/platform/operations/jobs"),

  inspectJob: (jobId: string) =>
    api<JobInspectRow>(
      `/platform/operations/jobs/${encodeURIComponent(jobId)}`,
    ),

  retryJob: (jobId: string) =>
    api<JobRow>(
      `/platform/operations/jobs/${encodeURIComponent(jobId)}/retry`,
      { method: "POST" },
    ),

  cancelJob: (jobId: string) =>
    api<JobRow>(
      `/platform/operations/jobs/${encodeURIComponent(jobId)}/cancel`,
      { method: "POST" },
    ),

  /** Section 4 — subsystem health grid. */
  getHealth: () => api<OpsHealth>("/platform/operations/health"),

  /** Section 5 — security feed. */
  getSecurity: (input: { limit?: number; schoolId?: string } = {}) => {
    const params = new URLSearchParams();
    if (input.limit) params.set("limit", String(input.limit));
    if (input.schoolId) params.set("schoolId", input.schoolId);
    const qs = params.toString();
    return api<OpsSecurityFeed>(
      qs
        ? `/platform/operations/security?${qs}`
        : "/platform/operations/security",
    );
  },

  /** Section 6 — cross-tenant session monitor. */
  getSessions: (
    input: {
      q?: string;
      schoolId?: string;
      onlyOnline?: boolean;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.schoolId) params.set("schoolId", input.schoolId);
    if (input.onlyOnline) params.set("onlyOnline", "true");
    if (input.limit) params.set("limit", String(input.limit));
    const qs = params.toString();
    return api<OpsSessionMonitor>(
      qs
        ? `/platform/operations/sessions?${qs}`
        : "/platform/operations/sessions",
    );
  },

  revokeSession: (userId: string, sessionId: string) =>
    api<unknown>(
      `/platform/operations/sessions/${encodeURIComponent(userId)}/${encodeURIComponent(sessionId)}/revoke`,
      { method: "POST" },
    ),

  revokeAllSessions: (userId: string) =>
    api<unknown>(
      `/platform/operations/users/${encodeURIComponent(userId)}/sessions/revoke-all`,
      { method: "POST" },
    ),

  /** Section 7 — school health grid. */
  getSchools: () => api<OpsSchoolHealth>("/platform/operations/schools"),

  /** Section 8 — event ticker. */
  getEvents: (limit?: number) =>
    api<OpsEventStream>(
      limit
        ? `/platform/operations/events?limit=${limit}`
        : "/platform/operations/events",
    ),

  /** Section 9 — incidents. */
  listIncidents: (activeOnly = false) =>
    api<Incident[]>(
      activeOnly
        ? "/platform/operations/incidents?activeOnly=true"
        : "/platform/operations/incidents",
    ),

  broadcastIncident: (input: BroadcastIncidentInput) =>
    api<Incident>("/platform/operations/incidents", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  resolveIncident: (incidentId: string) =>
    api<Incident>(
      `/platform/operations/incidents/${encodeURIComponent(incidentId)}/resolve`,
      { method: "POST" },
    ),

  // Phase 22 — Section 8: abuse detection ----------------------------------

  getAbuse: () => api<OpsAbuseDetection>("/platform/operations/abuse"),

  // Phase 22 — Section 2: dead-letter queue --------------------------------

  getDeadLetters: (input: { name?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (input.name) params.set("name", input.name);
    if (input.limit) params.set("limit", String(input.limit));
    const qs = params.toString();
    return api<OpsDeadLetterQueue>(
      qs
        ? `/platform/operations/dead-letters?${qs}`
        : "/platform/operations/dead-letters",
    );
  },

  bulkRetryDeadLetters: (input: { name?: string; limit?: number } = {}) =>
    api<{ retried: number }>("/platform/operations/dead-letters/retry", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Phase 22 — Section 3: circuit breakers ---------------------------------

  getBreakers: () => api<OpsBreakers>("/platform/operations/breakers"),

  // Phase 22 — Section 5: correlation inspector ----------------------------

  getCorrelationTrace: (correlationId: string) =>
    api<OpsCorrelationTrace>(
      `/platform/operations/correlation/${encodeURIComponent(correlationId)}`,
    ),

  // Phase 22 — Section 10: maintenance sweep -------------------------------

  triggerMaintenanceSweep: () =>
    api<{ enabled: number; disabled: number }>(
      "/platform/operations/maintenance/sweep",
      { method: "POST" },
    ),

  // Phase 22 — Section 4: cleanup runner -----------------------------------

  triggerCleanup: () =>
    api<{
      notifications: number;
      sessions: number;
      incidents: number;
      jobs: number;
    }>("/platform/operations/cleanup/run", { method: "POST" }),

  // Phase 22 — Section 11: backups -----------------------------------------

  getBackups: () => api<OpsBackups>("/platform/operations/backups"),
};
