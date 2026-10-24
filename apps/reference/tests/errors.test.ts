import { ERROR_CATALOGUE } from "@lago-morph/prototype-framework";
import { mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import { open, type ErrorBody } from "./support";

type Call = (t: TestApp) => Promise<Response>;

const get = (code: string): Call => (t) => t.request(`/api/errors/${code}`);

/** How each code with a status is reached, with the test-app options it needs. */
const CASES: Record<string, { call?: Call; options?: Parameters<typeof open>[0] }> = {
  "CORE.INTERNAL": {},
  "CORE.MISCONFIGURED": {},
  "HTTP.INVALID_INPUT": {},
  "HTTP.NOT_FOUND": {},
  "HTTP.METHOD_NOT_ALLOWED": {},
  "HTTP.PAYLOAD_TOO_LARGE": {
    call: (t) =>
      t.request("/api/errors/HTTP.PAYLOAD_TOO_LARGE", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "x".repeat(1_000_001) }),
      }),
  },
  "HTTP.CONFLICT": {},
  "SQL.CONFLICT": {},
  "SQL.INVALID_VALUE": {},
  "SQL.UNAVAILABLE": { options: { unavailable: ["sql"] } },
  "SQL.RESULT_TOO_LARGE": {},
  "KV.INVALID_KEY": {},
  "KV.INVALID_CURSOR": {},
  "KV.VALUE_TOO_LARGE": {},
  "KV.UNAVAILABLE": { options: { unavailable: ["kv"] } },
  "FILES.INVALID_NAME": {},
  "FILES.INVALID_CURSOR": {},
  "FILES.NOT_FOUND": {},
  "FILES.UNAVAILABLE": { options: { unavailable: ["files"] } },
  "CFG.UNDECLARED_KEY": {},
  "SEC.UNDECLARED": {},
  "SEC.MISSING": {},
  "SEC.UNAVAILABLE": { options: { unavailable: ["secrets"], secrets: { apiKey: "k" } } },
  "AUTH.UNAUTHENTICATED": {},
  "AUTH.FORBIDDEN": {},
  "AUTH.REQUEST_FORGERY": {
    call: (t) => t.as(mockUsers.user("forger")).request("/api/errors/AUTH.REQUEST_FORGERY", { method: "POST", headers: { origin: "https://evil.example" } }),
  },
};

/** Codes no app route can produce (ROUTES.md): login failures redirect; status-null codes never cross HTTP. */
const NO_ROUTE = ["AUTH.LOGIN_FAILED"];

describe("error routes", () => {
  it("cover every catalogue code with a status", () => {
    const withStatus = Object.entries(ERROR_CATALOGUE)
      .filter(([, entry]) => entry.status !== null)
      .map(([code]) => code)
      .filter((code) => !NO_ROUTE.includes(code));
    expect(Object.keys(CASES).sort()).toEqual(withStatus.sort());
  });

  for (const [code, { call, options }] of Object.entries(CASES)) {
    it(`${code} answers its catalogue status and code`, async () => {
      const t = await open(options);
      const res = await (call ?? get(code))(t);
      const status = Object.entries(ERROR_CATALOGUE).find(([k]) => k === code)?.[1].status;
      expect(res.status).toBe(status);
      const body: ErrorBody = await res.json();
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
      if (res.status >= 500) {
        expect(t.logs().filter((e) => e.severity === "error")).toHaveLength(1);
      }
    });
  }

  it("answers { raised: false } when an outage code's condition is absent", async () => {
    const t = await open({ secrets: { apiKey: "k" } });
    for (const code of ["SQL.UNAVAILABLE", "KV.UNAVAILABLE", "FILES.UNAVAILABLE", "SEC.MISSING", "SEC.UNAVAILABLE"]) {
      const res = await t.request(`/api/errors/${code}`);
      expect({ code, status: res.status, body: await res.json() }).toEqual({ code, status: 200, body: { raised: false } });
    }
  });

  it("405 names the allowed method", async () => {
    const t = await open();
    const res = await t.request("/api/errors/HTTP.METHOD_NOT_ALLOWED");
    expect(res.headers.get("allow")).toBe("POST");
  });
});
