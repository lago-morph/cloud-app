/**
 * HTTP-AC-002: for every catalogue code with a status, a reference route throwing it returns that
 * status and a schema-valid ErrorResponse with the request's ID; an error containing a known
 * secret value is not echoed (docs/components/http.md §4; routes: apps/reference/ROUTES.md
 * "Error routes").
 *
 * Codes that only an outage or an unset secret can raise (`*.UNAVAILABLE`, `SEC.MISSING`) cannot
 * be caused on the run's shared deployment. Locally they are raised in-process with
 * `createTestApp` (`unavailable`, no secret value), which is how ROUTES.md says those routes are
 * driven. On a cloud, `SEC.MISSING` is checked on a further stage after the secret is deleted
 * (secrets/further-stage.test.ts); the `*.UNAVAILABLE` codes have no cloud trigger (decisions C-T1).
 */
import { describe, expect, it } from "vitest";
import { client, tag, type ComplianceClient, type HttpResponse } from "../../harness/index.js";
import { referenceTestApp, jsonOf } from "../core/support/in-process.js";
import { errorCatalogue, errorResponseViolations, isLocal, maxJsonBodyBytes, UUID } from "../core/support/repo.js";
import { testSecretValue } from "../core/support/stores.js";

/** Codes with a status that no app route can raise, with the reason (ROUTES.md; DEC-0168). */
const NO_ROUTE: Readonly<Record<string, string>> = {
  "AUTH.LOGIN_FAILED": "app code may not raise it and the framework's callback answers a failed login with a redirect, not an ErrorResponse (DEC-0168, ROUTES.md)",
  "AUTH.NOT_VERIFIED": "app code may not raise it; only the password provider's routes do (PWD §2, DEC-0520, ROUTES.md)",
  "AUTH.RATE_LIMITED": "app code may not raise it; only the password provider's routes do (PWD §2, DEC-0520, ROUTES.md)",
};

/** Codes raised only by an outage or a missing secret value: in-process, local only (see header). */
const CONDITION_ONLY: Readonly<Record<string, { readonly unavailable?: readonly ("sql" | "kv" | "files" | "secrets")[] }>> = {
  "SQL.UNAVAILABLE": { unavailable: ["sql"] },
  "KV.UNAVAILABLE": { unavailable: ["kv"] },
  "FILES.UNAVAILABLE": { unavailable: ["files"] },
  "SEC.UNAVAILABLE": { unavailable: ["secrets"] },
  "SEC.MISSING": {},
};

type Raise = (c: ComplianceClient) => Promise<HttpResponse>;

function oversizedJson(bytes: number): string {
  const prefix = '{"text":"';
  const suffix = '"}';
  return `${prefix}${"a".repeat(bytes - prefix.length - suffix.length)}${suffix}`;
}

/** How each code is raised on the deployed reference app (ROUTES.md "Error routes", "Caller must"). */
const RAISE: Readonly<Record<string, Raise>> = {
  "CORE.INTERNAL": (c) => c.get("/api/errors/CORE.INTERNAL"),
  "CORE.MISCONFIGURED": (c) => c.get("/api/errors/CORE.MISCONFIGURED"),
  "HTTP.INVALID_INPUT": (c) => c.get("/api/errors/HTTP.INVALID_INPUT"),
  "HTTP.NOT_FOUND": (c) => c.get("/api/errors/HTTP.NOT_FOUND"),
  "HTTP.METHOD_NOT_ALLOWED": (c) => c.get("/api/errors/HTTP.METHOD_NOT_ALLOWED"),
  "HTTP.PAYLOAD_TOO_LARGE": (c) =>
    c.request("POST", "/api/errors/HTTP.PAYLOAD_TOO_LARGE", { body: oversizedJson(maxJsonBodyBytes() + 1), headers: { "content-type": "application/json" } }),
  "HTTP.CONFLICT": (c) => c.get("/api/errors/HTTP.CONFLICT"),
  "SQL.CONFLICT": (c) => c.get("/api/errors/SQL.CONFLICT"),
  "SQL.INVALID_VALUE": (c) => c.get("/api/errors/SQL.INVALID_VALUE"),
  "SQL.RESULT_TOO_LARGE": (c) => c.get("/api/errors/SQL.RESULT_TOO_LARGE"),
  "KV.INVALID_KEY": (c) => c.get("/api/errors/KV.INVALID_KEY"),
  "KV.INVALID_CURSOR": (c) => c.get("/api/errors/KV.INVALID_CURSOR"),
  "KV.VALUE_TOO_LARGE": (c) => c.get("/api/errors/KV.VALUE_TOO_LARGE"),
  "FILES.INVALID_NAME": (c) => c.get("/api/errors/FILES.INVALID_NAME"),
  "FILES.INVALID_CURSOR": (c) => c.get("/api/errors/FILES.INVALID_CURSOR"),
  "FILES.NOT_FOUND": (c) => c.get("/api/errors/FILES.NOT_FOUND"),
  "CFG.UNDECLARED_KEY": (c) => c.get("/api/errors/CFG.UNDECLARED_KEY"),
  "SEC.UNDECLARED": (c) => c.get("/api/errors/SEC.UNDECLARED"),
  "AUTH.UNAUTHENTICATED": (c) => c.get("/api/errors/AUTH.UNAUTHENTICATED"),
  "AUTH.FORBIDDEN": (c) => c.get("/api/errors/AUTH.FORBIDDEN"),
  "AUTH.REQUEST_FORGERY": async (c) => {
    const user = await c.as("user", { id: "c-t1-http-ac-002-forgery" });
    return user.post("/api/errors/AUTH.REQUEST_FORGERY", {}, { origin: "https://evil.example" });
  },
};

