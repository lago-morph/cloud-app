import { mockUsers } from "@lago-morph/prototype-framework/testing";
import { describe, expect, it } from "vitest";
import type { ConfigValues } from "../src/shared/types";
import { json, open, type ErrorBody } from "./support";

const SECRET = "reference-test-secret-value";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("core and HTTP fixtures", () => {
  it("reports the deployment and the request ID", async () => {
    const t = await open();
    expect(await (await t.request("/api/ref/deployment")).json()).toEqual({ deployment: { app: "reference", stage: "local" } });
    const body: { requestId: string } = await (await t.request("/api/ref/request-id")).json();
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns a plain Error into CORE.INTERNAL and logs it once", async () => {
    const t = await open();
    const res = await t.request("/api/ref/throw-plain");
    expect(res.status).toBe(500);
    const body: ErrorBody = await res.json();
    expect(body.error.code).toBe("CORE.INTERNAL");
    expect(body.error.message).not.toContain("reference plain error");
    const errors = t.logs().filter((e) => e.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.requestId).toBe(body.error.requestId);
    expect(errors[0]?.message).toContain("reference plain error");
  });

  it("never echoes the secret value from a thrown error", async () => {
    const t = await open({ secrets: { apiKey: SECRET } });
    const plain = await t.request("/api/ref/throw-secret");
    expect(plain.status).toBe(500);
    expect(await plain.text()).not.toContain(SECRET);
    const appError = await t.request("/api/ref/throw-secret-app");
    expect(appError.status).toBe(409);
    const text = await appError.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toMatchObject({ error: { code: "HTTP.CONFLICT" } });
    expect(JSON.stringify(t.logs())).not.toContain(SECRET);
  });

  it("writes a log entry with the request's ID", async () => {
    const t = await open();
    const res = await t.request("/api/ref/log", json("POST", { severity: "warn", message: "reference log entry" }));
    expect(res.status).toBe(200);
    const { requestId }: { requestId: string } = await res.json();
    const entries = t.logs().filter((e) => e.component === "reference");
    expect(entries).toEqual([expect.objectContaining({ severity: "warn", message: "reference log entry", requestId })]);
  });

  it("rejects an invalid log request", async () => {
    const t = await open();
    const res = await t.request("/api/ref/log", json("POST", { severity: "loud", message: "x" }));
    expect(res.status).toBe(400);
  });

  it("sets two cookies", async () => {
    const t = await open();
    const res = await t.request("/api/ref/two-cookies");
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^refOne=1; Path=\/; HttpOnly; SameSite=Lax$/);
    expect(cookies[1]).toMatch(/^refTwo=2; Path=\/; HttpOnly; SameSite=Lax$/);
  });

  it("echoes a body and a query, and validates both", async () => {
    const t = await open();
    expect(await (await t.request("/api/ref/echo", json("POST", { text: "héllo" }))).json()).toEqual({ length: 5 });
    expect((await t.request("/api/ref/echo", json("POST", { text: 3 }))).status).toBe(400);
    expect(await (await t.request("/api/ref/echo?text=abc")).json()).toEqual({ text: "abc" });
    expect((await t.request("/api/ref/echo")).status).toBe(400);
  });

  it("reports the configuration values", async () => {
    const t = await open({ config: { greeting: "Hi", tags: ["a", "b"] } });
    const body: ConfigValues = await (await t.request("/api/ref/config")).json();
    expect(body).toEqual({ greeting: "Hi", pageSize: 20, featureOn: false, tags: ["a", "b"] });
  });

  it("reports the secret's digest, never its value", async () => {
    const t = await open({ secrets: { apiKey: SECRET } });
    const text = await (await t.request("/api/ref/secret")).text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({ sha256: await sha256(SECRET) });
  });

  it("reports the schema version", async () => {
    const t = await open();
    expect(await (await t.request("/api/ref/schema-version")).json()).toEqual({ version: "v1" });
  });

  it("dumps the current user at each level", async () => {
    const t = await open();
    expect(await (await t.request("/api/ref/me")).json()).toEqual({ user: { level: "anonymous" } });
    const user: { user: { level: string; id: string } } = await (await t.as(mockUsers.user("u1")).request("/api/ref/me")).json();
    expect(user.user.level).toBe("user");
    expect(Object.keys(user.user).sort()).toEqual(["displayName", "id", "level"]);
    const admin: { user: { level: string } } = await (await t.as(mockUsers.admin("a1")).request("/api/ref/me")).json();
    expect(admin.user.level).toBe("admin");
  });
});

describe("access levels", () => {
  it("lets each level reach exactly its routes", async () => {
    const t = await open();
    const anon = t;
    const user = t.as(mockUsers.user("u1"));
    const admin = t.as(mockUsers.admin("a1"));
    expect(await (await anon.request("/api/levels/anyone")).json()).toEqual({ level: "anonymous" });
    for (const method of ["GET", "POST"]) {
      expect((await anon.request("/api/levels/user", { method })).status).toBe(401);
      expect((await user.request("/api/levels/user", { method })).status).toBe(200);
      expect((await anon.request("/api/levels/admin", { method })).status).toBe(401);
      expect((await user.request("/api/levels/admin", { method })).status).toBe(403);
      expect((await admin.request("/api/levels/admin", { method })).status).toBe(200);
    }
    expect((await anon.request("/api/levels/current")).status).toBe(401);
    const current: { level: string; id: string } = await (await user.request("/api/levels/current")).json();
    expect(current.level).toBe("user");
    expect(typeof current.id).toBe("string");
  });
});
