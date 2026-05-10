import { api } from "./api";

// ---------------------------------------------------------------------------
// Productization client (Phase 23). Mirrors the backend
// ProductizationModule surface — school-side at /me/* and
// platform-side at /platform/*.
// ---------------------------------------------------------------------------

// ---- Onboarding ----------------------------------------------------------

export type OnboardingStep =
  | "school-profile"
  | "academic-setup"
  | "staff-setup"
  | "fee-setup"
  | "complete";

export interface OnboardingStepStatus {
  slug: OnboardingStep;
  done: boolean;
  detail: string;
}

export interface OnboardingStatus {
  schoolId: string;
  currentStep: OnboardingStep;
  completed: boolean;
  completionPct: number;
  steps: OnboardingStepStatus[];
}

// ---- Invitations ---------------------------------------------------------

export type InvitationRole = "ADMIN" | "TEACHER" | "STUDENT" | "SUPER_ADMIN";

export interface InvitationRow {
  id: string;
  schoolId: string;
  email: string;
  role: InvitationRole;
  displayName: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  invitedById: string;
  acceptedUserId: string | null;
  createdAt: string;
  updatedAt: string;
  isPending: boolean;
}

export interface InvitationPreview {
  schoolName: string;
  schoolSlug: string;
  email: string;
  role: InvitationRole;
  displayName: string | null;
  expiresAt: string;
  isPending: boolean;
}

// ---- Branding ------------------------------------------------------------

export interface BrandConfig {
  appName: string;
  supportEmail: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  slogan: string | null;
  receiptFooter: string | null;
  footerAddress: string | null;
  isCustomized: boolean;
}

// ---- Announcements -------------------------------------------------------

export type AnnouncementAudience =
  | "ALL_SCHOOLS"
  | "ADMINS_ONLY"
  | "TEACHERS_ONLY"
  | "SPECIFIC_SCHOOLS";

export interface AnnouncementRow {
  id: string;
  title: string;
  body: string;
  tone: string;
  audience: AnnouncementAudience;
  targetSchoolIds: string[];
  publishedById: string;
  publishedByEmail: string | null;
  active: boolean;
  linkUrl: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  dismissCount: number;
}

// ---- Support notes -------------------------------------------------------

export interface SupportNoteRow {
  id: string;
  schoolId: string;
  authorId: string;
  authorEmail: string | null;
  body: string;
  tone: string | null;
  createdAt: string;
}

// ---- Guardians -----------------------------------------------------------

