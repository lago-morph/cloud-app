/**
 * Session and transaction cookie settings (AUTH-REQ-006, auth.md §2 "Session cookie", "Login";
 * LOCAL-REQ-004). Both cookies: HttpOnly, SameSite=Lax, Path=/, no Domain. On cloud targets
 * `__Host-session` / `__Host-login` and Secure. The local settings (not Secure) live in
 * `local-cookies.ts`, which only the local runtime and `createTestApp` import, so cloud bundles
 * never carry them (DEC-0195); any non-Secure settings are refused on a cloud target.
 */
import { FrameworkError } from "../core/errors.js";
import type { Target } from "../core/identity.js";

export interface CookieSettings {
  readonly session: string;
  readonly login: string;
  readonly secure: boolean;
}

export const CLOUD_COOKIES: CookieSettings = Object.freeze({ session: "__Host-session", login: "__Host-login", secure: true });

/**
 * The settings for `target`: `settings` when given (the local runtime passes `LOCAL_COOKIES`),
 * otherwise the cloud settings. Non-Secure settings on a cloud target are CORE.MISCONFIGURED
 * (LOCAL-AC-004).
 */
export function cookieSettings(target: Target, settings: CookieSettings = CLOUD_COOKIES): CookieSettings {
  if (!settings.secure && target !== "local") {
    throw new FrameworkError("CORE.MISCONFIGURED", `local cookie settings (not Secure) are not allowed on the ${target} target`);
  }
  return settings;
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
