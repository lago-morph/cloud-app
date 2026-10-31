/**
 * `returnTo` sanitising (framework.openapi.yaml `/api/auth/login`, AUTH-AC-010): only a
 * same-origin path is kept; anything else becomes "/".
 *
 * Kept: starts with exactly one "/", contains no backslash, whitespace or control character,
 * percent-escapes decode, neither the raw nor the decoded path starts with "//" or "/\", and both
 * the raw and the decoded path resolve to the same origin. The decoded check matters because URL
 * parsers strip tab, LF and CR, so "/%09/evil.example" decodes to a scheme-relative URL
 * (root cause 2026-10-31-T4-return-to-decoded-tab-newline).
 */
const SAFE_CHARS = /^[\x21-\x7e]*$/;

export function sanitizeReturnTo(value: string | undefined | null): string {
  if (value === undefined || value === null) return "/";
  if (!value.startsWith("/") || !SAFE_CHARS.test(value) || value.includes("\\")) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  for (const path of [value, decoded]) {
    if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  }
  // Defence in depth: resolving either form against a placeholder origin must not leave it.
  const base = "http://return-to.invalid";
  for (const path of [value, decoded]) if (!URL.canParse(path, base) || new URL(path, base).origin !== base) return "/";
  return value;
}
