/**
 * The `Content-Disposition` of a download (DEC-0313): the file is named after its whole name
 * with RFC 6266 / RFC 8187 `filename*=UTF-8''…`, `attachment` for everything but raster images,
 * which stay `inline` so they show in a tab. Shared by the local transfer route and the
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

/** Raster image types a browser renders without running content; served inline (files.md §2 Local). */
export const RASTER_IMAGES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

/** True when `contentType`'s media type (parameters and case ignored) is a raster image. */
export function isRasterImage(contentType: string): boolean {
  return RASTER_IMAGES.has((contentType.split(";")[0] ?? "").trim().toLowerCase());
}

export function downloadDisposition(name: string, contentType: string): string {
  return `${isRasterImage(contentType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeExtValue(name)}`;
}
