/**
 * FILES-AC-004, contract and type-inspection part (docs/components/files.md FILES-REQ-004):
 * no storage-service names or credentials in app-facing types, and tickets with no readable
 * fields. The browser part (a transfer from an unrelated origin) is transfers.spec.ts.
 *
 * Inspects what an app actually gets: (1) the app-facing contract files
 * docs/contracts/ts/{index,files,client}.d.ts, and (2) the published declarations of the
 * package's app-facing entry points `<package>` and `<package>/client` (their `types` in the
 * package's `exports` map, i.e. the built `dist/**.d.ts`), walked with the TypeScript checker.
 * Target-independent: the same package is deployed to every target.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const PACKAGE = "@lago-morph/prototype-framework";

/** Storage-service, signing, cross-origin and credential vocabulary (FILES-REQ-004). */
const FORBIDDEN =
  /(r2|s3|bucket|aws|amz|sigv4|aws4|signature|signed|signing|credential|accesskey|access_key|secretkey|secret_key|sessiontoken|session_token|hmac|cors|crossorigin|cross_origin|miniflare|wrangler|presign|endpoint|region|accountid|cloudflare|storageurl)/i;

/** The app-facing FILES names (files.d.ts, client.d.ts) plus the Services entry that carries them. */
const SERVER_NAMES = ["FilesService", "FileInfo", "FileContent", "FilesListOptions", "FilesListPage", "UploadTicket", "UploadTicketOptions", "DownloadTicket"];
const CLIENT_NAMES = ["uploadFile", "downloadUrl", "TransferProgress", "UploadTicket", "DownloadTicket"];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** Identifiers and string-literal contents outside comments. */
function wordsOf(source: string): string[] {
  const code = stripComments(source);
  const strings = Array.from(code.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g), (m) => m[1] ?? m[2] ?? "");
  const withoutStrings = code.replace(/"[^"\n]*"|'[^'\n]*'/g, " ");
  return [...(withoutStrings.match(/[A-Za-z_$][\w$]*/g) ?? []), ...strings];
}

/** The `types` file of one `exports` entry of the installed package. */
function publishedTypes(subpath: "." | "./client"): string {
  const require = createRequire(import.meta.url);
  // The package's `exports` has no `./package.json`; find it above the resolved main entry.
  let dir = path.dirname(require.resolve(PACKAGE));
  while (!existsSync(path.join(dir, "package.json")) || (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { name?: string }).name !== PACKAGE) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`no package.json for ${PACKAGE}`);
    dir = up;
  }
  const pkgJson = path.join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgJson, "utf8")) as { exports: Record<string, { types?: string } | string> };
  const entry = pkg.exports[subpath];
  if (entry === undefined || typeof entry === "string" || entry.types === undefined) throw new Error(`${PACKAGE} exports["${subpath}"] names no types file`);
  return path.resolve(path.dirname(pkgJson), entry.types);
}

interface Inspection {
  readonly offending: string[];
  readonly ticketFields: Record<string, string[]>;
  readonly missing: string[];
  /** Every name the walk saw, to show it reached the members (not a vacuous pass). */
  readonly visited: Set<string>;
}

