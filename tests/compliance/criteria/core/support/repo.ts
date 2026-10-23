/**
 * Shared support for the C-T1 compliance criteria (core, http, log, config, secrets, cli).
 * Written from the criteria, the contracts and apps/reference/ROUTES.md, not from the
 * implementation. Assumptions: DEC-0277…DEC-0280 (docs/decisions/decision-log.md, Item: C-T1).
 *
 * This module: repository paths, the run's deployment (app, stage, target), contract data read
 * from docs/ (error catalogue, parameters, schemas), and small value helpers.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { target, type TargetEnv } from "../../../harness/index.js";

const here = dirname(fileURLToPath(import.meta.url));

/** tests/compliance/criteria/core/support → repository root. */
export const REPO_ROOT = resolve(here, "../../../../..");
export const DOCS = join(REPO_ROOT, "docs");
export const REFERENCE_DIR = join(REPO_ROOT, "apps", "reference");
export const TEMPLATE_DIR = join(REPO_ROOT, "apps", "template");
export const FRAMEWORK_DIR = join(REPO_ROOT, "packages", "framework");
/** The package's own binary (CLI-REQ-001). */
export const BIN = join(FRAMEWORK_DIR, "bin", "prototype-framework.js");
export const PACKAGE_NAME = "@lago-morph/prototype-framework";
export const REFERENCE_APP_NAME = "reference";
export const TEMPLATE_APP_NAME = "template";

export interface RunDeployment {
  readonly target: TargetEnv["target"];
  readonly app: string;
  /** `local` for the local `dev` server (CFG §2: local development uses one local stage), else the run's test stage. */
  readonly stage: string;
  readonly isCloud: boolean;
}

/** The reference app deployment this run addresses. */
export function runDeployment(): RunDeployment {
  const env = target();
  const isCloud = env.target !== "local";
  const stage = isCloud ? env.stage : "local";
  if (stage === undefined) throw new Error(`COMPLIANCE_STAGE is not set for target ${env.target}: run through \`npm run compliance -- --target ${env.target}\``);
  return { target: env.target, app: REFERENCE_APP_NAME, stage, isCloud };
}

export function isLocal(): boolean {
  return target().target === "local";
}

