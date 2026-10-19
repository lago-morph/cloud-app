/**
 * CORE-AC-001 (type part): fixture apps compiled with the TypeScript compiler under the app lib
 * set (CHECK §2: ES + Web APIs, no Node or Workers types) against the package as apps import it
 * (`@lago-morph/prototype-framework`, through its exports map). Criteria: docs/components/core.md §4.
 */
import { realpathSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { baseAppFiles, makeTempApp, requireBuiltFramework, type TempApp, FRAMEWORK_DIR, PACKAGE_NAME } from "./harness/harness.js";

/** The app lib set (tsconfig.app.json, CHECK §2). */
const APP_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ["lib.es2023.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
  strict: true,
  noUncheckedIndexedAccess: true,
  exactOptionalPropertyTypes: true,
  verbatimModuleSyntax: true,
  isolatedModules: true,
  skipLibCheck: true,
  noEmit: true,
};

function compile(dir: string, files: readonly string[]): ts.Diagnostic[] {
  const program = ts.createProgram(files.map((f) => join(dir, f)), APP_OPTIONS);
  return [...ts.getPreEmitDiagnostics(program)];
}

function describeDiagnostics(diags: readonly ts.Diagnostic[]): string {
  return diags
    .map((d) => {
      const where = d.file && d.start !== undefined ? `${d.file.fileName}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}` : "";
      return `${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
    })
    .join("\n");
}

const EQUALS = `type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;`;

/** Fixture 1: an app using only `.` exports; `c.var` has exactly the RequestVars members. */
const FIXTURE_ONE = `import { defineApp, configInteger, configString, FrameworkError, jsonBody, z, defineTable, id, text, eq, requireUser,
  type RequestVars, type Services, type DeploymentIdentity } from "${PACKAGE_NAME}";
${EQUALS}
const config = { limit: configInteger({ default: 3 }), label: configString() };
type C = typeof config;
const notes = defineTable("notes", { id: id(), title: text() });
const app = defineApp({
  name: "typesone",
  config,
  secrets: ["apiKey"],
  tables: { notes },
  routes: (api) => {
    api.get("/notes/:id", requireUser(), async (c) => {
      const exact: Equals<keyof typeof c.var, keyof RequestVars<C, "apiKey">> = true;
      const services: Services<C, "apiKey"> = c.var;
      const deployment: DeploymentIdentity = c.var.deployment;
      const deploymentKeys: Equals<keyof typeof c.var.deployment, "app" | "stage"> = true;
      const limit: number = c.var.config.get("limit");
      const secret: string = await c.var.secrets.get("apiKey");
      const rows = await c.var.sql.select().from(notes).where(eq(notes.id, c.req.param("id")));
      if (rows.length === 0) throw new FrameworkError("HTTP.NOT_FOUND");
      return c.json({ exact, deploymentKeys, limit, secret: secret.length, stage: deployment.stage, kv: typeof services.kv });
    });
    api.post("/notes", jsonBody(z.object({ title: z.string() })), async (c) => {
      const body: { title: string } = c.req.valid("json");
      return c.json(body);
    });
  },
});
export default app;
`;

/** Fixture 2: routes in a separate file, typed through the app definition. */
const FIXTURE_TWO_CONFIG = `import { configBoolean, configInteger, configString, configStringList } from "${PACKAGE_NAME}";
export const config = {
  limit: configInteger({ default: 10 }),
  enabled: configBoolean({ default: false }),
  label: configString({ default: "x" }),
  tags: configStringList({ default: [] }),
};
`;
const FIXTURE_TWO_ROUTES = `import type { AppDefinition } from "${PACKAGE_NAME}";
import type { config } from "./config.js";
export type Api = Parameters<AppDefinition<typeof config, never>["routes"]>[0];
export function routes(api: Api): void {
  api.get("/values", (c) => {
    const limit: number = c.var.config.get("limit");
    const enabled: boolean = c.var.config.get("enabled");
    const label: string = c.var.config.get("label");
    const tags: readonly string[] = c.var.config.get("tags");
    return c.json({ limit, enabled, label, tags });
  });
}
`;
const FIXTURE_TWO_APP = `import { defineApp } from "${PACKAGE_NAME}";
import { config } from "./server/config.js";
import { routes } from "./server/routes.js";
export default defineApp({ name: "typestwo", config, secrets: [], tables: {}, routes });
`;
/** Each line assigns a config value to a variable of the wrong type. */
const FIXTURE_TWO_WRONG = `import type { Api } from "./routes.js";
export function wrongRoutes(api: Api): void {
  api.get("/wrong", (c) => {
    const limit: string = c.var.config.get("limit");
    const enabled: number = c.var.config.get("enabled");
    const label: boolean = c.var.config.get("label");
    const tags: string = c.var.config.get("tags");
    return c.json({ limit, enabled, label, tags });
  });
}
`;
const WRONG_LINES = [4, 5, 6, 7];

let app: TempApp;

beforeAll(async () => {
  requireBuiltFramework();
  app = await makeTempApp({
    ...baseAppFiles("typesfixture"),
    "src/one/app.ts": FIXTURE_ONE,
    "src/two/server/config.ts": FIXTURE_TWO_CONFIG,
    "src/two/server/routes.ts": FIXTURE_TWO_ROUTES,
    "src/two/server/wrong.ts": FIXTURE_TWO_WRONG,
    "src/two/app.ts": FIXTURE_TWO_APP,
    "src/exports.ts": `import * as root from "${PACKAGE_NAME}";\nimport * as client from "${PACKAGE_NAME}/client";\nimport * as testing from "${PACKAGE_NAME}/testing";\nexport { root, client, testing };\n`,
  });
});

afterAll(async () => {
  await app?.remove();
});

describe("CORE-AC-001 type fixtures", () => {
  it(tag("CORE-AC-001", "a fixture app using only `.` exports type-checks and c.var has exactly the RequestVars members"), () => {
    const diags = compile(app.dir, ["src/one/app.ts"]);
    expect(describeDiagnostics(diags)).toBe("");
  });

  it(tag("CORE-AC-001", "routes in a separate file type-check config value types"), () => {
    const diags = compile(app.dir, ["src/two/app.ts"]);
    expect(describeDiagnostics(diags)).toBe("");
  });

  it(tag("CORE-AC-001", "routes in a separate file: a wrong config value type fails type checking"), () => {
    const diags = compile(app.dir, ["src/two/app.ts", "src/two/server/wrong.ts"]);
    const wrongFile = realpathSync(join(app.dir, "src/two/server/wrong.ts"));
    const lines = diags
      .filter((d) => d.file && realpathSync(d.file.fileName) === wrongFile && d.start !== undefined)
      .map((d) => ({ line: d.file!.getLineAndCharacterOfPosition(d.start!).line + 1, code: d.code }));
    // Exactly one assignability error per wrong line, and no error anywhere else.
    expect(lines.map((l) => l.line).sort((a, b) => a - b)).toEqual(WRONG_LINES);
    for (const l of lines) expect(l.code).toBe(2322);
    expect(diags.length).toBe(WRONG_LINES.length);
  });

  it(tag("CORE-AC-001", "every framework type in a public signature is importable from a subpath its importers may use"), () => {
    const program = ts.createProgram([join(app.dir, "src/exports.ts")], APP_OPTIONS);
    expect(describeDiagnostics(ts.getPreEmitDiagnostics(program))).toBe("");
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(join(app.dir, "src/exports.ts"))!;
    const frameworkRoot = realpathSync(FRAMEWORK_DIR);

    const resolveAlias = (s: ts.Symbol): ts.Symbol => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
    const modules = new Map<string, ts.Symbol>();
    for (const stmt of source.statements) {
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const sym = checker.getSymbolAtLocation(stmt.moduleSpecifier);
        if (!sym) throw new Error(`cannot resolve ${stmt.moduleSpecifier.text}`);
        modules.set(stmt.moduleSpecifier.text, sym);
      }
    }
    const exported = new Map<string, Set<ts.Symbol>>();
    for (const [spec, sym] of modules) exported.set(spec, new Set(checker.getExportsOfModule(sym).map(resolveAlias)));

    // Who may import each subpath (CORE-REQ-005): app test files may import both `./testing` and `.`.
    const visibleFrom: Record<string, string[]> = {
      [PACKAGE_NAME]: [PACKAGE_NAME],
      [`${PACKAGE_NAME}/client`]: [`${PACKAGE_NAME}/client`],
      [`${PACKAGE_NAME}/testing`]: [`${PACKAGE_NAME}/testing`, PACKAGE_NAME],
    };

    const isFrameworkDecl = (s: ts.Symbol): boolean =>
      (s.declarations ?? []).some((d) => {
        try {
          return realpathSync(d.getSourceFile().fileName).startsWith(frameworkRoot + "/");
        } catch {
          return false;
        }
      });
    const TYPE_FLAGS = ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class | ts.SymbolFlags.Enum;

    const missing: string[] = [];
    let checked = 0;
    for (const [spec, mod] of modules) {
      const allowed = new Set<ts.Symbol>();
      for (const v of visibleFrom[spec]!) for (const s of exported.get(v)!) allowed.add(s);
      const seen = new Set<ts.Symbol>();
      const visit = (sym: ts.Symbol, via: string): void => {
        if (seen.has(sym)) return;
        seen.add(sym);
        for (const decl of sym.declarations ?? []) {
          const walk = (node: ts.Node): void => {
            let nameNode: ts.Node | undefined;
            if (ts.isTypeReferenceNode(node)) nameNode = node.typeName;
            else if (ts.isExpressionWithTypeArguments(node)) nameNode = node.expression;
            else if (ts.isTypeQueryNode(node)) nameNode = node.exprName;
            if (nameNode) {
              const target = checker.getSymbolAtLocation(nameNode);
              if (target) {
                const real = resolveAlias(target);
                if (real.flags & TYPE_FLAGS && !(real.flags & ts.SymbolFlags.TypeParameter) && isFrameworkDecl(real)) {
                  checked++;
                  if (!allowed.has(real)) missing.push(`${spec}: ${real.getName()} (used by ${via})`);
                  visit(real, real.getName());
                }
              }
            }
            ts.forEachChild(node, walk);
          };
          walk(decl);
        }
      };
      for (const s of checker.getExportsOfModule(mod)) visit(resolveAlias(s), s.getName());
    }
    expect(checked).toBeGreaterThan(0);
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
