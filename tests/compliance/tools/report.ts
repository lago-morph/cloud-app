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
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readCatalogue } from "../harness/catalogue.js";
import type { RunnerSelection } from "../harness/selection.js";
import { listSelection } from "./listing.js";
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

// Test sources scanned for tags next to the runners' listings.
const SOURCE_DIRS = ["packages/framework/test/integration", "tests/compliance/criteria", "tests/compliance/e2e", "apps/reference/src/server/cases"];

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

function listTests(): ListedTest[] {
  sh("npm", ["run", "build", "-w", "packages/framework"]);
  const tests: ListedTest[] = [];
  // Every layer's tests, with every tag (the unit layer included; the driver's narrower selection is listing.ts `listDriverTests`).
  const all: RunnerSelection[] = [
    { runner: "vitest", label: "vitest-unit", args: ["vitest", "run", "--config", "vitest.unit.config.ts"] },
    { runner: "vitest", label: "vitest-integration", args: ["vitest", "run", "--config", "vitest.integration.config.ts"] },
    { runner: "playwright", label: "playwright", args: ["playwright", "test"] },
  ];
  for (const selection of all) {
    const listing = listSelection(selection, { root });
    for (const error of listing.errors) process.stderr.write(`report: ${error}\n`);
    tests.push(...listing.tests);
  }
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
