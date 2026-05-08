import { ApiError, api } from "./api";

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  /** Path served by the backend at `/uploads/logos/<file>`. Null when unset. */
  logoUrl: string | null;
  /** Free-form postal address shown on receipts/marksheets. Null when unset. */
  address: string | null;
  /** Public phone number shown on receipts/marksheets. Null when unset. */
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSchoolInput {
  name?: string;
  /**
   * Empty string is treated as "clear" — the backend converts it to null
   * so admins can drop a previously-set value without a separate endpoint.
   */
  address?: string | null;
  phone?: string | null;
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Convert a server-relative `logoUrl` ("/uploads/logos/foo.png") to an
 * absolute URL the browser can load. Pass-through for already-absolute
 * URLs (e.g., a future S3 path) and `null`.
 */
export function resolveLogoUrl(logoUrl: string | null | undefined): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return logoUrl;
  return `${API_BASE}${logoUrl}`;
}

export const schoolApi = {
  get: () => api<SchoolDto>("/school"),
  update: (input: UpdateSchoolInput) =>
    api<SchoolDto>("/school", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  /**
   * Upload a logo file. Bypasses the typed `api()` helper because we
   * need raw FormData (the JSON helper would JSON.stringify it).
   */
  uploadLogo: async (file: File): Promise<SchoolDto> => {
    const fd = new FormData();
    fd.append("file", file);
    const token =
      typeof window !== "undefined"
        ? window.localStorage.getItem("scholaris:token")
        : null;
    const res = await fetch(`${API_BASE}/school/logo`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: fd,
    });
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON */
      }
      const msg =
        (body as { message?: string | { message?: string } })?.message;
      const text =
        typeof msg === "string"
          ? msg
          : typeof (msg as { message?: string })?.message === "string"
            ? (msg as { message: string }).message
            : res.statusText;
      throw new ApiError(res.status, text, body);
    }
    return res.json();
  },
  clearLogo: () =>
    api<SchoolDto>("/school/logo", { method: "DELETE" }),
};
