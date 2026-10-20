/**
 * E2E-013 — Errors are uniform and safe (Where: Local, cloud).
 *
 * Against the reference app, send invalid input, an unauthenticated request, a forbidden
 * request, a request to an unknown route, and a request to the route that throws a plain
 * `Error`. Pass: every response is a catalogue error with the right status; none contains stack
 * traces, provider messages, or secret values.
 *
 * Secret values: the reference app's secret `apiKey` is found through its SHA-256
 * (`GET /api/ref/secret`), so the check needs no copy of the value and works on every target;
 * locally, every value in the app's `.dev.vars` (the app secret and the framework's own dev
 * keys) is checked as well. Values are compared, never printed.
 */
import { ERROR_CATALOGUE } from "@lago-morph/prototype-framework";
import { client, tag, target, type ComplianceClient, type HttpResponse } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { REFERENCE_DIR } from "./support/process.js";
import { bodyTexts, containsValueWithDigest, sha256Hex } from "./support/scan.js";
import { apiKeyDigest, localDevVarValues } from "./support/secrets.js";

type Catalogue = Readonly<Record<string, { readonly status: number | null }>>;
const CATALOGUE: Catalogue = ERROR_CATALOGUE;

/** Signs of a stack trace in a response. */
const STACK = [/\n\s+at\s/, /\bat\s+[\w$.<>]+\s+\(/, /\(?(?:file:\/\/|\/)[^\s)]+\.(?:ts|js|mjs):\d+(?::\d+)?\)?/, /\b(?:TypeError|ReferenceError|RangeError|SyntaxError)\b/, /\bError:\s/];
/** Signs of a provider's own message (database, runtime, validation library or platform). */
const PROVIDER = [/D1_[A-Z_]+/, /\bSQLITE_[A-Z_]+\b/, /\bsqlite\b/i, /\bpostgres(?:ql)?\b/i, /\bpglite\b/i, /\bworkerd\b/i, /\bminiflare\b/i, /\bwrangler\b/i, /\bcloudflare\b/i, /\bdrizzle\b/i, /\bZodError\b/, /"issues"\s*:/, /\bhono\b/i, /\bSQLSTATE\b/i, /\bECONNREFUSED\b/];
/** The plain Error's own message must stay in the log (HTTP: 5xx responses carry only the catalogue meaning). */
const PLAIN_ERROR_MESSAGE = "reference plain error";

interface Sent {
  readonly what: string;
  readonly response: HttpResponse;
  readonly status: number;
  readonly code: string;
}

function checkCatalogueError(api: ComplianceClient, sent: Sent): void {
  const { response } = sent;
  api.expectError(response, sent.status, sent.code);
  expect(CATALOGUE[sent.code]?.status, `${sent.code} is a catalogue code with status ${String(sent.status)}`).toBe(sent.status);
  expect(response.headers.get("content-type") ?? "", `${sent.what}: JSON error response`).toMatch(/^application\/json/);
  const body = response.json<unknown>();
  // ErrorResponse: exactly { error: { code, message, requestId } } (framework.openapi.yaml).
  expect(body, `${sent.what}: ErrorResponse shape`).toEqual({ error: { code: sent.code, message: expect.any(String), requestId: expect.any(String) } });
  expect(Object.keys(body as object)).toEqual(["error"]);
  expect(Object.keys((body as { error: object }).error).sort()).toEqual(["code", "message", "requestId"]);
  expect(response.requestId ?? "", `${sent.what}: requestId`).not.toBe("");
}

function checkSafe(sent: Sent, secrets: { readonly digest: string; readonly values: readonly string[] }): void {
  const raw = sent.response.text;
  for (const pattern of STACK) expect(pattern.test(raw), `${sent.what}: response contains what looks like a stack trace (${String(pattern)}): ${raw}`).toBe(false);
  for (const pattern of PROVIDER) expect(pattern.test(raw), `${sent.what}: response contains what looks like a provider message (${String(pattern)}): ${raw}`).toBe(false);
  expect(raw.includes(PLAIN_ERROR_MESSAGE), `${sent.what}: the thrown Error's own message reached the response`).toBe(false);
  // Never print the value: the assertion message names only where it was found.
  const texts = bodyTexts(raw);
  for (const name of [...sent.response.headers.keys()]) texts.push(sent.response.headers.get(name) ?? "");
  const byDigest = texts.some((t) => containsValueWithDigest(t, secrets.digest));
  expect(byDigest, `${sent.what}: the response contains the value of the secret apiKey`).toBe(false);
  const byValue = secrets.values.some((v) => texts.some((t) => t.includes(v)));
  expect(byValue, `${sent.what}: the response contains a local secret value from .dev.vars`).toBe(false);
}

test(tag("E2E-013", "invalid input, unauthenticated, forbidden, unknown route and plain-Error requests get catalogue errors with no stack traces, provider messages or secret values"), async () => {
  // Control: the digest search finds a planted value.
  expect(containsValueWithDigest(`{"m":"x-planted-value-y"}`, sha256Hex("planted-value"))).toBe(true);
  const anonymous = client();
  const user = await client().as("user", { id: `e2e013-${randomSuffix()}`, displayName: "E2E Thirteen" });
  const secrets = {
    digest: await apiKeyDigest(anonymous),
    values: target().target === "local" ? localDevVarValues(REFERENCE_DIR) : [],
  };

  const sent: Sent[] = [
    // Invalid input: a body that fails the route's schema, and a missing required query value.
    { what: "invalid body", response: await anonymous.post("/api/ref/echo", { text: 42 }), status: 400, code: "HTTP.INVALID_INPUT" },
    { what: "invalid query", response: await anonymous.get("/api/ref/echo"), status: 400, code: "HTTP.INVALID_INPUT" },
    // Unauthenticated: a user route, anonymously (GET and a state-changing POST).
    { what: "unauthenticated GET", response: await anonymous.get("/api/levels/user"), status: 401, code: "AUTH.UNAUTHENTICATED" },
    { what: "unauthenticated POST", response: await anonymous.post("/api/levels/user", {}), status: 401, code: "AUTH.UNAUTHENTICATED" },
    // Forbidden: an admin route, as a user.
    { what: "forbidden GET", response: await user.get("/api/levels/admin"), status: 403, code: "AUTH.FORBIDDEN" },
    { what: "forbidden POST", response: await user.post("/api/levels/admin", {}), status: 403, code: "AUTH.FORBIDDEN" },
    // Unknown route.
    { what: "unknown route", response: await anonymous.get(`/api/e2e013-unknown-${randomSuffix()}`), status: 404, code: "HTTP.NOT_FOUND" },
    { what: "unknown route (POST, user)", response: await user.post(`/api/e2e013-unknown-${randomSuffix()}`, {}), status: 404, code: "HTTP.NOT_FOUND" },
    // The route that throws a plain Error.
    { what: "plain Error", response: await anonymous.get("/api/ref/throw-plain"), status: 500, code: "CORE.INTERNAL" },
    { what: "plain Error (user)", response: await user.get("/api/ref/throw-plain"), status: 500, code: "CORE.INTERNAL" },
  ];

  for (const s of sent) {
    checkCatalogueError(anonymous, s);
    checkSafe(s, secrets);
  }
  // Each response carries its own request ID.
  expect(new Set(sent.map((s) => s.response.requestId)).size).toBe(sent.length);
});
