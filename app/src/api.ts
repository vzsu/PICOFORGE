// app/src/api.ts — typed fetch wrapper for the local server's REST API.
// Every REST request needs the boot token (docs/04 §8). The server prints the app URL with
// `?t=<token>`; the router accepts it as the `X-PicoForge-Token` header (server/http/router.ts).

export const TOKEN_HEADER = "X-PicoForge-Token";

/** Boot token from the page URL (`?t=`), or "" when the page was opened without one. */
export function pageToken(): string {
  return new URLSearchParams(globalThis.location?.search ?? "").get("t") ?? "";
}

/** `fetch` against the local server with the boot token attached. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = pageToken();
  if (token) headers.set(TOKEN_HEADER, token);
  return fetch(path, { ...init, headers });
}

/** Response body as `unknown`; callers narrow it with a type guard before use. */
export async function readJson(res: Response): Promise<unknown> {
  const value: unknown = await res.json();
  return value;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
