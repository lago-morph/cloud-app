/**
 * The key range of a prefix (kv.md §2): keys `k` with `prefix <= k < prefixEnd(prefix)`. Both
 * dialects compare text in code point order (SQLite's BINARY collation and the C collation of
 * the Postgres database compare UTF-8 bytes, DEC-0106), so no `LIKE` and no escaping is needed.
 */

const MAX_CODE_POINT = 0x10ffff;

/**
 * The smallest string greater than every string starting with `prefix`: the prefix with its last
 * code point incremented (skipping surrogates), after dropping trailing U+10FFFF code points.
 * Null when there is no such string (empty prefix, or only U+10FFFF code points): no upper bound.
 */
export function prefixEnd(prefix: string): string | null {
  const points = Array.from(prefix, (c) => c.codePointAt(0) ?? 0);
  while (points.length > 0 && points[points.length - 1] === MAX_CODE_POINT) points.pop();
  const last = points.pop();
  if (last === undefined) return null;
  const next = last === 0xd7ff ? 0xe000 : last + 1;
  return String.fromCodePoint(...points, next);
}