/** A recognisable unique value (letters and digits only, so no quoting rule applies to it). */
export function uniqueValue(label: string): string {
  return `${label}${randomBytes(12).toString("hex")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** `yyyy-mm-dd` of `date` in UTC. */
export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------------------------
// Contract data from docs/
// ---------------------------------------------------------------------------------------------

/** One error catalogue entry as docs/contracts/ts/errors.d.ts declares it. */
export interface CatalogueCode {
  readonly code: string;
  readonly status: number | null;
}

/** The error catalogue read from the contract file (errors.d.ts), in file order. */
export function errorCatalogue(): CatalogueCode[] {
  const text = readFileSync(join(DOCS, "contracts", "ts", "errors.d.ts"), "utf8");
  const out: CatalogueCode[] = [];
  for (const m of text.matchAll(/readonly\s+"([A-Z]+\.[A-Z_]+)":\s*\{\s*status:\s*(null|\d+)\s*;/g)) {
    const code = m[1] ?? "";
    out.push({ code, status: m[2] === "null" ? null : Number(m[2]) });
  }
  if (out.length === 0) throw new Error("could not read the error catalogue from docs/contracts/ts/errors.d.ts");
  return out;
}

export function catalogueStatus(code: string): number {
  const entry = errorCatalogue().find((e) => e.code === code);
  if (entry?.status === undefined || entry.status === null) throw new Error(`${code} has no HTTP status in the catalogue`);
  return entry.status;
}

/** The numeric value of a parameter in docs/parameters/parameters.md (the first number in its value cell, commas removed). */
export function parameterNumber(id: string): number {
  const text = readFileSync(join(DOCS, "parameters", "parameters.md"), "utf8");
  const row = text.split("\n").find((line) => line.startsWith(`| ${id} |`));
  const cell = row?.split("|")[3]?.trim();
  const m = cell === undefined ? null : /([\d,]+(?:\.\d+)?)/.exec(cell);
  if (m?.[1] === undefined) throw new Error(`parameter ${id} not found in docs/parameters/parameters.md`);
  return Number(m[1].replace(/,/g, ""));
}

/** PAR-200 — maximum JSON request body, bytes. */
export function maxJsonBodyBytes(): number {
  return parameterNumber("PAR-200");
}

/** PAR-260 — maximum time a response waits for pending log writes, in ms (the parameter is in seconds). */
export function logWaitMs(): number {
  return parameterNumber("PAR-260") * 1000;
}

interface SchemaProperty {
  readonly type?: string;
  readonly enum?: readonly string[];
  readonly format?: string;
}
interface ObjectSchema {
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly properties?: Record<string, SchemaProperty>;
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Violations of docs/contracts/schemas/log-entry.schema.json by one stored entry: required
 * members, no additional members, string types, enums, and the date-time format.
 */
export function logEntryViolations(entry: unknown): string[] {
  const schema = JSON.parse(readFileSync(join(DOCS, "contracts", "schemas", "log-entry.schema.json"), "utf8")) as ObjectSchema;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return ["entry is not a JSON object"];
  const obj = entry as Record<string, unknown>;
  const props = schema.properties ?? {};
  const problems: string[] = [];
  for (const key of schema.required ?? []) if (!Object.hasOwn(obj, key)) problems.push(`missing ${key}`);
  for (const [key, value] of Object.entries(obj)) {
    const p = props[key];
    if (p === undefined) {
      if (schema.additionalProperties === false) problems.push(`unexpected member ${key}`);
      continue;
    }
    if (p.enum !== undefined) {
      if (typeof value !== "string" || !p.enum.includes(value)) problems.push(`${key}=${JSON.stringify(value)} is not one of ${p.enum.join(", ")}`);
      continue;
    }
    if (p.type === "string" && typeof value !== "string") problems.push(`${key} is not a string`);
    if (p.format === "date-time" && (typeof value !== "string" || !ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value)))) problems.push(`${key} is not a date-time`);
  }
  return problems;
}

/**
 * Violations of the `ErrorResponse` schema (docs/contracts/http/framework.openapi.yaml):
 * exactly `{ error: { code, message, requestId } }`, all strings, no other members.
 */
export function errorResponseViolations(body: unknown): string[] {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return ["body is not a JSON object"];
  const problems: string[] = [];
  const top = Object.keys(body);
  if (top.length !== 1 || top[0] !== "error") problems.push(`top-level members ${JSON.stringify(top)} (expected only "error")`);
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return [...problems, "error is not an object"];
  const members = Object.keys(error).sort();
  if (JSON.stringify(members) !== JSON.stringify(["code", "message", "requestId"])) problems.push(`error members ${JSON.stringify(members)} (expected code, message, requestId)`);
  for (const k of ["code", "message", "requestId"]) {
    if (typeof (error as Record<string, unknown>)[k] !== "string") problems.push(`error.${k} is not a string`);
  }
  return problems;
}

/** A logical secret name's SEC-REQ-003 location on `targetName` (`apiKey` → `SECRET_API_KEY`). */
export function secretLocation(targetName: string, app: string, stage: string, name: string): string {
  if (targetName === "aws") return `/${app}/${stage}/secrets/${name}`;
  return `SECRET_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

/**
 * The reference app's declared configuration defaults, as apps/reference/ROUTES.md
 * ("Configuration and secrets") lists them.
 */
export const REFERENCE_CONFIG_DEFAULTS: Readonly<Record<string, unknown>> = { greeting: "Hello", pageSize: 20, featureOn: false, tags: [] };

/** The reference app's declared secret names (ROUTES.md). */
export const REFERENCE_SECRETS: readonly string[] = ["apiKey"];

/** The committed values file a deployment of `app` on `targetName`/`stage` uses (CFG-REQ-002, CFG §2 "Files"). */
export function committedValuesFile(appDir: string, targetName: string, stage: string): string {
  if (targetName === "local") return join(appDir, "config", "local.json");
  return join(appDir, "config", targetName, stage.startsWith("test-") ? "test.json" : `${stage}.json`);
}

export interface StageValues {
  readonly values?: Record<string, unknown>;
  readonly framework?: { readonly admins?: readonly string[]; readonly users?: readonly string[] } & Record<string, unknown>;
}

export function readStageValues(path: string): StageValues {
  return JSON.parse(readFileSync(path, "utf8")) as StageValues;
}
