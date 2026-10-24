/**
 * Runs the reference app's shared case sets (`apps/reference/src/server/cases/**`, ROUTES.md
 * "Shared case sets") in one of three places, with the same request and the same answer shape:
 *
 * - in-process on local D1 or PGlite: `createTestApp(referenceApp)` (testing.d.ts) and
 *   `POST /api/cases/run` inside the test process. The SQL dialect is fixed per process
 *   (`PROTOTYPE_FRAMEWORK_DIALECT`, DEC-0134), so each dialect has its own entry file, which
 *   selects it before this module loads the framework;
 * - through HTTP against the target's reference app (`client()`: `dev` locally, the test
 *   stage on a cloud).
 *
 * The case answer is `{ outcome: "value", value }`, `{ outcome: "undefined" }`, or the
 * framework's ErrorResponse. Failures name the case, status, code and requestId, like the
 * harness's HttpCheckError, so evidence `detail` carries them (COMPL-REQ-003).
 */
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { approxEqual, client, type HttpResponse } from "../../../harness/index.js";

export type Dialect = "sqlite" | "postgres";

/** Where the cases run, for test titles. */
export type Place = "in-process local D1" | "in-process PGlite" | "reference app over HTTP";

export interface CaseResult {
  readonly status: number;
  readonly outcome?: "value" | "undefined";
  readonly value?: unknown;
  readonly code?: string;
  readonly requestId?: string;
  readonly describe: string;
}

export interface CaseRunner {
  readonly place: Place;
  run(set: string, name: string, input?: unknown): Promise<CaseResult>;
  dispose(): Promise<void>;
}

export interface InProcessOptions {
  /** createTestApp's `unavailable` option (testing.d.ts). */
  readonly unavailable?: readonly ("sql" | "kv" | "files" | "secrets")[];
}

/** A namespace for one suite run: `c-t2-` plus random lowercase hex. */
export function newNamespace(): string {
  return `c-t2-${randomBytes(8).toString("hex")}`;
}

const REFERENCE_APP = fileURLToPath(new URL("../../../../../apps/reference/src/app.ts", import.meta.url));

function parse(status: number, text: string, describe: string): CaseResult {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { status, describe };
  }
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error?: { code?: unknown; requestId?: unknown } }).error;
    return {
      status,
      describe,
      ...(typeof error?.code === "string" ? { code: error.code } : {}),
      ...(typeof error?.requestId === "string" ? { requestId: error.requestId } : {}),
    };
  }
  const answer = body as { outcome?: unknown; value?: unknown };
  if (answer.outcome === "undefined") return { status, describe, outcome: "undefined" };
  if (answer.outcome === "value") return { status, describe, outcome: "value", value: answer.value };
  return { status, describe };
}

/**
 * In-process runner. The caller's entry file must have selected the dialect
 * (`PROTOTYPE_FRAMEWORK_DIALECT`) before importing this module's caller chain, since the
 * reference app's tables are built for the dialect when its schema module is imported.
 */
export async function inProcessRunner(dialect: Dialect, options: InProcessOptions = {}): Promise<CaseRunner> {
  if ((process.env.PROTOTYPE_FRAMEWORK_DIALECT ?? "sqlite") !== dialect) {
    throw new Error(`in-process ${dialect} runner: PROTOTYPE_FRAMEWORK_DIALECT is ${process.env.PROTOTYPE_FRAMEWORK_DIALECT ?? "unset"}; select the dialect in the entry file first`);
  }
  const testing = await import("@lago-morph/prototype-framework/testing");
  const loaded: unknown = await import(/* @vite-ignore */ REFERENCE_APP);
  const app = (loaded as { default: Parameters<typeof testing.createTestApp>[0] }).default;
  const testApp = await testing.createTestApp(app, { user: testing.mockUsers.user("c-t2-cases"), ...(options.unavailable === undefined ? {} : { unavailable: options.unavailable }) });
  const place: Place = dialect === "sqlite" ? "in-process local D1" : "in-process PGlite";
  return {
    place,
    async run(set, name, input) {
      const response = await testApp.request("/api/cases/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input === undefined ? { set, name } : { set, name, input }),
      });
      return parse(response.status, await response.text(), `${place}: case ${set}/${name}`);
    },
    dispose: () => testApp.dispose(),
  };
}

/** HTTP runner against this run's target (a logged-in user: the case routes need one). */
export async function httpRunner(): Promise<CaseRunner> {
  const user = await client().as("user", { id: "c-t2-cases" });
  return {
    place: "reference app over HTTP",
    async run(set, name, input) {
      const response: HttpResponse = await user.post("/api/cases/run", input === undefined ? { set, name } : { set, name, input });
      return parse(response.status, response.text, `case ${set}/${name}`);
    },
    dispose: () => Promise.resolve(),
  };
}

function failure(result: CaseResult, expectation: string): Error {
  return new Error(
    `case check failed: ${result.describe} → status ${String(result.status)}, code ${result.code ?? "none"}, requestId ${result.requestId ?? "none"} (${expectation})`,
  );
}

/** The case's value; fails with status, code and requestId when the case did not answer with one. */
export function valueOf(result: CaseResult): unknown {
  if (result.status !== 200 || result.outcome !== "value") throw failure(result, "expected a value");
  return result.value;
}

/** Fails unless the case answered `{ outcome: "undefined" }`. */
export function expectUndefined(result: CaseResult): void {
  if (result.status !== 200 || result.outcome !== "undefined") throw failure(result, "expected the case to resolve to undefined");
}

/** Fails unless the case was rejected with this status and catalogue code. */
export function expectCaseError(result: CaseResult, status: number, code: string): void {
  if (result.status !== status || result.code !== code) throw failure(result, `expected status ${String(status)} with code ${code}`);
}

/** Deep equality with PAR-280 for numbers (compliance.md "Comparisons"); shows a diff on failure. */
export function expectApprox(actual: unknown, expected: unknown): void {
  if (!approxEqual(actual, expected)) expect(actual).toEqual(expected);
  // approxEqual rejected but toEqual accepted: only possible for values toEqual treats loosely.
  if (!approxEqual(actual, expected)) throw new Error(`values differ: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`);
}

