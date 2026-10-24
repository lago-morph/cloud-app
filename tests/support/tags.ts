/**
 * Test-tag helper (plan §10.3, COMPL-REQ-002). Integration and E2E test titles start with the
 * IDs they verify in brackets: `[KV-AC-001] put, overwrite, get`, or `[SQL-AC-003][KV-AC-004] …`.
 *
 *   it(tag("KV-AC-001", "put, overwrite, get"), …)
 *   test(tag(["SQL-AC-003", "KV-AC-004"], "shared cases"), …)
 *
 * The traceability generator parses titles with TAG_PATTERN only, so `tag` refuses any ID that
 * pattern would not find.
 */

/** The plan §10.3 regex (global): group 1 is one ID. */
export const TAG_PATTERN = /\[((?:[A-Z]+-AC|E2E)-\d{3})\]/g;

const ID = /^(?:[A-Z]+-AC|E2E)-\d{3}$/;

/** Prefixes `title` with the bracketed IDs, in the order given. */
export function tag(ids: string | readonly string[], title: string): string {
  const list = typeof ids === "string" ? [ids] : ids;
  if (list.length === 0) throw new Error("test tag: give at least one criterion or scenario ID");
  for (const id of list) {
    if (!ID.test(id)) throw new Error(`test tag: ${JSON.stringify(id)} is not a criterion or scenario ID (e.g. KV-AC-001, E2E-011)`);
  }
  if (title.trim() === "") throw new Error("test tag: the title must say what the test checks");
  return `${list.map((id) => `[${id}]`).join("")} ${title}`;
}

/** The IDs a title carries, as the traceability generator reads them. */
export function parseTags(title: string): string[] {
  return Array.from(title.matchAll(TAG_PATTERN), (m) => m[1] ?? "");
}
