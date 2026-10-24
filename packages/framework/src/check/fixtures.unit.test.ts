/**
 * The B-T4 fixture trees (`test/fixtures/check/**`, read-only here) through the rule engine
 * directly, without the CLI: each failing fixture gets its rule's diagnostic with the construct
 * in the message, and the passing app gets none. The integration suite checks the same through
 * `verify` (with type errors and skill files); this is the unit-level guard for B-14's part.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OTHER_CHECK_FIXTURES, RULE_FIXTURES, TYPE_ESCAPE_FIXTURES } from "../../test/fixtures/support/check-catalog.js";
import type { CheckDiagnostic } from "./engine.js";
import { formatDiagnostic } from "./format.js";
import { createCheckApp, forFile, type CheckApp } from "./harness.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures");

async function layer(dir: string, prefix = ""): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(join(FIXTURES, dir, prefix), { withFileTypes: true })) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, await layer(dir, rel));
    else out[rel.replace(/\.fixture$/, "")] = await readFile(join(FIXTURES, dir, rel), "utf8");
  }
  return out;
}

describe("B-T4 failing fixtures (apps/base + check/fail)", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp({ ...(await layer("apps/base")), ...(await layer("check/fail")) });
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  for (const fixture of RULE_FIXTURES) {
    const tags = fixture.sqlFeature === true ? "[CHECK-AC-001][SQL-AC-002]" : "[CHECK-AC-001]";
    it(`${tags} ${String(fixture.rule)} rejects ${fixture.what} (${fixture.file})`, () => {
      const found = forFile(diagnostics, fixture.file).filter((d) => d.rule === `prototype-framework/${String(fixture.rule)}`);
      expect(found.length, JSON.stringify(forFile(diagnostics, fixture.file))).toBeGreaterThan(0);
      if (fixture.representative === true) {
        // CHECK-AC-003: the construct appears in the diagnostic text once file, rule and reference are removed.
        const texts = found.map((d) => formatDiagnostic(d).replace(d.file, " ").replace(d.rule, " ").replace(d.reference, " "));
        expect(texts.some((t) => (fixture.construct ?? []).some((re) => re.test(t))), texts.join("\n")).toBe(true);
      }
    });
  }

  // `Buffer` fails type checking only (no rule: CHECK §2); every other one gets a rule diagnostic.
  for (const fixture of [...OTHER_CHECK_FIXTURES, ...TYPE_ESCAPE_FIXTURES].filter((f) => f.file !== "src/server/fail/buffer-use.ts")) {
    it(`[CHECK-AC-001][CHECK-AC-002] a rule names ${fixture.what} (${fixture.file})`, () => {
      expect(forFile(diagnostics, fixture.file).length).toBeGreaterThan(0);
    });
  }

  it("[CHECK-AC-001] a dialect-module import is reported by allowed-imports only, not again per imported name", () => {
    expect(forFile(diagnostics, "src/server/fail/ai-drizzle-d1.ts").map((d) => d.rule)).toEqual(["prototype-framework/allowed-imports"]);
    expect(forFile(diagnostics, "src/server/fail/ai-drizzle-pg-core.ts").map((d) => d.rule)).toEqual(["prototype-framework/allowed-imports"]);
  });

  it("[CHECK-AC-001] an aliased fetch is reported where it is read, not where the alias is declared", () => {
    expect(forFile(diagnostics, "src/client/fail/ba-fetch-alias.ts").map((d) => d.line)).toEqual([1, 3]);
  });

  it("[CHECK-AC-002] a @ts-ignore diagnostic does not recommend another suppression comment", () => {
    const found = forFile(diagnostics, "src/server/fail/te-ts-ignore.ts");
    expect(found.length).toBeGreaterThan(0);
    for (const d of found) expect(d.message).not.toMatch(/instead of "@ts-ignore"|use "@ts-expect-error"/i);
  });

  it("[CHECK-AC-001] the helper modules next to the failing fixtures get no diagnostic", () => {
    expect(forFile(diagnostics, "src/server/fail/tables.ts")).toEqual([]);
    expect(forFile(diagnostics, "src/shared/schemas.ts")).toEqual([]);
  });
});

describe("B-T4 passing fixtures (apps/base + check/pass)", () => {
  let app: CheckApp;
  let diagnostics: CheckDiagnostic[];

  beforeAll(async () => {
    app = await createCheckApp({ ...(await layer("apps/base")), ...(await layer("check/pass")) });
    diagnostics = await app.lint();
  }, 120_000);

  afterAll(async () => {
    await app.dispose();
  });

  it("[CHECK-AC-001][CHECK-AC-002][SQL-AC-002] every rule passes the realistic passing app, incl. the sql.md §2.3 example", () => {
    expect(diagnostics.map(formatDiagnostic)).toEqual([]);
  });
});
