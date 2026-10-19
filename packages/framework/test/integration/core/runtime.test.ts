/**
 * CORE runtime criteria, in-process through `createTestApp` (testing.d.ts) with its real local
 * storage. Criteria: docs/components/core.md §4.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import { ERROR_CATALOGUE } from "../../../src/index.js";
import { errorBody, errorResponseViolations, STACK_FRAME } from "./harness/harness.js";
import { APP_NAME, createRefApp, PLAIN_ERROR_MESSAGE } from "./harness/reference-app.js";

let app: TestApp | undefined;
afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

/** The members of RequestVars (core.d.ts): Services plus user, deployment, requestId. */
const REQUEST_VARS_MEMBERS = ["config", "deployment", "files", "kv", "log", "requestId", "secrets", "sql", "user"];

describe("CORE runtime", () => {
  it(tag("CORE-AC-001", "runtime part: c.var has exactly the RequestVars members"), async () => {
    app = await createRefApp();
    const res = await app.request("/api/var-keys");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(REQUEST_VARS_MEMBERS);
  });

  it(tag("CORE-AC-003", "forged Host and forwarding headers do not change c.var.deployment, which has exactly app and stage"), async () => {
    app = await createRefApp();
    const baseline = await app.request("/api/deployment");
    expect(baseline.status).toBe(200);
    const deployment = (await baseline.json()) as Record<string, unknown>;
    expect(Object.keys(deployment).sort()).toEqual(["app", "stage"]);
    expect(deployment["app"]).toBe(APP_NAME);
    expect(typeof deployment["stage"]).toBe("string");
    expect(deployment["stage"]).not.toBe("");

    const forgeries: Record<string, string>[] = [
      { Host: "evilapp-test-forged.example" },
      { "X-Forwarded-Host": "evilapp-test-forged.example" },
      { Forwarded: "host=evilapp-test-forged.example;proto=https" },
      { "X-Forwarded-Proto": "https", "X-Forwarded-Host": "otherapp.example", "X-Forwarded-For": "203.0.113.9" },
      { "X-Original-Host": "evilapp.example", "X-Host": "evilapp.example", "X-Stage": "prod", "X-App": "evilapp" },
    ];
    for (const headers of forgeries) {
      const res = await app.request("/api/deployment", { headers });
      expect(res.status, JSON.stringify(headers)).toBe(200);
      expect(await res.json(), JSON.stringify(headers)).toEqual(deployment);
    }
  });

  it(tag("CORE-AC-004", "an app throwing a plain Error yields 500 CORE.INTERNAL with no stack trace or message details"), async () => {
    app = await createRefApp();
    for (const method of ["GET", "POST"]) {
      const res = await app.request("/api/throw/plain", { method });
      expect(res.status).toBe(500);
      const raw = await res.text();
      const body = JSON.parse(raw) as unknown;
      expect(errorResponseViolations(body)).toEqual([]);
      const { error } = body as { error: { code: string; message: string; requestId: string } };
      expect(error.code).toBe("CORE.INTERNAL");
      expect(error.requestId).not.toBe("");
      // No details of the original error anywhere in the response.
      expect(raw).not.toContain(PLAIN_ERROR_MESSAGE);
      expect(raw).not.toContain("bt1 plain failure");
      expect(raw).not.toContain("/srv/secret/path");
      expect(raw).not.toMatch(STACK_FRAME);
      expect(raw).not.toMatch(/\bat\s+\S+\s+\(/);
      expect(raw).not.toMatch(/\.(?:ts|js):\d+/);
      for (const [name, value] of res.headers) {
        expect(`${name}: ${value}`).not.toContain("bt1 plain failure");
      }
    }
  });

  /** CORE-REQ-007's table. */
  const APP_REPORTED: [string, number][] = [
    ["HTTP.NOT_FOUND", 404],
    ["AUTH.FORBIDDEN", 403],
    ["HTTP.INVALID_INPUT", 400],
    ["HTTP.CONFLICT", 409],
  ];

  it(tag("CORE-AC-008", "route part: fixture routes throwing each CORE-REQ-007 code return that code with its catalogue status"), async () => {
    app = await createRefApp();
    for (const [code, status] of APP_REPORTED) {
      expect(ERROR_CATALOGUE[code as keyof typeof ERROR_CATALOGUE].status).toBe(status);
      const res = await app.request(`/api/throw/code/${code}`);
      expect(res.status, code).toBe(status);
      const body = await errorBody(res);
      expect(errorResponseViolations(body), code).toEqual([]);
      expect(body.error.code).toBe(code);
    }
  });
});
