/**
 * E2E-016 — Architecture review, scan part (Where: Local; the review part is a milestone item
 * done by F-04 and recorded in validation/reviews/E2E-016.md, not here).
 *
 * "An automated scan of every app-facing contract (docs/contracts/ts/ excluding internal/, and
 * framework.openapi.yaml) finds no provider or protocol terms. The scan uses case-sensitive
 * whole-word matching over identifiers, string literals, and comments. Its term list is kept in
 * one file." The file is tests/compliance/e2e/terms.txt.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { REPO_ROOT } from "./support/process.js";
import { listFiles, readTerms, scanTextTerms, scanTypeScriptTerms, type TermFinding } from "./support/scan.js";

const TERMS_FILE = join(REPO_ROOT, "tests", "compliance", "e2e", "terms.txt");
const TS_CONTRACTS = join(REPO_ROOT, "docs", "contracts", "ts");
const OPENAPI = join(REPO_ROOT, "docs", "contracts", "http", "framework.openapi.yaml");

/** The term list as the scenario states it. */
function scenarioTerms(): string[] {
  const text = readFileSync(join(REPO_ROOT, "docs", "acceptance", "e2e-scenarios.md"), "utf8");
  const section = text.slice(text.indexOf("#### E2E-016"));
  const m = /term list is kept in one file:\s*([^.]+)\./.exec(section);
  if (m?.[1] === undefined) throw new Error("e2e-scenarios.md E2E-016: the term list sentence was not found");
  return m[1].split(",").map((t) => t.trim()).filter((t) => t !== "");
}

/** Every app-facing contract file: `docs/contracts/ts/**` except `internal/`, plus the OpenAPI file. */
function contractFiles(): string[] {
  const ts = listFiles(TS_CONTRACTS, new Set(["internal"])).filter((f) => f.endsWith(".ts"));
  return [...ts, OPENAPI];
}

function describe(file: string, f: TermFinding): string {
  return `${relative(REPO_ROOT, file)}:${String(f.line)} ${f.where} "${f.term}" in ${JSON.stringify(f.text)}`;
}

test(tag("E2E-016", "scan part: the term list file holds exactly the scenario's terms"), () => {
  const listed = readTerms(TERMS_FILE);
  expect(new Set(listed).size, "terms.txt lists a term twice").toBe(listed.length);
  expect([...listed].sort()).toEqual([...scenarioTerms()].sort());
});

test(tag("E2E-016", "scan part: the scanner finds each term in identifiers, string literals and comments, case-sensitively and by whole word"), () => {
  const terms = readTerms(TERMS_FILE);
  // Positive controls: each term planted once as an identifier, a string, and a comment.
  for (const term of terms) {
    const capitalised = term.charAt(0).toUpperCase() + term.slice(1);
    const ident = term.includes(" ")
      ? term.split(/\s+/).map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join("")
      : `get${capitalised}Client`;
    const sources = [`export declare const ${ident}: number;`, `export type X = "uses ${term} here";`, `/** Talks to ${term}. */\nexport type Y = number;`];
    for (const source of sources) {
      expect(scanTypeScriptTerms(source, [term]).map((f) => f.term), `planted ${JSON.stringify(term)} not found in: ${source}`).toEqual([term]);
    }
    expect(scanTextTerms(`description: Uses ${term} underneath.`, [term]).map((f) => f.term)).toEqual([term]);
  }
  // Negative controls: other case, and longer words, are not matches.
  expect(scanTypeScriptTerms(`/** google, workers, AWSome, D12, issuers, Lambdas */ export declare const sr2: number;`, terms)).toEqual([]);
  expect(scanTextTerms("summary: the google issuers list (D10, S30)", terms)).toEqual([]);
});

test(tag("E2E-016", "scan part: no app-facing contract contains a provider or protocol term"), () => {
  const terms = readTerms(TERMS_FILE);
  const files = contractFiles();
  // The scanned set must be the real contract set, not an empty directory.
  expect(files.map((f) => relative(TS_CONTRACTS, f))).toEqual(expect.arrayContaining(["index.d.ts", "client.d.ts", "testing.d.ts", "errors.d.ts"]));
  expect(files.some((f) => f.includes(`${"/"}internal${"/"}`))).toBe(false);
  const findings: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const found = file.endsWith(".ts") ? scanTypeScriptTerms(source, terms) : scanTextTerms(source, terms);
    findings.push(...found.map((f) => describe(file, f)));
  }
  expect(findings, `provider or protocol terms in app-facing contracts:\n${findings.join("\n")}`).toEqual([]);
});
