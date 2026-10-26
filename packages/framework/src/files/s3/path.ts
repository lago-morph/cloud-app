/**
 * The URL path of an object key on an S3 endpoint (R2's S3-compatible endpoint and AWS S3),
 * shared by the Cloudflare tickets and the AWS store and tickets (branch `aws`, DEC-0508) (DEC-0328).
 *
 * Each `/`-separated segment is RFC 3986-encoded (the form A-07 verified). URL parsers (aws4fetch,
 * `fetch`, browsers) resolve `.` and `..` segments, even percent-encoded, so a name with one is
 * sent with every `/` as `%2F`; storage decodes the path back to the same key. A name that is only
 * `.` or `..` cannot be put in any path-style or virtual-hosted URL (FILES.INVALID_NAME; FILES-REQ-002
 * makes such names invalid everywhere, DEC-0505, so this is a second guard). Both
 * rules test the *name*, so a target that stores another key for it (Cloudflare's U+0001 ending,
 * DEC-0430) behaves the same. Workers- and browser-compatible.
 */
import { FrameworkError } from "../../core/errors.js";

/** RFC 3986 encoding of one path segment (every byte except unreserved), as SigV4 canonicalises it. */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const DOT_SEGMENT = /^\.\.?$/;

/**
 * The URL path (no leading `/`) addressing `key`, the stored key of the file `name` (`key`
 * defaults to the name). Throws FILES.INVALID_NAME for a name that is only `.` or `..`.
 */
export function objectPath(name: string, key: string = name): string {
  if (DOT_SEGMENT.test(name)) {
    throw new FrameworkError("FILES.INVALID_NAME", `the file name ${JSON.stringify(name)} cannot be addressed in a storage URL on this target`);
  }
  return name.split("/").some((s) => DOT_SEGMENT.test(s)) ? encodeSegment(key) : key.split("/").map(encodeSegment).join("/");
}
