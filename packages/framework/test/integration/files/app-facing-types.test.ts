/**
 * FILES-AC-004 inspection part (FILES-REQ-004): contract and type inspection finds no
 * storage-service names or credentials in app-facing types, and tickets have no readable
 * fields. The browser part (unrelated origin) is in transfers.spec.ts.
 *
 * Inspects (1) the contract files docs/contracts/ts/{files,client}.d.ts and (2) the types the
 * framework's app-facing entry points (`<package>` = src/index.ts, `<package>/client` =
 * src/client/index.ts) actually export, with the TypeScript compiler API.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DownloadTicket, UploadTicket } from "../../../src/index.js";
import { tag } from "../../../../../tests/support/tags.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const frameworkRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(frameworkRoot, "../..");

/** Storage services, signing and credential vocabulary that must not appear in app-facing FILES types. */
const FORBIDDEN =
  /\b\w*(r2|s3|bucket|aws|amz|sigv4|signature|signed|signing|credential|accesskey|access_key|secretkey|secret_key|sessiontoken|session_token|token|hmac|cors|crossorigin|binding|miniflare|wrangler|presign|endpoint|region|accountid)\w*\b/i;

/** FILES-related names exported by the app-facing entry points. */
const SERVER_NAMES = ["FilesService", "FileInfo", "FileContent", "FilesListOptions", "FilesListPage", "UploadTicket", "UploadTicketOptions", "DownloadTicket"];
const CLIENT_NAMES = ["uploadFile", "downloadUrl", "TransferProgress", "UploadTicket", "DownloadTicket"];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function identifiersOf(source: string): string[] {
  return stripComments(source).match(/[A-Za-z_$][\w$]*/g) ?? [];
}

describe("FILES app-facing types", () => {
  it(tag("FILES-AC-004", "contract inspection: files.d.ts and client.d.ts declare no storage-service, signing or credential names"), () => {
    for (const file of ["docs/contracts/ts/files.d.ts", "docs/contracts/ts/client.d.ts"]) {
      const offending = identifiersOf(readFileSync(path.join(repoRoot, file), "utf8")).filter((id) => FORBIDDEN.test(id));
      expect(offending, file).toStrictEqual([]);
    }
  });

  it(tag("FILES-AC-004", "type inspection: exported FILES types and helpers expose no storage-service, signing or credential names"), () => {
    const entries = [path.join(frameworkRoot, "src/index.ts"), path.join(frameworkRoot, "src/client/index.ts")];
    const program = ts.createProgram(entries, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
      lib: ["lib.es2023.d.ts", "lib.dom.d.ts"],
    });
    const checker = program.getTypeChecker();
    const found: string[] = [];
    const seen = new Set<ts.Type>();

    const isFrameworkDeclared = (type: ts.Type): boolean => {
      const decls = (type.aliasSymbol ?? type.getSymbol())?.getDeclarations() ?? [];
      return decls.some((d) => path.resolve(d.getSourceFile().fileName).startsWith(path.join(frameworkRoot, "src")));
    };

    const visit = (type: ts.Type, where: string, depth: number): void => {
      if (depth > 6 || seen.has(type)) return;
      seen.add(type);
      if (type.isUnionOrIntersection()) {
        for (const t of type.types) visit(t, where, depth + 1);
        return;
      }
      // Unwrap Promise<T>, arrays and other generic references to reach framework types.
      if (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference) {
        for (const arg of checker.getTypeArguments(type as ts.TypeReference)) visit(arg, where, depth + 1);
      }
      for (const sig of type.getCallSignatures()) {
        for (const p of sig.getParameters()) {
          if (FORBIDDEN.test(p.getName())) found.push(`${where}(${p.getName()})`);
          const decl = p.valueDeclaration ?? p.declarations?.[0];
          if (decl !== undefined) visit(checker.getTypeOfSymbolAtLocation(p, decl), `${where}(${p.getName()})`, depth + 1);
        }
        visit(sig.getReturnType(), `${where}()`, depth + 1);
      }
      if (!isFrameworkDeclared(type)) return;
      for (const prop of type.getProperties()) {
        const name = prop.getName();
        // A unique-symbol brand key is rendered as "__@ticketBrand@123": it has no readable name.
        const readable = name.startsWith("__@") ? "" : name;
        if (readable !== "" && FORBIDDEN.test(readable)) found.push(`${where}.${readable}`);
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        if (decl !== undefined) visit(checker.getTypeOfSymbolAtLocation(prop, decl), `${where}.${readable || "<brand>"}`, depth + 1);
      }
    };

    const inspect = (entry: string, names: string[]): void => {
      const source = program.getSourceFile(entry);
      expect(source, entry).toBeDefined();
      const moduleSymbol = checker.getSymbolAtLocation(source as ts.SourceFile);
      expect(moduleSymbol, entry).toBeDefined();
      const exports = new Map(checker.getExportsOfModule(moduleSymbol as ts.Symbol).map((s) => [s.getName(), s]));
      for (const name of names) {
        const exported = exports.get(name);
        expect(exported, `${path.basename(entry)} exports ${name}`).toBeDefined();
        const symbol = exported !== undefined && exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
        if (symbol === undefined) continue;
        const type = symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Class)
          ? checker.getDeclaredTypeOfSymbol(symbol)
          : checker.getTypeOfSymbol(symbol);
        visit(type, name, 0);
      }
    };
    inspect(entries[0] as string, SERVER_NAMES);
    inspect(entries[1] as string, CLIENT_NAMES);
    expect(found).toStrictEqual([]);
  });

  it(tag("FILES-AC-004", "tickets are opaque: no readable fields on UploadTicket or DownloadTicket"), () => {
    expectTypeOf<keyof UploadTicket>().toBeSymbol();
    expectTypeOf<keyof DownloadTicket>().toBeSymbol();
    const readUrl = (ticket: UploadTicket, download: DownloadTicket): unknown[] => [
      // @ts-expect-error tickets have no readable url
      ticket.url,
      // @ts-expect-error tickets have no readable headers
      ticket.headers,
      // @ts-expect-error tickets have no readable url
      download.url,
      // @ts-expect-error tickets have no readable expiry
      download.expiresAt,
    ];
    expect(typeof readUrl).toBe("function");
  });
});
