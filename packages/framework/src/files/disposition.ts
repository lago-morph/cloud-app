/**
 * How storage serves a download (DEC-0313, DEC-0535): the file is named after its whole name
 * with RFC 6266 / RFC 8187 `filename*=UTF-8''…`. The common raster image types
 * (`INLINE_IMAGE_TYPES`) are served `inline`, so they display when opened in the browser, with
 * exactly that content type; every other type (SVG and HTML included) is an `attachment`.
 * Shared by the local transfer route and the Cloudflare download tickets (and the AWS ones on
 * branch `aws`, DEC-0508) (`response-content-disposition`, `response-content-type`). Workers- and
 * browser-compatible; no local-only names (CORE-REQ-006).
 */

/** The content types served `inline` (DEC-0535): PNG, JPEG, GIF and WebP. Never SVG, HTML or anything else. */
export const INLINE_IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/**
 * The inline image type of a stored content type: its essence (no parameters, lowercase) when
 * that is one of `INLINE_IMAGE_TYPES`, else undefined.
 */
export function inlineImageType(contentType: string | undefined): string | undefined {
  const essence = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return INLINE_IMAGE_TYPES.includes(essence) ? essence : undefined;
}

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

/**
 * The download's `Content-Disposition`: `inline` for an inline image type, else `attachment`
 * (also when the content type is not known), always with the file's whole name.
 */
export function downloadDisposition(name: string, contentType?: string): string {
  return `${inlineImageType(contentType) === undefined ? "attachment" : "inline"}; filename*=UTF-8''${encodeExtValue(name)}`;
}
