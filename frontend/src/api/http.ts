const TOKEN_KEY = "pytrading212.accessToken";

// Fallback when web storage is unavailable (private mode): the token lives for this page only.
let memoryToken = "";

export class UnauthorizedError extends Error {
  constructor() {
    super("Jeton d'accès requis ou invalide");
    this.name = "UnauthorizedError";
  }
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

export function getAccessToken(): string {
  return (
    readStorage(() => window.sessionStorage, TOKEN_KEY) ??
    readStorage(() => window.localStorage, TOKEN_KEY) ??
    memoryToken
  );
}

export function saveAccessToken(token: string, remember: boolean): void {
  clearAccessToken();
  try {
    (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    memoryToken = token;
  }
}

export function clearAccessToken(): void {
  memoryToken = "";
  for (const storage of [() => window.sessionStorage, () => window.localStorage]) {
    try {
      storage().removeItem(TOKEN_KEY);
    } catch {
      // ignore
    }
  }
}

function extractErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.length > 0) {
      return detail;
    }
    if (Array.isArray(detail) && detail.length > 0) {
      return detail
        .map((item) => (item && typeof item === "object" && "msg" in item ? String(item.msg) : ""))
        .filter(Boolean)
        .join(" ; ");
    }
  }

  if (status === 429) {
    return "Trading 212 limite temporairement les requêtes (429).";
  }

  return `Backend request failed (HTTP ${status})`;
}

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...init, headers });
  const payload = (await response.json().catch(() => null)) as unknown;

  if (response.status === 401) {
    unauthorizedHandler?.();
    throw new UnauthorizedError();
  }
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload, response.status));
  }

  return payload as T;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
