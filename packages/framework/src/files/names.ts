/**
 * File names and list prefixes (FILES-REQ-002). Names are opaque strings, never paths.
 * Workers-compatible (no Node APIs).
 */
import { FrameworkError } from "../core/errors.js";

/** PAR-230: maximum file name length in UTF-8 bytes. */
export const MAX_NAME_BYTES = 1024;

/** U+0000–U+001F and U+007F. */
const CONTROL = /[\u0000-\u001f\u007f]/;
/** A UTF-16 surrogate not part of a pair (text that is not well-formed Unicode). */
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function problemOf(text: string): string | undefined {
  if (LONE_SURROGATE.test(text)) return "is not well-formed Unicode";
  if (CONTROL.test(text)) return "contains a control character (U+0000–U+001F or U+007F)";
  if (new TextEncoder().encode(text).byteLength > MAX_NAME_BYTES) return `is longer than ${MAX_NAME_BYTES} UTF-8 bytes (PAR-230)`;
  return undefined;
}

/** Returns `name` unchanged, or throws FILES.INVALID_NAME. The names `.` and `..` are invalid on every target (DEC-0505). */
export function checkName(name: string): string {
  const problem =
    typeof name !== "string" ? "is not a string" : name === "" ? "is empty" : name === "." || name === ".." ? `is ${JSON.stringify(name)}` : problemOf(name);
  if (problem !== undefined) throw new FrameworkError("FILES.INVALID_NAME", `the file name ${problem}`);
  return name;
}

/** Returns the list prefix unchanged (empty lists everything), or throws FILES.INVALID_NAME. */
export function checkPrefix(prefix: string): string {
  const problem = typeof prefix !== "string" ? "is not a string" : problemOf(prefix);
  if (problem !== undefined) throw new FrameworkError("FILES.INVALID_NAME", `the list prefix ${problem}`);
  return prefix;
}
