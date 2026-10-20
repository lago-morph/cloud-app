/**
 * E2E-001 — New app, no cloud, and E2E-003 — Portability is enforced (both Where: Local).
 * One scaffolded app serves both (scaffolding packs and installs the framework once).
 *
 * E2E-001: "On a machine with no cloud credentials and networking to cloud providers blocked:
 * 1. Scaffold a new app from the template. It installs the framework from an npm pack tarball
 * at an exact version, and imports every public subpath. 2. Run dev; use each capability
 * through the template's pages. 3. Run verify. Pass: the app works locally and verify passes."
 * - Scaffolding needs the npm registry for the template's other pinned dependencies (C-05), so
 *   it runs with the cloud credentials removed from the environment but with the proxy; every
 *   later step (the subpath imports, `secrets set`, `dev` with the browser, `verify`) runs in a
 *   network namespace with no network at all (`unshare -rn`, plan §10.2), stronger than "cloud
 *   providers blocked", with the credentials removed and an empty HOME.
 *
 * E2E-003: "In a scaffolded app, introduce, one at a time: an AWS SDK import; a Cloudflare
 * binding read; a node:fs import; a use of caches.default; raw SQL; a right outer join; a
 * SQLite-only function; an any-typed escape; an edited applied migration. Pass: verify fails on
 * each, naming the rule and the skill reference to read, except that non-Web-API globals such as
 * caches.default may instead fail by type checking (CHECK §2)." The rule IDs and the reference
 * each names follow check.md §2 "Diagnostics" and DEC-0181.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { REPO_ROOT, TEMPLATE_DIR, run, tail, type RunResult } from "./support/process.js";

const OFFLINE = join(REPO_ROOT, "scripts", "offline.sh");
const PAGES_SCRIPT = join(REPO_ROOT, "tests", "compliance", "e2e", "support", "template-pages.ts");
const PACKAGE = "@lago-morph/prototype-framework";

/** The environment without cloud credentials (and without the owner's home directory). */
function noCredentials(home: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(CLOUDFLARE_|CF_|AWS_|GOOGLE_|GCLOUD|CLOUDSDK_|AZURE_|SST_)/.test(k)) continue;
    if (/^COMPLIANCE_/.test(k)) continue;
    out[k] = v;
  }
  if (home !== undefined) out.HOME = home;
  return out;
}

let root: string;
let appDir: string;
let offlineHome: string;
let verifiedClean = false;

/** Runs a command in a network namespace with no network (loopback only). */
function offline(args: readonly string[], options: { readonly cwd: string; readonly input?: string; readonly timeoutMs: number }): Promise<RunResult> {
  return run("unshare", ["-rn", "sh", OFFLINE, ...args], { ...options, env: noCredentials(offlineHome) });
}

function verify(): Promise<RunResult> {
  return offline(["npx", "--no-install", "prototype-framework", "verify"], { cwd: appDir, timeoutMs: 600_000 });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(20 * 60_000);
  root = mkdtempSync(join(tmpdir(), "e2e-scaffold-"));
  appDir = join(root, "app");
  offlineHome = join(root, "home");
  mkdirSync(offlineHome);
  const scaffold = await run(process.execPath, [join(REPO_ROOT, "skill", "scripts", "scaffold"), appDir], { cwd: root, env: noCredentials(undefined), timeoutMs: 15 * 60_000 });
  expect(scaffold.status, `scaffold failed:\n${tail(scaffold.output)}`).toBe(0);
});

test.afterAll(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
});

