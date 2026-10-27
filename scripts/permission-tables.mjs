#!/usr/bin/env node
// The docs' Cloudflare permission tables, generated from the one versioned permission list
// (`permissionTableMarkdown` in packages/framework/src/provision/cloudflare/permissions.ts; DEC-0563, DEC-0602).
// Usage: node scripts/permission-tables.mjs           rewrite the tables in place (needs `npm run build -w packages/framework`)
//        node scripts/permission-tables.mjs --check   exit 1 and name each file whose tables differ from the list
// A table sits between `<!-- permission-table: everyday -->` (or `bootstrap`) and `<!-- /permission-table -->`;
// everything between the two lines is replaced. tests/permission-tables.unit.test.ts fails when a committed table drifts.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The files that carry generated tables, relative to the repository root. */
export const TABLE_FILES = ["QUICKSTART.md", "docs/components/provisioning.md"];

const START = /^<!-- permission-table: (everyday|bootstrap) -->$/;
const END = "<!-- /permission-table -->";

/**
 * `text` with every marked table replaced by `table(kind)`. Throws on a start marker without its
 * end marker, and on a file with no marker at all.
 *
 * @param {string} text
 * @param {(kind: "everyday" | "bootstrap") => string} table the Markdown of one table, ending in a newline
 * @param {string} [name] the file's name, for the error messages
 */
export function withTables(text, table, name = "the file") {
  const lines = text.split("\n");
  const out = [];
  let found = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = START.exec(line);
    if (m === null) continue;
    const end = lines.indexOf(END, i + 1);
    if (end < 0) throw new Error(`${name}: line ${i + 1} opens a permission table that is never closed (${END})`);
    out.push(...table(m[1]).replace(/\n$/, "").split("\n"), END);
    i = end;
    found++;
  }
  if (found === 0) throw new Error(`${name}: no <!-- permission-table: … --> marker`);
  return out.join("\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
  const built = join(repo, "packages", "framework", "dist", "provision", "cloudflare", "permissions.js");
  let permissionTableMarkdown;
  try {
    ({ permissionTableMarkdown } = await import(pathToFileURL(built).href));
  } catch {
    console.error("permission-tables: the framework is not built; run `npm run build -w packages/framework` first");
    process.exit(2);
  }
  const check = process.argv.includes("--check");
  const stale = [];
  for (const file of TABLE_FILES) {
    const path = join(repo, file);
    const text = readFileSync(path, "utf8");
    const next = withTables(text, permissionTableMarkdown, file);
    if (next === text) continue;
    stale.push(file);
    if (!check) writeFileSync(path, next);
  }
  if (check && stale.length > 0) {
    for (const f of stale) console.error(`permission-tables: ${f} differs from the permission list; run node scripts/permission-tables.mjs`);
    process.exit(1);
  }
  console.error(check ? "permission-tables: every table matches the permission list" : `permission-tables: ${stale.length === 0 ? "nothing to change" : `rewrote ${stale.join(", ")}`}`);
}
