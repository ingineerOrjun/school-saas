/**
 * Tiny typed HTTP client. Attaches the JWT from localStorage automatically
 * and normalizes NestJS error responses into `ApiError`.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiOptions extends RequestInit {
  auth?: boolean;
}

export async function api<T = unknown>(
  path: string,
  init: ApiOptions = {},
): Promise<T> {
  const { auth = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (!headers.has("Content-Type") && rest.body) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...rest, headers });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON body */
    }
    throw new ApiError(res.status, extractMessage(body) ?? res.statusText, body);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("scholaris:token");
  } catch {
    return null;
  }
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return;
  const obj = body as Record<string, unknown>;
  // Our Nest filter wraps: { statusCode, message: { message, error, statusCode } }
  // Simpler shapes: { message: "..." } or { message: ["..."] }
  if (typeof obj.message === "string") return obj.message;
  if (obj.message && typeof obj.message === "object") {
    const inner = obj.message as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
    if (Array.isArray(inner.message))
      return (inner.message as string[]).join(", ");
  }
  return undefined;
}
