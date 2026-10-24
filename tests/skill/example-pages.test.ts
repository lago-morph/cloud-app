/**
 * SKILL-AC-004, clause "runs every example" for the browser examples (E-T2, evaluation E flag
 * F2). The app tests of `verify` exercise server routes only, so the template's `index.html` and
 * client modules, which the examples copy, are type-checked but never executed there. This test
 * executes them: it serves a scratch copy of `apps/template` with `dev` and drives every page in
 * Chromium (the driver script E2E-001 uses, `tests/compliance/e2e/support/template-pages.ts`):
 * greeting, log in and out, Notes, Status, Files (upload and download) and the admin page.
 *
 * It first checks that every example block copied from an `index.html` or a `src/client/` file
 * is a module the browser loads from the template's `index.html` (its script, then the relative
 * imports from it), so the run covers each such example and none sits outside it. It then
 * requires every page step to pass and no uncaught exception in the page.
 *
 * Not offline (no criterion here asks for it; E2E-001 runs the same script offline).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { EXAMPLES_DIR, fencedBlocks, markdownFiles, read, REPO_ROOT, repoPath } from "./support.js";

const TEMPLATE = join(REPO_ROOT, "apps", "template");
const PAGES_SCRIPT = join(REPO_ROOT, "tests", "compliance", "e2e", "support", "template-pages.ts");
const MARKER = /^\s*<!--\s*example-source:\s*(\S+)\s*-->\s*$/;
const NOT_COPIED = new Set(["node_modules", ".framework", ".wrangler", ".logs", ".dev.vars", "test-results", "validation"]);
const RUN_TIMEOUT = 20 * 60_000;

/** Repo paths of the example sources that are browser code: an `index.html` or a `src/client/` file. */
function clientExampleSources(): string[] {
  const out = new Set<string>();
  for (const file of markdownFiles(EXAMPLES_DIR)) {
    for (const b of fencedBlocks(read(file))) {
      const source = MARKER.exec(b.before)?.[1];
      if (source !== undefined && /^apps\/[^/]+\/(?:index\.html|src\/client\/.+)$/.test(source)) out.add(source);
    }
  }
  return [...out].sort();
}

/** The template's modules a browser loads: `index.html`, its module scripts, and their relative imports. */
function loadedByIndexHtml(): string[] {
  const html = join(TEMPLATE, "index.html");
  const loaded = new Set<string>([html]);
  const queue: string[] = [];
  for (const m of readFileSync(html, "utf8").matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g)) {
    const src = m[1] ?? "";
    queue.push(src.startsWith("/") ? join(TEMPLATE, src) : resolve(TEMPLATE, src));
  }
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    if (loaded.has(file) || !existsSync(file)) continue;
    loaded.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm)) {
      const base = resolve(dirname(file), m[1] ?? "");
      const target = [base, `${base}.ts`, join(base, "index.ts")].find((p) => existsSync(p) && p.endsWith(".ts"));
      if (target !== undefined) queue.push(target);
    }
  }
  return [...loaded].map(repoPath).sort();
}

let scratch: string | undefined;
afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

describe("SKILL: the template's browser examples run", () => {
  it(tag("SKILL-AC-004", "runs every example: each copied index.html or src/client/ file is loaded by the template's index.html, so the browser run executes it"), () => {
    const sources = clientExampleSources();
    expect(sources.length, "examples copy browser code").toBeGreaterThan(0);
    const loaded = new Set(loadedByIndexHtml());
    expect(sources.filter((s) => !loaded.has(s)), "browser example sources the template's index.html does not load (not run by this test)").toEqual([]);
  });

  it(
    tag("SKILL-AC-004", "runs every example: the template's index.html and client pages work in Chromium under dev (greeting, log in/out, Notes, Status, Files, Admin) with no uncaught page error"),
    () => {
      scratch = mkdtempSync(join(tmpdir(), "e-t2-template-pages-"));
      const appDir = join(scratch, "app");
      cpSync(TEMPLATE, appDir, { recursive: true, filter: (src) => !NOT_COPIED.has(src.slice(TEMPLATE.length + 1).split("/")[0] ?? "") });
      symlinkSync(join(REPO_ROOT, "node_modules"), join(appDir, "node_modules"), "dir");

      const greeting = "Hello from E-T2";
      const configPath = join(appDir, "config", "local.json");
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { values?: Record<string, unknown> };
      writeFileSync(configPath, `${JSON.stringify({ ...config, values: { ...(config.values ?? {}), greeting } }, null, 2)}\n`);
      const env = { ...process.env, CI: "1", NO_COLOR: "1", BROWSER: "none" };
      const secret = spawnSync("npx", ["--no-install", "prototype-framework", "secrets", "set", "apiKey", "--target", "local", "--stage", "local"], { cwd: appDir, env, input: `e-t2-${String(Date.now())}-value`, encoding: "utf8", timeout: 120_000 });
      expect(secret.status, `secrets set failed:\n${secret.stdout}\n${secret.stderr}`).toBe(0);

      const run = spawnSync(process.execPath, [PAGES_SCRIPT, appDir, greeting], { cwd: appDir, env, encoding: "utf8", timeout: RUN_TIMEOUT - 120_000 });
      const output = `${run.stdout}\n${run.stderr}`;
      const line = output.split("\n").find((l) => l.startsWith("E2E-001-RESULT "));
      expect(line, `the page run printed no result (status ${String(run.status)}):\n${output.slice(-4000)}`).toBeDefined();
      const result = JSON.parse((line ?? "").slice("E2E-001-RESULT ".length)) as { steps: { step: string; ok: boolean; detail?: string }[]; pageErrors?: string[] };
      expect(result.steps.map((s) => s.step), "every page step ran").toHaveLength(7);
      expect(result.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.detail ?? ""}`), "failed page steps").toEqual([]);
      expect(result.pageErrors, "uncaught exceptions in the template's client code").toEqual([]);
      expect(run.status, output.slice(-4000)).toBe(0);
    },
    RUN_TIMEOUT,
  );
});
