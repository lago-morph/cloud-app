/**
 * The `Content-Disposition` of a download (DEC-0313): the file is named after its whole name
 * with RFC 6266 / RFC 8187 `filename*=UTF-8''…`, always `attachment`, for every content type
 * (DEC-PENDING-fix-f04b-1, superseding DEC-0313's raster `inline`). Images still display through `<img src>`,
 * which ignores the header. Shared by the local transfer route and the
 * Cloudflare download ticket (R2's `response-content-disposition`). Workers- and browser-
 * compatible; no local-only names (CORE-REQ-006).
 */

/** RFC 8187 `attr-char`: the bytes that stay unencoded in an extended parameter value. */
const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

/** RFC 8187 `value-chars` of `text` in UTF-8. */
function encodeExtValue(text: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(text)) {
    const char = String.fromCharCode(byte);
    out += byte < 0x80 && ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return out;
}

export function downloadDisposition(name: string): string {
  return `attachment; filename*=UTF-8''${encodeExtValue(name)}`;
}