test(tag("E2E-001", "a scaffolded app installs the framework from a packed tarball at an exact version, imports every public subpath, works through the template's pages under dev, and passes verify, with no credentials and no network"), async () => {
  test.setTimeout(30 * 60_000);

  // 1. The framework comes from an `npm pack` tarball at the template's exact version.
  const pinned = (JSON.parse(readFileSync(join(TEMPLATE_DIR, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies[PACKAGE] ?? "";
  expect(pinned, "the template pins an exact version").toMatch(/^\d+\.\d+\.\d+$/);
  const appPkg = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  const spec = appPkg.dependencies[PACKAGE] ?? "";
  expect(spec).toMatch(/^file:vendor\/[^/]+\.tgz$/);
  expect(existsSync(join(appDir, spec.slice("file:".length))), "the tarball is in the app").toBe(true);
  const installed = JSON.parse(readFileSync(join(appDir, "node_modules", ...PACKAGE.split("/"), "package.json"), "utf8")) as { version: string; exports: Record<string, unknown> };
  expect(installed.version).toBe(pinned);

  // No network inside the namespace: a cloud provider's API is unreachable.
  const probe = await offline([process.execPath, "-e", "fetch('https://api.cloudflare.com/client/v4/').then(() => process.exit(3), () => process.exit(0))"], { cwd: appDir, timeoutMs: 60_000 });
  expect(probe.status, `a cloud provider was reachable from the offline namespace:\n${tail(probe.output)}`).toBe(0);

  // Every public subpath of the installed package imports, at run time and in type checking.
  const subpaths = Object.keys(installed.exports);
  expect(subpaths.length).toBeGreaterThan(1);
  const specifiers = subpaths.map((s) => (s === "." ? PACKAGE : `${PACKAGE}/${s.slice(2)}`));
  const checkDir = join(appDir, ".e2e-001");
  mkdirSync(checkDir, { recursive: true });
  try {
    writeFileSync(join(checkDir, "imports.mjs"), `${specifiers.map((s) => `await import(${JSON.stringify(s)});`).join("\n")}\nconsole.log("imported ${String(specifiers.length)} subpaths");\n`);
    const imported = await offline([process.execPath, join(checkDir, "imports.mjs")], { cwd: appDir, timeoutMs: 120_000 });
    expect(imported.status, `importing every public subpath failed:\n${tail(imported.output)}`).toBe(0);
    writeFileSync(join(checkDir, "imports.ts"), `${specifiers.map((s, i) => `import * as m${String(i)} from ${JSON.stringify(s)};`).join("\n")}\nexport const all = [${specifiers.map((_, i) => `m${String(i)}`).join(", ")}];\n`);
    const tsconfig = { compilerOptions: { noEmit: true, strict: true, skipLibCheck: true, target: "ES2023", lib: ["ES2023", "DOM"], module: "ESNext", moduleResolution: "Bundler" }, files: ["imports.ts"] };
    writeFileSync(join(checkDir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);
    const typed = await offline(["npx", "--no-install", "tsc", "-p", join(checkDir, "tsconfig.json")], { cwd: appDir, timeoutMs: 300_000 });
    expect(typed.status, `type checking imports of every public subpath failed:\n${tail(typed.output)}`).toBe(0);
  } finally {
    rmSync(checkDir, { recursive: true, force: true });
  }

  // 2. dev, using each capability through the template's pages.
  const greeting = "Hello from E2E-001";
  const configPath = join(appDir, "config", "local.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as { values?: Record<string, unknown> };
  writeFileSync(configPath, `${JSON.stringify({ ...config, values: { ...(config.values ?? {}), greeting } }, null, 2)}\n`);
  const secret = await offline(["npx", "--no-install", "prototype-framework", "secrets", "set", "apiKey", "--target", "local", "--stage", "local"], { cwd: appDir, input: `e2e001-${String(Date.now())}-value`, timeoutMs: 120_000 });
  expect(secret.status, `secrets set failed:\n${tail(secret.output)}`).toBe(0);
  const pages = await offline([process.execPath, PAGES_SCRIPT, appDir, greeting], { cwd: appDir, timeoutMs: 15 * 60_000 });
  const line = pages.output.split("\n").find((l) => l.startsWith("E2E-001-RESULT "));
  expect(line, `the template pages run printed no result (status ${String(pages.status)}):\n${tail(pages.output)}`).toBeDefined();
  const result = JSON.parse((line ?? "").slice("E2E-001-RESULT ".length)) as { steps: { step: string; ok: boolean; detail?: string }[] };
  expect(result.steps.map((s) => s.step)).toHaveLength(7);
  const failedSteps = result.steps.filter((s) => !s.ok).map((s) => `${s.step}: ${s.detail ?? ""}`);
  expect(failedSteps, `template page steps failed:\n${failedSteps.join("\n")}`).toEqual([]);
  expect(pages.status).toBe(0);
  // LOG: the note's entry, written by the app during the request, is in `.logs/`.
  const logDir = join(appDir, ".logs");
  const entries = (existsSync(logDir) ? readdirSync(logDir) : [])
    .flatMap((f) => readFileSync(join(logDir, f), "utf8").split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { app: string; component: string; message: string; requestId?: string });
  expect(entries.filter((e) => e.app === "template" && e.component === "notes" && /^note \S+ created$/.test(e.message) && typeof e.requestId === "string"), "the note's log entry").toHaveLength(1);

  // 3. verify.
  const verified = await verify();
  expect(verified.status, `verify failed:\n${tail(verified.output)}`).toBe(0);
  verifiedClean = true;
});

interface Violation {
  readonly name: string;
  /** Files to write (relative to the app); restored afterwards. */
  readonly files: Readonly<Record<string, (original: string | undefined) => string>>;
  /** A diagnostic line must name this file… */
  readonly file: string;
  /** …and one of these rule IDs with its skill reference; or, if `typeCheck`, may be a type error. */
  readonly rules: readonly string[];
  readonly reference: string;
  readonly typeCheck?: RegExp;
}

const route = (body: string, imports = ""): string => `import type { Hono } from "hono";\nimport type { Env } from "./env";\n${imports}\nexport function e2e003Routes(api: Hono<Env>): void {\n${body}\n}\n`;

const VIOLATIONS: readonly Violation[] = [
  {
    name: "an AWS SDK import",
    files: { "src/server/e2e003-aws.ts": () => `import { S3Client } from "@aws-sdk/client-s3";\n\nexport const storage = new S3Client({});\n` },
    file: "src/server/e2e003-aws.ts",
    rules: ["prototype-framework/allowed-imports"],
    reference: "skill/reference/http-and-validation.md",
  },
  {
    name: "a Cloudflare binding read",
    files: { "src/server/e2e003-binding.ts": () => route(`  api.get("/e2e003-binding", (c) => c.json({ bound: String(c.env.DB) }));`) },
    file: "src/server/e2e003-binding.ts",
    rules: ["prototype-framework/no-env-access"],
    reference: "skill/reference/configuration.md",
  },
  {
    name: "a node:fs import",
    files: { "src/server/e2e003-fs.ts": () => `import { readFileSync } from "node:fs";\n\nexport function readLocal(path: string): string {\n  return readFileSync(path, "utf8");\n}\n` },
    file: "src/server/e2e003-fs.ts",
    rules: ["prototype-framework/allowed-imports"],
    reference: "skill/reference/http-and-validation.md",
  },
  {
    name: "a use of caches.default",
    files: { "src/server/e2e003-caches.ts": () => `export async function cached(url: string): Promise<Response | undefined> {\n  return caches.default.match(url);\n}\n` },
    file: "src/server/e2e003-caches.ts",
    rules: ["prototype-framework/no-env-access", "prototype-framework/allowed-imports"],
    reference: "skill/reference/",
    typeCheck: /\b(?:caches|default|CacheStorage)\b/,
  },
  {
    name: "raw SQL",
    files: { "src/server/e2e003-raw-sql.ts": () => route(`  api.get("/e2e003-raw", async (c) => c.json(await c.var.sql.run(sql\`select 1\`)));`, `import { sql } from "drizzle-orm";`) },
    file: "src/server/e2e003-raw-sql.ts",
    rules: ["prototype-framework/no-raw-sql"],
    reference: "skill/reference/sql-and-migrations.md",
  },
  {
    name: "a right outer join",
    files: {
      "src/server/e2e003-join.ts": () =>
        route(`  api.get("/e2e003-join", async (c) => c.json(await c.var.sql.select({ id: notes.id }).from(notes).rightJoin(notes, eq(notes.id, notes.ownerId))));`, `import { eq } from "@lago-morph/prototype-framework";\nimport { notes } from "./schema";`),
    },
    file: "src/server/e2e003-join.ts",
    rules: ["prototype-framework/no-dialect-features"],
    reference: "skill/reference/sql-and-migrations.md",
  },
  {
    name: "a SQLite-only function",
    files: {
      "src/server/e2e003-sqlite-fn.ts": () =>
        route(`  api.get("/e2e003-year", async (c) => c.json(await c.var.sql.select({ year: sql<string>\`strftime('%Y', \${notes.createdAt})\` }).from(notes)));`, `import { sql } from "drizzle-orm";\nimport { notes } from "./schema";`),
    },
    file: "src/server/e2e003-sqlite-fn.ts",
    rules: ["prototype-framework/no-dialect-features", "prototype-framework/no-raw-sql"],
    reference: "skill/reference/sql-and-migrations.md",
  },
  {
    name: "an any-typed escape",
    files: { "src/server/e2e003-any.ts": () => `export function loose(value: any): number {\n  return value.length;\n}\n` },
    file: "src/server/e2e003-any.ts",
    rules: ["@typescript-eslint/no-explicit-any"],
    reference: "skill/reference/troubleshooting.md",
  },
  {
    name: "an edited applied migration",
    files: { "migrations/sqlite/0000_schema.sql": (original) => `${original ?? ""}\n-- edited after it was applied (E2E-003)\n` },
    file: "migrations/sqlite/0000_schema.sql",
    rules: ["prototype-framework/migration-checksums"],
    reference: "skill/reference/sql-and-migrations.md",
  },
];

/** The diagnostic lines of `output` that name `file`. */
function linesNaming(output: string, file: string): string[] {
  return output.split("\n").filter((l) => l.includes(file));
}

test(tag("E2E-003", "verify fails on each of the nine portability violations, naming the rule and the skill reference to read"), async () => {
  test.setTimeout(60 * 60_000);
  if (!verifiedClean) {
    const clean = await verify();
    expect(clean.status, `the scaffolded app must pass verify before the violations:\n${tail(clean.output)}`).toBe(0);
  }
  const problems: string[] = [];
  for (const v of VIOLATIONS) {
    const originals = new Map<string, string | undefined>();
    for (const [rel, make] of Object.entries(v.files)) {
      const path = join(appDir, rel);
      const original = existsSync(path) ? readFileSync(path, "utf8") : undefined;
      originals.set(rel, original);
      writeFileSync(path, make(original));
    }
    try {
      const result = await verify();
      const lines = linesNaming(result.output, v.file);
      const named = lines.some((l) => v.rules.some((rule) => l.includes(rule)) && l.includes(`(read ${v.reference}`));
      const typeFailure = v.typeCheck !== undefined && lines.some((l) => v.typeCheck?.test(l) === true && /\bTS\d{4}\b|error/i.test(l));
      if (result.status === 0) problems.push(`${v.name}: verify passed (exit 0)`);
      else if (!named && !typeFailure) problems.push(`${v.name}: verify failed (exit ${String(result.status)}) but no diagnostic names ${v.file} with ${v.rules.join(" or ")} and (read ${v.reference}…); lines naming the file:\n  ${lines.join("\n  ") || "(none)"}\n${tail(result.output, 1500)}`);
    } finally {
      for (const [rel, original] of originals) {
        const path = join(appDir, rel);
        if (original === undefined) rmSync(path, { force: true });
        else writeFileSync(path, original);
      }
    }
  }
  expect(problems, problems.join("\n\n")).toEqual([]);
  // The app is clean again.
  const after = await verify();
  expect(after.status, `verify after restoring the app:\n${tail(after.output)}`).toBe(0);
});
