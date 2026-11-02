// Secret scrubbing for the live-pass records. Every command's arguments and output, every API
// answer, every server log and every owner reply passes through one scrubber before it is written.
//
// Two layers:
// 1. Known values: every token and generated secret the runner holds is registered by name and
//    replaced with `[REDACTED:<name>]` (also in its URL-encoded form). `rawHits` counts them in
//    raw text before scrubbing, which is the old runbook's `grep -c "$BOOT" = 0` check.
// 2. Patterns, for values the runner never held: bearer credentials, JWTs, `__Host-`/`__Secure-`
//    cookie values, OAuth and ticket query parameters, secret-named JSON fields, token-shaped
//    40-character strings and 64-hex strings (the R2 secret access key's shape).
//
// What the records may hold stays readable (owner decision 4): emails, Cloudflare user IDs, account
// and resource IDs (32 hex), names, URLs without secret parameters.

/** Values shorter than this are not registered: replacing them would mangle ordinary text. */
export const MIN_SECRET_LENGTH = 8;

/** JSON field names whose string values are always secret. */
const SECRET_KEYS = new Set([
  "client_secret",
  "secret",
  "secret_access_key",
  "secretaccesskey",
  "access_token",
  "refresh_token",
  "id_token",
  "password",
  "code_verifier",
  "verifier",
  "nonce",
  "token_value",
  "authorization",
  "cookie",
  "set-cookie",
]);

/** Query parameters whose values are secret or one-time (OAuth, presigned R2 tickets). */
const SECRET_PARAMS = [
  "code",
  "state",
  "nonce",
  "code_verifier",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "client_secret",
  "ticket",
  "signature",
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token",
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS = [
  // Bearer credentials (headers, curl lines).
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]"],
  // JWTs (ID tokens, access tokens).
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED:jwt]"],
  // Session and grant cookies: keep the name and attributes.
  [/\b(__(?:Host|Secure)-[A-Za-z0-9_-]+)=([^;\s"',]+)/g, "$1=[REDACTED]"],
  // Secret query parameters.
  [new RegExp(`([?&](?:${SECRET_PARAMS.map(escapeRe).join("|")})=)[^&\\s"'#<>]+`, "gi"), "$1[REDACTED]"],
  // Secret-named JSON fields written as text.
  [new RegExp(`("(?:${[...SECRET_KEYS].map(escapeRe).join("|")})"\\s*:\\s*")((?:[^"\\\\]|\\\\.)*)(")`, "gi"), "$1[REDACTED]$3"],
  // 64 hex characters: the R2 secret access key's shape (SHA-256 of a token value).
  [/(?<![A-Za-z0-9])[0-9a-f]{64}(?![A-Za-z0-9])/gi, "[REDACTED:hex64]"],
];

/** A Cloudflare API token's shape: 40 characters of [A-Za-z0-9_-], not all hex (a git SHA is). */
const TOKEN_LIKE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{40}(?![A-Za-z0-9_-])/g;
const ALL_HEX = /^[0-9a-f]+$/i;

/** A string that looks like a credential rather than a word, name or sentence. */
const credentialShaped = (s) => s.length >= 20 && !/\s/.test(s) && /^[A-Za-z0-9._~+/=-]+$/.test(s) && !/^https?:/.test(s) && !/^[a-z0-9-]+$/.test(s);

/**
 * @param {{ name: string, value: string | undefined }[]} [initial]
 */
export function createScrubber(initial = []) {
  /** @type {Map<string, string>} value -> name */
  const known = new Map();
  let ordered = [];

  const rebuild = () => {
    ordered = [...known.entries()].sort((a, b) => b[0].length - a[0].length);
  };

  const add = (name, value) => {
    if (typeof value !== "string") return;
    // A value pasted with surrounding whitespace is used (and could be printed) without it.
    for (const form of new Set([value, value.trim()])) {
      if (form.length < MIN_SECRET_LENGTH) continue;
      known.set(form, name);
      const encoded = encodeURIComponent(form);
      if (encoded !== form) known.set(encoded, name);
    }
    rebuild();
  };

  for (const { name, value } of initial) add(name, value);

  const text = (input) => {
    if (typeof input !== "string") return input;
    let out = input;
    for (const [value, name] of ordered) out = out.split(value).join(`[REDACTED:${name}]`);
    for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
    out = out.replace(TOKEN_LIKE, (m) => (ALL_HEX.test(m) ? m : "[REDACTED:token-like]"));
    return out;
  };

  const value = (input) => {
    if (typeof input === "string") return text(input);
    if (Array.isArray(input)) return input.map(value);
    if (input === null || typeof input !== "object") return input;
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      const key = text(k);
      const lower = k.toLowerCase();
      if (typeof v === "string" && SECRET_KEYS.has(lower)) out[key] = `[REDACTED:${lower}]`;
      else if (typeof v === "string" && lower === "value" && credentialShaped(v)) out[key] = "[REDACTED:value]";
      else out[key] = value(v);
    }
    return out;
  };

  const rawHits = (input) => {
    const hits = {};
    if (typeof input !== "string") return hits;
    for (const [v, name] of ordered) {
      const n = input.split(v).length - 1;
      if (n > 0) hits[name] = (hits[name] ?? 0) + n;
    }
    return hits;
  };

  const names = () => [...new Set(known.values())].sort();

  return { add, text, value, rawHits, names };
}