export interface GuardianRow {
  id: string;
  schoolId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  notes: string | null;
  hasUserAccount: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GuardianWithLinksRow extends GuardianRow {
  links: Array<{
    id: string;
    guardianId: string;
    studentId: string;
    isPrimary: boolean;
    relationship: string | null;
    createdAt: string;
    student: { id: string; firstName: string; lastName: string };
  }>;
}

// ---- Exports / Imports ---------------------------------------------------

export interface ExportRunRow {
  id: string;
  schoolId: string;
  requestedById: string;
  entity: string;
  format: string;
  status: string;
  outputUrl: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportRunRow {
  id: string;
  schoolId: string;
  requestedById: string;
  entity: string;
  filename: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  importedRows: number;
  status: string;
  dryRunSummary: unknown;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

// ---- Deployment / adoption -----------------------------------------------

export interface DeploymentInfo {
  appName: string;
  version: string;
  buildSha: string | null;
  buildTimestamp: string | null;
  environment: string;
  uptimeSec: number;
  startedAt: string;
  migrations: { applied: number; inSync: boolean };
}

export interface UpgradeCheck {
  key: string;
  label: string;
  status: "ok" | "warn" | "block";
  detail: string;
}

export interface UpgradeSafetyReport {
  generatedAt: string;
  checks: UpgradeCheck[];
  safe: boolean;
}

export interface AdoptionMetrics {
  generatedAt: string;
  activeSchoolsLast7d: number;
  dau: number;
  wau: number;
  attendanceUsageSchools: number;
  feesUsageSchools: number;
  featureAdoption: Array<{ key: string; enabledCount: number }>;
}

// ---------------------------------------------------------------------------
// API surface
// ---------------------------------------------------------------------------

export const productizationApi = {
  // Onboarding
  getOnboarding: () => api<OnboardingStatus>("/me/onboarding"),
  setOnboardingStep: (step: OnboardingStep) =>
    api<OnboardingStatus>("/me/onboarding/step", {
      method: "PATCH",
      body: JSON.stringify({ step }),
    }),
  completeOnboarding: () =>
    api<OnboardingStatus>("/me/onboarding/complete", { method: "POST" }),

  // Invitations
  listInvitations: () => api<InvitationRow[]>("/me/invitations"),
  createInvitation: (input: {
    email: string;
    role: InvitationRole;
    displayName?: string;
  }) =>
    api<InvitationRow>("/me/invitations", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resendInvitation: (id: string) =>
    api<InvitationRow>(`/me/invitations/${encodeURIComponent(id)}/resend`, {
      method: "POST",
    }),
  revokeInvitation: (id: string) =>
    api<InvitationRow>(`/me/invitations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  previewInvitation: (token: string) =>
    api<InvitationPreview>(
      `/me/invitations/preview/${encodeURIComponent(token)}`,
      { auth: false },
    ),
  acceptInvitation: (input: {
    token: string;
    password: string;
    displayName?: string;
  }) =>
    api<{ user: { id: string; email: string; role: string; schoolId: string } }>(
      "/me/invitations/accept",
      { method: "POST", body: JSON.stringify(input), auth: false },
    ),

  // Branding
  getBranding: () => api<BrandConfig>("/me/branding"),
  setBranding: (input: {
    brandPrimaryColor?: string | null;
    brandAccentColor?: string | null;
    brandSlogan?: string | null;
    brandReceiptFooter?: string | null;
  }) =>
    api<BrandConfig>("/me/branding", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  // Announcements (school-side read + dismiss)
  listActiveAnnouncements: () =>
    api<AnnouncementRow[]>("/me/announcements"),
  dismissAnnouncement: (id: string) =>
    api<{ dismissed: true }>(
      `/me/announcements/${encodeURIComponent(id)}/dismiss`,
      { method: "POST" },
    ),

  // Guardians
  listGuardians: () => api<GuardianWithLinksRow[]>("/me/guardians"),
  createGuardian: (input: {
    fullName: string;
    email?: string;
    phone?: string;
    relationship?: string;
    notes?: string;
  }) =>
    api<GuardianRow>("/me/guardians", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateGuardian: (
    id: string,
    input: Partial<{
      fullName: string;
      email: string | null;
      phone: string | null;
      relationship: string | null;
      notes: string | null;
    }>,
  ) =>
    api<GuardianRow>(`/me/guardians/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  removeGuardian: (id: string) =>
    api<void>(`/me/guardians/${encodeURIComponent(id)}`, { method: "DELETE" }),
  linkGuardian: (input: {
    guardianId: string;
    studentId: string;
    isPrimary?: boolean;
    relationship?: string;
  }) =>
    api<unknown>(
      `/me/guardians/${encodeURIComponent(input.guardianId)}/links`,
      {
        method: "POST",
        body: JSON.stringify({
          studentId: input.studentId,
          isPrimary: input.isPrimary,
          relationship: input.relationship,
        }),
      },
    ),
  unlinkGuardian: (input: { guardianId: string; studentId: string }) =>
    api<void>(
      `/me/guardians/${encodeURIComponent(input.guardianId)}/links/${encodeURIComponent(input.studentId)}`,
      { method: "DELETE" },
    ),
  listGuardiansForStudent: (studentId: string) =>
    api<GuardianRow[]>(
      `/me/students/${encodeURIComponent(studentId)}/guardians`,
    ),

  // Exports
  createExport: (input: {
    entity: "students" | "fees" | "attendance" | "results" | "audit";
    format: "csv" | "xlsx" | "pdf";
  }) =>
    api<ExportRunRow>("/me/exports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listExports: () => api<ExportRunRow[]>("/me/exports"),

  // Imports
  dryRunImport: (input: {
    entity: "students" | "teachers" | "fee_structures";
    filename: string;
    csv: string;
  }) =>
    api<ImportRunRow>("/me/imports/dry-run", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  commitImport: (id: string) =>
    api<ImportRunRow>(`/me/imports/${encodeURIComponent(id)}/commit`, {
      method: "POST",
    }),
  listImports: () => api<ImportRunRow[]>("/me/imports"),

  // ---- Platform-tier ----

  listPlatformAnnouncements: () =>
    api<AnnouncementRow[]>("/platform/announcements"),
  publishAnnouncement: (input: {
    title: string;
    body: string;
    tone?: string;
    audience: AnnouncementAudience;
    targetSchoolIds?: string[];
    linkUrl?: string;
    expiresAt?: string;
  }) =>
    api<AnnouncementRow>("/platform/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  retireAnnouncement: (id: string) =>
    api<AnnouncementRow>(
      `/platform/announcements/${encodeURIComponent(id)}/retire`,
      { method: "POST" },
    ),
  getSchoolOnboarding: (schoolId: string) =>
    api<OnboardingStatus>(
      `/platform/schools/${encodeURIComponent(schoolId)}/onboarding`,
    ),
  resetSchoolOnboarding: (schoolId: string) =>
    api<OnboardingStatus>(
      `/platform/schools/${encodeURIComponent(schoolId)}/onboarding/reset`,
      { method: "POST" },
    ),
  listSupportNotes: (schoolId: string) =>
    api<SupportNoteRow[]>(
      `/platform/schools/${encodeURIComponent(schoolId)}/support-notes`,
    ),
  createSupportNote: (
    schoolId: string,
    input: { body: string; tone?: string },
  ) =>
    api<SupportNoteRow>(
      `/platform/schools/${encodeURIComponent(schoolId)}/support-notes`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  getDeployment: () => api<DeploymentInfo>("/platform/deployment"),
  getUpgradeSafety: () =>
    api<UpgradeSafetyReport>("/platform/deployment/upgrade-safety"),
  getAdoption: () => api<AdoptionMetrics>("/platform/deployment/adoption"),
};
