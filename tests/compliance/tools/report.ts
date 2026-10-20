/**
 * `node tests/compliance/tools/report.mjs traceability [--out <file>]`
 * `node tests/compliance/tools/report.mjs release [--commit <sha>] [--out <file>]`
 * Writes the report to `--out` (default stdout).
 *
 * Traceability finds tests through the runners themselves (a Vitest run whose name filter
 * matches nothing, which collects every file without running a test; `playwright test --list`),
 * so titles built at run time are seen exactly as the runners name them, plus a scan of the
 * test sources for tags. It builds the framework first.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readCatalogue } from "../harness/catalogue.js";
import { parsePlaywrightJson, parseVitestJson } from "../harness/reports.js";
import { readRecords } from "./records.js";
import { LOGIN_PROVIDER_PATHS, parseInvalidations, releaseReport, renderRelease } from "./release.js";
import { buildTraceability, renderTraceability, scanSourceTags, type ListedTest } from "./traceability.js";

const root = process.env.COMPLIANCE_REPO_ROOT ?? process.cwd();
const [command, ...rest] = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i === -1 ? undefined : rest[i + 1];
};
const sh = (cmd: string, args: string[]): string => execFileSync(cmd, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] });

/** Like `sh`, but returns stdout also when the command exits non-zero (a listing with load errors). */
const shTolerant = (cmd: string, args: string[]): string => {
  try {
    return sh(cmd, args);
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    process.stderr.write(`report: ${cmd} ${args.join(" ")} exited non-zero; using its partial listing\n`);
    return typeof stdout === "string" ? stdout : "";
  }
};

/** A test-name filter no test title matches. */
const COLLECT_ONLY = "^COLLECT-ONLY: no test matches this$";

// Test sources scanned for tags next to the runners' listings.
const SOURCE_DIRS = ["packages/framework/test/integration", "tests/compliance/criteria", "tests/compliance/e2e", "apps/reference/src/server/cases"];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

function listTests(): ListedTest[] {
  sh("npm", ["run", "build", "-w", "packages/framework"]);
  const tests: ListedTest[] = [];
  // `vitest list` (5.0.5) misses suites registered after a top-level `await import(...)`; a run
  // whose name filter matches nothing collects every file (no hook or test body runs) and
  // reports every test as skipped with its full title.
  const dir = mkdtempSync(join(tmpdir(), "traceability-"));
  try {
    for (const config of ["vitest.unit.config.ts", "vitest.integration.config.ts"]) {
      const out = join(dir, `${config}.json`);
      shTolerant("npx", ["vitest", "run", "--config", config, "-t", COLLECT_ONLY, "--passWithNoTests", "--reporter=json", `--outputFile=${out}`]);
      const parsed = parseVitestJson(existsSync(out) ? readFileSync(out, "utf8") : "", root);
      for (const error of parsed.errors) process.stderr.write(`report: vitest (${config}): ${error}\n`);
      tests.push(...parsed.outcomes.map((o) => ({ title: o.title, file: o.file })));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const listed = parsePlaywrightJson(shTolerant("npx", ["playwright", "test", "--list", "--reporter=json"]), "");
  for (const error of listed.errors) process.stderr.write(`report: playwright listing: ${error}\n`);
  tests.push(...listed.outcomes.map((o) => ({ title: o.title, file: o.file })));
  for (const file of SOURCE_DIRS.flatMap((d) => sourceFiles(join(root, d)))) {
    const ids = scanSourceTags(readFileSync(file, "utf8"));
    if (ids.length > 0) tests.push({ title: `(tags in source) ${ids.map((id) => `[${id}]`).join("")}`, file: relative(root, file).split("\\").join("/") });
  }
  return tests;
}

function main(): string {
  const { records, skipped } = readRecords(root);
  for (const s of skipped) process.stderr.write(`report: skipped ${s}\n`);
  const catalogue = readCatalogue(join(root, "docs"));
  if (command === "traceability") return renderTraceability(buildTraceability({ catalogue, tests: listTests(), records }));
  if (command === "release") {
    const commit = option("--commit") ?? sh("git", ["rev-parse", "HEAD"]).trim();
    const invalidations = parseInvalidations(readFileSync(join(root, "validation", "invalidations.md"), "utf8"));
    const loginCommits = (since: string | undefined): string[] =>
      sh("git", ["log", "--format=%h %s", since === undefined ? commit : `${since}..${commit}`, "--", ...LOGIN_PROVIDER_PATHS])
        .split("\n")
        .filter((l) => l !== "");
    return renderRelease(releaseReport({ commit, catalogue, records, invalidations, loginCommits }));
  }
  throw new Error("usage: report.mjs traceability|release [--commit <sha>] [--out <file>]");
}

try {
  const text = main();
  const out = option("--out");
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text);
} catch (error) {
  process.stderr.write(`report: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
