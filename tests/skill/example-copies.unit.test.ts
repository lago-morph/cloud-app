/**
 * SKILL-AC-004: "CI type-checks and runs every example and the template. No example file is
 * derived from `apps/demo/`." (docs/components/skill.md §4, SKILL-REQ-004, DEC-0054; Where: Local.)
 *
 * skill.md §2 "Implementation": each example is a Markdown file of whole source files copied
 * unchanged from `apps/template` or `apps/reference`, each copy a fenced block directly preceded by
 * `<!-- example-source: <repo path> -->`; the code is type-checked and tested where it lives, by
 * each app's `verify`, which the framework's CI (root `npm run verify`) runs. So this checks:
 * - every code block of every example is such a byte-for-byte copy (no unchecked code);
 * - every source is in `apps/template` or `apps/reference`, none under `apps/demo/`, and no block
 *   equals a file of `apps/demo/`;
 * - every TypeScript source is in what `verify` type-checks (`src/`, `tests/`, CLI §2), and every
 *   test source matches the test glob `verify` runs (PAR-116 `tests/**\/*.test.ts`);
 * - root `verify` runs both apps' `verify`.
 * The apps' `verify` runs themselves are in `examples.test.ts`, and the browser run of the
 * template's client pages is in `example-pages.test.ts`.
 *
 * Why `*.unit.test.ts` (E-T2, evaluation E flag F3): these checks read files only, so they run
 * in `npm run test:unit`, which root `npm run verify` (the framework's CI) runs. An example that
 * drifts from its source therefore fails CI, not only the integration and compliance runs. The
 * integration glob (`tests/skill/**\/*.test.ts`) still collects this file, so the compliance
 * driver's integration run evidences SKILL-AC-004 from it as before. No configuration changed.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { describe, expect, it } from "vitest";
import { tag } from "../support/tags.js";
import { EXAMPLES_DIR, fencedBlocks, filesUnder, markdownFiles, read, REPO_ROOT, repoPath } from "./support.js";

const MARKER = /^\s*<!--\s*example-source:\s*(\S+)\s*-->\s*$/;
const APPS = ["apps/template", "apps/reference"] as const;

interface Copy {
  readonly example: string;
  readonly line: number;
  readonly source: string | null;
  readonly adjacent: boolean;
  readonly body: string;
}

function copies(): Copy[] {
  return markdownFiles(EXAMPLES_DIR).flatMap((file) =>
    fencedBlocks(read(file)).map((b) => ({
      example: repoPath(file),
      line: b.line,
      source: MARKER.exec(b.before)?.[1] ?? null,
      adjacent: b.adjacent,
      body: b.body,
    })),
  );
}

function sameBytes(body: string, file: string): boolean {
  const content = readFileSync(file, "utf8");
  return content === body + "\n" || content === body;
}

function appOf(source: string): (typeof APPS)[number] | undefined {
  return APPS.find((app) => source.startsWith(`${app}/`));
}

describe("SKILL: examples are copies of verified template and reference code", () => {
  const all = copies();

  it(tag("SKILL-AC-004", "every example holds code, and every code block is directly preceded by its example-source marker"), () => {
    const examples = markdownFiles(EXAMPLES_DIR);
    expect(examples.length).toBeGreaterThan(0);
    const empty = examples.map(repoPath).filter((f) => !all.some((c) => c.example === f));
    expect(empty, "examples with no code block").toEqual([]);
    const unmarked = all.filter((c) => c.source === null || !c.adjacent).map((c) => `${c.example}:${c.line}`);
    expect(unmarked, "code blocks without a directly preceding example-source marker").toEqual([]);
  });

  it(tag("SKILL-AC-004", "no example is derived from apps/demo/: every source is a file of apps/template or apps/reference, and no block equals a demo file"), () => {
    const bad: string[] = [];
    for (const c of all) {
      if (c.source === null) continue;
      const norm = normalize(c.source).split("\\").join("/");
      if (norm !== c.source || norm.startsWith("/") || norm.includes("..")) bad.push(`${c.example}:${c.line}: source path ${c.source} is not a plain repo path`);
      else if (norm.startsWith("apps/demo/") || norm === "apps/demo") bad.push(`${c.example}:${c.line}: source ${c.source} is under apps/demo/`);
      else if (appOf(norm) === undefined) bad.push(`${c.example}:${c.line}: source ${c.source} is not in apps/template or apps/reference`);
    }
    const demoFiles = filesUnder(join(REPO_ROOT, "apps", "demo")).filter((f) => statSync(f).size > 0);
    for (const c of all) {
      for (const demo of demoFiles) {
        if (c.body.trim() !== "" && sameBytes(c.body, demo)) bad.push(`${c.example}:${c.line}: block equals ${repoPath(demo)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it(tag("SKILL-AC-004", "every code block is byte-for-byte the source file it names"), () => {
    const bad: string[] = [];
    for (const c of all) {
      if (c.source === null) continue;
      const file = join(REPO_ROOT, c.source);
      if (!existsSync(file) || !statSync(file).isFile()) bad.push(`${c.example}:${c.line}: ${c.source} does not exist`);
      else if (!sameBytes(c.body, file)) bad.push(`${c.example}:${c.line}: differs from ${c.source}`);
    }
    expect(bad).toEqual([]);
  });

  it(tag("SKILL-AC-004", "every TypeScript source is type-checked by its app's verify (src/ or tests/), and every test source is run by it (tests/**/*.test.ts)"), () => {
    const bad: string[] = [];
    for (const c of all) {
      const app = c.source === null ? undefined : appOf(c.source);
      if (c.source === null || app === undefined || !/\.(?:ts|tsx|mts|cts)$/.test(c.source)) continue;
      const inApp = c.source.slice(app.length + 1);
      if (!/^(?:src|tests)\//.test(inApp)) bad.push(`${c.example}:${c.line}: ${c.source} is outside ${app}/src and ${app}/tests, so verify does not type-check it`);
      if (/\.test\.ts$/.test(inApp) && !/^tests\/(?:.+\/)?[^/]+\.test\.ts$/.test(inApp)) bad.push(`${c.example}:${c.line}: test ${c.source} is outside the tests/**/*.test.ts glob`);
    }
    expect(bad).toEqual([]);
  });

  it(tag("SKILL-AC-004", "CI wiring: the framework's root verify runs the template's and the reference app's verify"), () => {
    const root = JSON.parse(read(join(REPO_ROOT, "package.json"))) as { scripts?: Record<string, string> };
    const verify = root.scripts?.["verify"] ?? "";
    for (const app of APPS) {
      expect(verify, `root verify runs ${app}'s verify`).toMatch(new RegExp(`(?:--workspace|-w)[ =]${app.replace("/", "\\/")} run verify\\b`));
    }
  });

  it(tag("SKILL-AC-004", "CI wiring: the framework's root verify runs this byte-for-byte check (test:unit, whose include glob collects this file)"), () => {
    const root = JSON.parse(read(join(REPO_ROOT, "package.json"))) as { scripts?: Record<string, string> };
    expect(root.scripts?.["verify"] ?? "", "root verify runs test:unit").toMatch(/\bnpm run test:unit\b/);
    expect(root.scripts?.["test:unit"] ?? "", "test:unit uses the unit config").toMatch(/--config vitest\.unit\.config\.ts\b/);
    const config = read(join(REPO_ROOT, "vitest.unit.config.ts"));
    expect(config, "the unit layer collects tests/**/*.unit.test.ts, which includes this file").toContain('"tests/**/*.unit.test.ts"');
  });
});
