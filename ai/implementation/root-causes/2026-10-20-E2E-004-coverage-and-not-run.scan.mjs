// Verbatim copies: TAG_CALL/QUOTED_ID/BRACKETED + scanSourceTags (tests/compliance/tools/traceability.ts:33-49),
// suiteFiles filter (tests/compliance/e2e/E2E-004.spec.ts:28-33), listFiles (e2e/support/scan.ts:559-569).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
const TAG_CALL = /\btag\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/g;
const QUOTED_ID = /["']((?:[A-Z]+-AC|E2E)-\d{3})["']/g;
const BRACKETED = /\[((?:[A-Z]+-AC|E2E)-\d{3})\]/g;
function scanSourceTags(source) { const ids = new Set(); for (const m of source.matchAll(BRACKETED)) if (m[1] !== undefined) ids.add(m[1]); for (const call of source.matchAll(TAG_CALL)) { for (const m of (call[1] ?? "").matchAll(QUOTED_ID)) if (m[1] !== undefined) ids.add(m[1]); } return [...ids].sort(); }
function listFiles(dir, skipDirs = new Set()) { if (!existsSync(dir)) return []; const out = []; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { if (!skipDirs.has(e.name)) out.push(...listFiles(p, skipDirs)); } else if (e.isFile()) out.push(p); } return out.sort(); }
const [root, expectedJson, mode] = process.argv.slice(2);
const roots = [join(root, "tests", "compliance"), join(root, "packages", "framework", "test", "integration")];
const skip = new Set(["node_modules", "harness", "tools", "test-results"]);
let files = roots.flatMap((r) => listFiles(r, skip));
if (mode === "all-ts") files = files.filter((f) => /\.ts$/.test(f));
else files = files.filter((f) => /\.(?:test|spec)\.ts$/.test(f) && !/\.unit\.test\.ts$/.test(f) && !/\.selftest\.ts$/.test(f));
const tagged = new Map();
for (const f of files) for (const id of scanSourceTags(readFileSync(f, "utf8"))) tagged.set(id, [...(tagged.get(id) ?? []), relative(root, f)]);
const expected = JSON.parse(readFileSync(expectedJson, "utf8")).filter((e) => e.run);
const untested = expected.map((e) => e.id).filter((id) => !tagged.has(id));
console.log(`mode=${mode ?? "as-E2E-004"} files=${files.length} expected(run)=${expected.length} untested=${untested.length}`);
console.log(untested.join(", "));
for (const id of ["KV-AC-004", "KV-AC-001", "SQL-AC-001", "SQL-AC-003"]) console.log(id, "<-", (tagged.get(id) ?? []).join(" "));
