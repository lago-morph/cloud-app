/**
 * Session and transaction cookie settings (AUTH-REQ-006, auth.md §2 "Session cookie", "Login";
 * LOCAL-REQ-004). Both cookies: HttpOnly, SameSite=Lax, Path=/, no Domain. Locally they are named
 * `session_local` / `login_local` and not Secure; on cloud targets `__Host-session` /
 * `__Host-login` and Secure. The local relaxation is refused on any cloud target.
 */
import { FrameworkError } from "../core/errors.js";
import type { Target } from "../core/identity.js";

export type CookieMode = "local" | "cloud";

export interface CookieSettings {
  readonly session: string;
  readonly login: string;
  readonly secure: boolean;
}

const LOCAL: CookieSettings = Object.freeze({ session: "session_local", login: "login_local", secure: false });
const CLOUD: CookieSettings = Object.freeze({ session: "__Host-session", login: "__Host-login", secure: true });

/**
 * The settings for `target`. `mode` defaults to the target's own; asking for the local settings
 * on a cloud target is CORE.MISCONFIGURED (LOCAL-AC-004).
 */
export function cookieSettings(target: Target, mode: CookieMode = target === "local" ? "local" : "cloud"): CookieSettings {
  if (mode === "local" && target !== "local") {
    throw new FrameworkError("CORE.MISCONFIGURED", `local cookie settings (not Secure) are not allowed on the ${target} target`);
  }
  return mode === "local" ? LOCAL : CLOUD;
}

function attributes(settings: CookieSettings, maxAge: number): string {
  return `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${settings.secure ? "; Secure" : ""}`;
}

/** A Set-Cookie value; `value` must be cookie-safe (the tokens are base64url and "."). */
export function setCookie(settings: CookieSettings, name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; ${attributes(settings, maxAgeSeconds)}`;
}

export function clearCookie(settings: CookieSettings, name: string): string {
  return `${name}=; ${attributes(settings, 0)}`;
}

/** The non-empty value of cookie `name` in a Cookie header, if any (first occurrence). */
export function readCookie(header: string | undefined | null, name: string): string | undefined {
  if (header === undefined || header === null) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value === "" ? undefined : value;
  }
  return undefined;
}