/** Contracts use extensionless imports (bundler resolution); the published package is Node ESM. */
function inspect(entries: { readonly file: string; readonly names: readonly string[] }[], resolution: "bundler" | "node"): Inspection {
  const program = ts.createProgram(
    entries.map((e) => e.file),
    {
      module: resolution === "node" ? ts.ModuleKind.NodeNext : ts.ModuleKind.ESNext,
      moduleResolution: resolution === "node" ? ts.ModuleResolutionKind.NodeNext : ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2023,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    },
  );
  const checker = program.getTypeChecker();
  const offending: string[] = [];
  const ticketFields: Record<string, string[]> = {};
  const missing: string[] = [];
  const visited = new Set<string>();
  const seen = new Set<ts.Type>();
  const note = (name: string, where: string): void => {
    visited.add(name);
    if (FORBIDDEN.test(name)) offending.push(`${where}: ${name}`);
  };

  const visit = (type: ts.Type, where: string, depth: number): void => {
    if (depth > 6 || seen.has(type)) return;
    seen.add(type);
    const typeName = (type.aliasSymbol ?? type.getSymbol())?.getName();
    if (typeName !== undefined && !typeName.startsWith("__")) note(typeName, where);
    if (type.isStringLiteral()) note(type.value, where);
    if (type.isUnionOrIntersection()) {
      for (const t of type.types) visit(t, where, depth + 1);
      return;
    }
    if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
      for (const arg of checker.getTypeArguments(type as ts.TypeReference)) visit(arg, where, depth + 1);
    }
    for (const sig of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
      for (const p of sig.getParameters()) {
        note(p.getName(), `${where}(${p.getName()})`);
        const decl = p.valueDeclaration ?? p.declarations?.[0];
        if (decl !== undefined) visit(checker.getTypeOfSymbolAtLocation(p, decl), `${where}(${p.getName()})`, depth + 1);
      }
      visit(sig.getReturnType(), `${where}()`, depth + 1);
    }
    // Only the framework's own object types are walked into; lib types (Promise, Uint8Array,
    // ReadableStream, Blob) are the platform's, not storage services.
    const decls = (type.aliasSymbol ?? type.getSymbol())?.getDeclarations() ?? [];
    const own = decls.some((d) => !d.getSourceFile().fileName.includes("/typescript/lib/"));
    if (!own) return;
    for (const prop of checker.getPropertiesOfType(type)) {
      if (!prop.getName().startsWith("__@")) note(prop.getName(), `${where}.${prop.getName()}`);
      const decl = prop.valueDeclaration ?? prop.declarations?.[0];
      if (decl !== undefined) visit(checker.getTypeOfSymbolAtLocation(prop, decl), `${where}.${prop.getName()}`, depth + 1);
    }
  };

  for (const { file, names } of entries) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (moduleSymbol === undefined) {
      missing.push(`${file}: not a module`);
      continue;
    }
    const exports = new Map(checker.getExportsOfModule(moduleSymbol).map((s) => [s.getName(), s]));
    for (const name of names) {
      const exported = exports.get(name);
      if (exported === undefined) {
        missing.push(`${path.basename(file)}: ${name}`);
        continue;
      }
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const where = `${path.relative(repoRoot, file)}#${name}`;
      const type = symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class) ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbol(symbol);
      visit(type, where, 0);
      if (name === "UploadTicket" || name === "DownloadTicket") {
        // Readable fields: every property other than the unique-symbol brand.
        ticketFields[`${path.relative(repoRoot, file)}#${name}`] = checker.getPropertiesOfType(type).map((p) => p.getName()).filter((n) => !n.startsWith("__@"));
      }
    }
    // The Services type's `files` entry is how server code reaches FILES.
    const services = exports.get("Services");
    if (services !== undefined) {
      const symbol = services.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(services) : services;
      const filesProp = checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(symbol), "files");
      const decl = filesProp?.valueDeclaration ?? filesProp?.declarations?.[0];
      if (filesProp !== undefined && decl !== undefined) visit(checker.getTypeOfSymbolAtLocation(filesProp, decl), `${path.relative(repoRoot, file)}#Services.files`, 0);
    }
  }
  return { offending, ticketFields, missing, visited };
}

describe("FILES-AC-004 app-facing types", () => {
  it(tag("FILES-AC-004", "contract inspection: the app-facing contracts index.d.ts, files.d.ts and client.d.ts name no storage service, signing or credential"), () => {
    for (const file of ["docs/contracts/ts/index.d.ts", "docs/contracts/ts/files.d.ts", "docs/contracts/ts/client.d.ts"]) {
      const offending = wordsOf(readFileSync(path.join(repoRoot, file), "utf8")).filter((w) => FORBIDDEN.test(w));
      expect(offending, file).toStrictEqual([]);
    }
  });

  it(tag("FILES-AC-004", "contract type inspection: the contract's FILES types expose no storage names or credentials; tickets have no readable fields"), () => {
    const result = inspect([
      { file: path.join(repoRoot, "docs/contracts/ts/index.d.ts"), names: SERVER_NAMES },
      { file: path.join(repoRoot, "docs/contracts/ts/client.d.ts"), names: CLIENT_NAMES },
    ], "bundler");
    expect(result.missing).toStrictEqual([]);
    expect(result.offending).toStrictEqual([]);
    for (const member of ["createUploadTicket", "createDownloadTicket", "contentType", "onProgress", "nextCursor"]) expect(result.visited.has(member), member).toBe(true);
    expect(Object.keys(result.ticketFields).length).toBe(4);
    for (const [name, fields] of Object.entries(result.ticketFields)) expect(fields, name).toStrictEqual([]);
  });

  it(tag("FILES-AC-004", "published type inspection: the package's app-facing entry points expose no storage names or credentials; tickets have no readable fields"), () => {
    const result = inspect([
      { file: publishedTypes("."), names: SERVER_NAMES },
      { file: publishedTypes("./client"), names: CLIENT_NAMES },
    ], "node");
    expect(result.missing).toStrictEqual([]);
    expect(result.offending).toStrictEqual([]);
    for (const member of ["createUploadTicket", "createDownloadTicket", "contentType", "onProgress", "nextCursor"]) expect(result.visited.has(member), member).toBe(true);
    expect(Object.keys(result.ticketFields).length).toBe(4);
    for (const [name, fields] of Object.entries(result.ticketFields)) expect(fields, name).toStrictEqual([]);
    // The published declarations' text (outside comments) names none of these either.
    for (const file of [publishedTypes("."), publishedTypes("./client")]) {
      const offending = wordsOf(readFileSync(file, "utf8")).filter((w) => FORBIDDEN.test(w));
      expect(offending, file).toStrictEqual([]);
    }
  });
});
