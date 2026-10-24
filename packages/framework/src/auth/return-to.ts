/**
 * `returnTo` sanitising (framework.openapi.yaml `/api/auth/login`, AUTH-AC-010): only a
 * same-origin path is kept; anything else becomes "/".
 *
 * Kept: starts with exactly one "/", contains no backslash, whitespace or control character,
 * percent-escapes decode, and neither the raw nor the decoded path starts with "//" or "/\".
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
  // Defence in depth: resolving against a placeholder origin must not leave it.
  const base = "http://return-to.invalid";
  if (new URL(value, base).origin !== base) return "/";
  return value;
}