function checkErrorResponse(r: HttpResponse, status: number, code: string, seenIds: Set<string>): void {
  if (r.status !== status || r.errorCode !== code) throw new Error(`${code}: ${r.method} ${r.path} → status ${String(r.status)}, code ${r.errorCode ?? "none"}, requestId ${r.requestId ?? "none"} (expected ${String(status)} ${code})`);
  expect(r.headers.get("content-type") ?? "", code).toMatch(/^application\/json\b/);
  expect(errorResponseViolations(r.json()), code).toEqual([]);
  const id = r.requestId ?? "";
  expect(id, `${code}: requestId`).toMatch(UUID);
  expect(seenIds.has(id), `${code}: requestId ${id} is the request's own, not reused from another request`).toBe(false);
  seenIds.add(id);
}

describe("HTTP: error format", () => {
  it(tag("HTTP-AC-002", "every catalogue code with a status is raised by a reference route with that status and a schema-valid ErrorResponse carrying the request's own ID"), async () => {
    const withStatus = errorCatalogue().filter((e) => e.status !== null);
    const unmapped = withStatus.map((e) => e.code).filter((code) => RAISE[code] === undefined && CONDITION_ONLY[code] === undefined && NO_ROUTE[code] === undefined);
    expect(unmapped, "catalogue codes with a status that this test does not raise").toEqual([]);

    const c = client();
    const seen = new Set<string>();
    for (const { code, status } of withStatus) {
      const raise = RAISE[code];
      if (raise === undefined || status === null) continue;
      const r = await raise(c);
      checkErrorResponse(r, status, code, seen);
      if (code === "HTTP.METHOD_NOT_ALLOWED") expect((r.headers.get("allow") ?? "").toUpperCase(), "Allow header").toContain("POST");
    }
  });

  it(tag("HTTP-AC-002", "a route throwing an error whose message contains the known test secret value does not echo it, for a 500 and for a 409"), async () => {
    const secret = testSecretValue();
    const c = client();
    const seen = new Set<string>();
    const plain = await c.get("/api/ref/throw-secret");
    checkErrorResponse(plain, 500, "CORE.INTERNAL", seen);
    expect(plain.text.includes(secret), "500 response echoes the secret value").toBe(false);
    const app = await c.get("/api/ref/throw-secret-app");
    checkErrorResponse(app, 409, "HTTP.CONFLICT", seen);
    expect(app.text.includes(secret), "409 response echoes the secret value").toBe(false);
    for (const r of [plain, app]) {
      for (const [name, value] of r.headers) expect(value.includes(secret), `header ${name} echoes the secret value`).toBe(false);
    }
  });

  // The criterion's outage and missing-secret codes, raised as ROUTES.md says (createTestApp's
  // `unavailable`, no secret value): an in-process, local-only part (see the file header).
  if (isLocal()) {
    it(tag("HTTP-AC-002", "in-process (local part): the outage codes and SEC.MISSING return their catalogue status and a schema-valid ErrorResponse"), async () => {
      const catalogue = new Map(errorCatalogue().map((e) => [e.code, e.status]));
      const seen = new Set<string>();
      for (const [code, condition] of Object.entries(CONDITION_ONLY)) {
        const status = catalogue.get(code);
        expect(status, `${code} has a status in the catalogue`).toEqual(expect.any(Number));
        const app = await referenceTestApp({ ...(condition.unavailable === undefined ? {} : { unavailable: condition.unavailable }), ...(code === "SEC.MISSING" ? {} : { secrets: { apiKey: "c-t1-in-process-value" } }) });
        try {
          const response = await app.request(`/api/errors/${code}`);
          const body = await jsonOf(response);
          const error = (body as { error?: { code?: string; requestId?: string } } | undefined)?.error;
          expect({ status: response.status, code: error?.code }, code).toEqual({ status, code });
          expect(response.headers.get("content-type") ?? "", code).toMatch(/^application\/json\b/);
          expect(errorResponseViolations(body), code).toEqual([]);
          expect(error?.requestId ?? "", code).toMatch(UUID);
          expect(seen.has(error?.requestId ?? ""), `${code}: requestId reused`).toBe(false);
          seen.add(error?.requestId ?? "");
        } finally {
          await app.dispose();
        }
      }
    });
  }
});
