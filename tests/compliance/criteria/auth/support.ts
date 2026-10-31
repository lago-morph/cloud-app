/**
 * Shared helpers for the AUTH compliance criteria (C-T3): `Set-Cookie` parsing and the cookie
 * expectations of docs/components/auth.md AUTH-REQ-006 and §2 ("Session cookie", "Login").
 */
import { target } from "../../harness/index.js";

export interface SetCookie {
  readonly name: string;
  readonly value: string;
  /** Attribute names lowercased; values as sent (flags map to ""). */
  readonly attributes: ReadonlyMap<string, string>;
  readonly raw: string;
}

export function parseSetCookie(raw: string): SetCookie {
  const [pair = "", ...rest] = raw.split(";");
  const eq = pair.indexOf("=");
  const attributes = new Map<string, string>();
  for (const part of rest) {
    const i = part.indexOf("=");
    const key = (i < 0 ? part : part.slice(0, i)).trim().toLowerCase();
    if (key !== "") attributes.set(key, i < 0 ? "" : part.slice(i + 1).trim());
  }
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), attributes, raw };
}

export function setCookies(headers: Headers): SetCookie[] {
  return headers.getSetCookie().map(parseSetCookie);
}

export const isCloud = (): boolean => target().target !== "local";

/** auth.md §2: `session_local` locally, `__Host-session` on cloud targets. */
export const sessionCookieName = (cloud = isCloud()): string => (cloud ? "__Host-session" : "session_local");
/** auth.md §2 "Login" step 2: `login_local` locally, `__Host-login` on cloud targets. */
export const loginCookieName = (cloud = isCloud()): string => (cloud ? "__Host-login" : "login_local");

/** PAR-250 (12 hours, DEC-0791) and PAR-251 (10 minutes), in seconds. */
export const SESSION_LIFETIME_S = 12 * 60 * 60;
export const LOGIN_LIFETIME_S = 10 * 60;

/** The cookie's lifetime in seconds from Max-Age, else from Expires (relative to `now`). */
export function lifetimeSeconds(cookie: SetCookie, now = Date.now()): number | undefined {
  const maxAge = cookie.attributes.get("max-age");
  if (maxAge !== undefined) return Number(maxAge);
  const expires = cookie.attributes.get("expires");
  if (expires !== undefined) return Math.round((Date.parse(expires) - now) / 1000);
  return undefined;
}

/** True when the header deletes the cookie: empty value, Max-Age ≤ 0, or Expires in the past. */
export function clears(cookie: SetCookie, now = Date.now()): boolean {
  const life = lifetimeSeconds(cookie, now);
  return cookie.value === "" || (life !== undefined && life <= 0);
}

/**
 * The attribute problems of a login-state cookie (session or transaction), as AUTH-REQ-006
 * and auth.md §2 specify them: HttpOnly; SameSite=Lax; Path=/; no Domain (host-only); on cloud
 * targets also Secure and a `__Host-` name; the given lifetime (±60 s for Expires rounding).
 * Returns the list of problems (empty when the cookie is as specified).
 */
export function cookieProblems(cookie: SetCookie, expected: { readonly name: string; readonly lifetimeS: number; readonly cloud: boolean }): string[] {
  const problems: string[] = [];
  const a = cookie.attributes;
  if (cookie.name !== expected.name) problems.push(`name ${cookie.name}, expected ${expected.name}`);
  if (!a.has("httponly")) problems.push("not HttpOnly");
  if ((a.get("samesite") ?? "").toLowerCase() !== "lax") problems.push(`SameSite=${a.get("samesite") ?? "(absent)"}, expected Lax`);
  if (a.get("path") !== "/") problems.push(`Path=${a.get("path") ?? "(absent)"}, expected /`);
  if (a.has("domain")) problems.push(`Domain=${a.get("domain") ?? ""} set (cookie must be host-only)`);
  if (expected.cloud && !a.has("secure")) problems.push("not Secure on a cloud target");
  if (expected.cloud && !cookie.name.startsWith("__Host-")) problems.push("cloud cookie name lacks the __Host- prefix");
  const life = lifetimeSeconds(cookie);
  if (life === undefined || Math.abs(life - expected.lifetimeS) > 60) problems.push(`lifetime ${String(life)} s, expected ${String(expected.lifetimeS)} s`);
  if (cookie.value === "") problems.push("empty value");
  return problems;
}

/** The cookie value with one character changed at `index` (to another base64url character). */
export function tamper(value: string, index: number): string {
  const i = ((index % value.length) + value.length) % value.length;
  const ch = value[i] ?? "A";
  const replacement = ch === "A" ? "B" : "A";
  return `${value.slice(0, i)}${replacement}${value.slice(i + 1)}`;
}
