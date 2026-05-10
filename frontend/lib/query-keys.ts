/**
 * Centralized query key factory.
 *
 * Every React Query call should pull its key from `qk` instead of
 * inlining a string array. Two consumers using `qk.classes()` get
 * the SAME cache entry; if one inlined `['classes']` and another
 * inlined `['Classes']` you'd silently get two caches and double
 * the network calls — exactly the bug we're fixing.
 *
 * Conventions:
 *   • Top-level groups are noun-keyed: classes, students, etc.
 *   • Filter-bearing keys are functions: `qk.notifications.list({...})`
 *   • Filter shape inside a key MUST be normalised (sort arrays,
 *     default empties) so equivalent filters share a key. Where
 *     normalisation is non-trivial, the helper does it inline.
 *   • The hierarchy of keys mirrors invalidation scope: `qk.classes()`
 *     invalidates everything classes-related; child keys can be
 *     invalidated more narrowly.
 */

// ---------------------------------------------------------------------------
// School-side reference data (long staleTime — operator writes only)
// ---------------------------------------------------------------------------

export const qk = {
  // ---- Auth / current user ----
  me: ["me"] as const,
  /** Resolved feature map + catalog for the calling user. */
  meFeatures: ["me", "features"] as const,
  /** User's own session list. */
  meSessions: ["me", "sessions"] as const,

  // ---- Reference data (10m staleTime suggested) ----
  classes: () => ["classes"] as const,
  /** All sections at the school. */
  sections: () => ["sections"] as const,
  /** Sections under one class. */
  sectionsForClass: (classId: string) => ["sections", "byClass", classId] as const,
  subjects: () => ["subjects"] as const,
  teachers: () => ["teachers"] as const,
  /**
   * Teacher's own assignments — function-form key consumed by
   * `useMyTeachingAssignments()`. Used by the teacher dashboard,
   * the attendance picker, and all three exam-marks pages — all
   * share this single cache entry per stale window.
   */
  myAssignments: () => ["teaching-assignments", "mine"] as const,

  // ---- Academic sessions (10m — but `selected` is set ad-hoc) ----
  academicSessions: () => ["academic-sessions"] as const,

  // ---- Students (1m — moves with enrollment) ----
  students: (filters?: { classId?: string; sectionId?: string; q?: string }) =>
    [
      "students",
      {
        classId: filters?.classId ?? null,
        sectionId: filters?.sectionId ?? null,
        q: filters?.q ?? "",
      },
    ] as const,
  studentDetail: (id: string) => ["students", "detail", id] as const,

  // ---- Attendance (1m — daily writes) ----
  attendance: (filters: {
    classId?: string;
    sectionId?: string;
    date?: string;
  }) =>
    [
      "attendance",
      {
        classId: filters.classId ?? null,
        sectionId: filters.sectionId ?? null,
        date: filters.date ?? null,
      },
    ] as const,

  // ---- Exams + results (1m) ----
  exams: () => ["exams"] as const,
  examDetail: (id: string) => ["exams", "detail", id] as const,
  results: (filters: { examId?: string; studentId?: string }) =>
    [
      "results",
      {
        examId: filters.examId ?? null,
        studentId: filters.studentId ?? null,
      },
    ] as const,

  // ---- Fees + payments (30s — cashier-driven) ----
  feeStructures: () => ["fees", "structures"] as const,
  feeAssignments: (filters: { studentId?: string; classId?: string }) =>
    [
      "fees",
      "assignments",
      {
        studentId: filters.studentId ?? null,
        classId: filters.classId ?? null,
      },
    ] as const,
  payments: (filters?: { studentId?: string; from?: string; to?: string }) =>
    [
      "payments",
      {
        studentId: filters?.studentId ?? null,
        from: filters?.from ?? null,
        to: filters?.to ?? null,
      },
    ] as const,

  // ---- Announcements (30s) ----
  announcements: (sessionId?: string | null) =>
    ["announcements", { sessionId: sessionId ?? null }] as const,

  // ---- Dashboard rollups (1m) ----
  dashboardSummary: ["dashboard", "summary"] as const,
  dashboardTeacherSummary: ["dashboard", "teacher-summary"] as const,

  // ---- Notifications (school-side) — wired in lib/notifications.tsx
  // Re-exported here so cross-module invalidation goes through one
  // taxonomy. notification-keys.ts lives in lib/notifications.tsx;
  // these aliases mirror the same shape so they invalidate together.
  notifications: {
    all: ["notifications"] as const,
    unreadCount: ["notifications", "unread-count"] as const,
    list: (filters: {
      severity?: string[];
      unreadOnly?: boolean;
      page?: number;
      pageSize?: number;
    }) =>
      [
        "notifications",
        "list",
        {
          severity: filters.severity ? [...filters.severity].sort() : [],
          unreadOnly: !!filters.unreadOnly,
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 25,
        },
      ] as const,
    detail: (id: string) => ["notifications", "detail", id] as const,
  },

  // ---- Platform layer (SUPER_ADMIN only) ----
  platform: {
    overview: ["platform", "overview"] as const,
    /** Live operator pulse — short staleTime + refetchInterval on the page. */
    health: ["platform", "health"] as const,
    /** Cross-cutting analytics — slow lane, 2m staleTime. */
    analytics: ["platform", "analytics"] as const,
    schoolsList: (filters: {
      q?: string;
      status?: string;
      page?: number;
      pageSize?: number;
    }) =>
      [
        "platform",
        "schools",
        "list",
        {
          q: filters.q ?? "",
          status: filters.status ?? "",
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 25,
        },
      ] as const,
    schoolDetail: (id: string) => ["platform", "schools", id] as const,
    schoolSnapshot: (id: string) =>
      ["platform", "schools", id, "snapshot"] as const,
    schoolFeatures: (id: string) =>
      ["platform", "schools", id, "features"] as const,
    schoolSessions: (id: string) =>
      ["platform", "schools", id, "sessions"] as const,
    audit: (filters: {
      action?: string;
      actorUserId?: string;
      targetType?: string;
      targetId?: string;
      q?: string;
      fromDate?: string;
      toDate?: string;
      page?: number;
      pageSize?: number;
    }) =>
      [
        "platform",
        "audit",
        {
          action: filters.action ?? "",
          actorUserId: filters.actorUserId ?? "",
          targetType: filters.targetType ?? "",
          targetId: filters.targetId ?? "",
          q: filters.q ?? "",
          fromDate: filters.fromDate ?? "",
          toDate: filters.toDate ?? "",
          page: filters.page ?? 1,
          pageSize: filters.pageSize ?? 25,
        },
      ] as const,
    notificationCenter: {
      list: (filters: {
        severity?: string[];
        unreadOnly?: boolean;
        schoolId?: string;
        page?: number;
        pageSize?: number;
      }) =>
        [
          "platform",
          "notifications",
          "list",
          {
            severity: filters.severity ? [...filters.severity].sort() : [],
            unreadOnly: !!filters.unreadOnly,
            schoolId: filters.schoolId ?? "",
            page: filters.page ?? 1,
            pageSize: filters.pageSize ?? 25,
          },
        ] as const,
      unreadCount: ["platform", "notifications", "unread-count"] as const,
      detail: (id: string) => ["platform", "notifications", id] as const,
    },
    /**
     * Operations Center (Phase 21). Sectional keys so each section
     * can poll on its own cadence — fast-lane ones (overview,
     * health, events) at 15s; slow-lane ones (schools grid) at 60s.
     */
    operations: {
      overview: ["platform", "operations", "overview"] as const,
      requests: (window: "15m" | "1h" | "24h") =>
        ["platform", "operations", "requests", window] as const,
      jobs: ["platform", "operations", "jobs"] as const,
      jobDetail: (id: string) =>
        ["platform", "operations", "jobs", id] as const,
      health: ["platform", "operations", "health"] as const,
      security: (filters: { schoolId?: string; limit?: number }) =>
        [
          "platform",
          "operations",
          "security",
          {
            schoolId: filters.schoolId ?? "",
            limit: filters.limit ?? 50,
          },
        ] as const,
      sessions: (filters: {
        q?: string;
        schoolId?: string;
        onlyOnline?: boolean;
      }) =>
        [
          "platform",
          "operations",
          "sessions",
          {
            q: filters.q ?? "",
            schoolId: filters.schoolId ?? "",
            onlyOnline: !!filters.onlyOnline,
          },
        ] as const,
      schools: ["platform", "operations", "schools"] as const,
      events: (limit?: number) =>
        ["platform", "operations", "events", limit ?? 30] as const,
      incidents: (activeOnly: boolean) =>
        ["platform", "operations", "incidents", { activeOnly }] as const,
      // Phase 22 additions
      abuse: ["platform", "operations", "abuse"] as const,
      deadLetters: (filters: { name?: string }) =>
        [
          "platform",
          "operations",
          "dead-letters",
          { name: filters.name ?? "" },
        ] as const,
      breakers: ["platform", "operations", "breakers"] as const,
      backups: ["platform", "operations", "backups"] as const,
      correlation: (id: string) =>
        ["platform", "operations", "correlation", id] as const,
    },
  },
  // ---- Productization (Phase 23) ----
  productization: {
    onboarding: ["productization", "onboarding"] as const,
    invitations: ["productization", "invitations"] as const,
    invitationPreview: (token: string) =>
      ["productization", "invitations", "preview", token] as const,
    branding: ["productization", "branding"] as const,
    activeAnnouncements: ["productization", "announcements", "active"] as const,
    guardians: ["productization", "guardians"] as const,
    guardiansForStudent: (studentId: string) =>
      ["productization", "guardians", "byStudent", studentId] as const,
    exports: ["productization", "exports"] as const,
    imports: ["productization", "imports"] as const,
    platformAnnouncements: ["productization", "platform", "announcements"] as const,
    schoolOnboarding: (schoolId: string) =>
      ["productization", "platform", "onboarding", schoolId] as const,
    supportNotes: (schoolId: string) =>
      ["productization", "platform", "support-notes", schoolId] as const,
    deployment: ["productization", "platform", "deployment"] as const,
    upgradeSafety: ["productization", "platform", "upgrade-safety"] as const,
    adoption: ["productization", "platform", "adoption"] as const,
  },
} as const;
