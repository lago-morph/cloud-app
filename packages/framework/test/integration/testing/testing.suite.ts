/**
 * `./testing`'s `TestApp` contract as such (S4 coverage list §1.1 item 2), in-process on one SQL
 * dialect per process: storage isolation between two test apps, `dispose`, the `unavailable`
 * option and `setUnavailable`, `logs()`, `as()`, `loginWithStub`, and v0.2.0's role path
 * through the fake auth-app binding (`loginWithAuthApp`, `grantRole`/`revokeRole`, `clock`).
 *
 * Written from docs/contracts/ts/testing.d.ts, core.md §2 "Testing", auth.md §2 (role refresh,
 * stub provider, user ID) and B's DEC-0668/0672/0673 (PAR-425 = 300 s), not from the code.
 * Every other suite uses `createTestApp` as a harness; this one checks the harness itself, so it
 * is untagged. Imports the framework: load only after the dialect is selected.
 */
import { afterEach, describe, expect, it } from "vitest";
import { defineApp } from "../../../src/index.js";
import { createTestApp, mockUsers, type TestApp, type TestAppOptions } from "../../../src/testing/index.js";
import { deriveUserId } from "../auth/support.js";
import { DIALECT_LABEL, type Dialect } from "../sql/support/dialect.js";
import { expectCode } from "../sql/support/errors.js";
import { probe, probeRoutes, run } from "../sql/support/probe.js";

/** PAR-425: a confirmed level is used for up to and including 300 s, and read again after. */
const ROLE_REFRESH_MS = 300_000;
const HOOK = 120_000;

const app = defineApp({
  name: "testingsuite",
  config: {},
  secrets: ["apiKey"],
  tables: {},
  routes: (api) => {
    probeRoutes(api);
    api.get("/whoami", (c) => c.json(c.var.user));
  },
});

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
/** The probe's request vars are typed for an app with no secrets; this app declares `apiKey`. */
const secret = (v: { secrets: unknown }): Promise<string> => (v.secrets as { get(name: "apiKey"): Promise<string> }).get("apiKey");

export function defineTestingSuite(dialect: Dialect): void {
  const on = `(${DIALECT_LABEL[dialect]})`;
  const apps: TestApp[] = [];
  const open = async (options: TestAppOptions = {}): Promise<TestApp> => {
    const a = await createTestApp(app, { secrets: { apiKey: "test-value" }, ...options });
    apps.push(a);
    return a;
  };
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.dispose()));
  }, HOOK);
  const me = async (a: TestApp) => (await (await a.request("/api/auth/me")).json()) as { level: string; id?: string; displayName?: string | null };
  const whoami = async (a: TestApp) => (await (await a.request("/api/whoami")).json()) as { level: string; id?: string };

  describe(`TestApp contract ${on}`, { timeout: HOOK }, () => {
    it(`two test apps have separate storage; as() shares its app's storage ${on}`, async () => {
      const a = await open();
      const b = await open();
      await run(a, async (v) => {
        await v.kv.put("k", "from a");
        await v.files.put("f.txt", bytes("from a"), { contentType: "text/plain" });
      });
      expect(await run(b, (v) => v.kv.get("k"))).toBeNull();
      expect(await run(b, (v) => v.files.head("f.txt"))).toBeNull();
      const asUser = a.as(mockUsers.user("u_shared"));
      expect(await run(asUser, (v) => v.kv.get("k"))).toBe("from a");
      expect((await run(asUser, (v) => v.files.head("f.txt")))?.size).toBe(6);
    });

    it(`dispose discards the app for the original and every as() copy; a new app starts empty ${on}`, async () => {
      const a = await open();
      await run(a, (v) => v.kv.put("k", "v"));
      const copy = a.as(mockUsers.admin());
      await copy.dispose();
      await expect(a.request("/api/whoami")).rejects.toThrow();
      await expect(copy.request("/api/whoami")).rejects.toThrow();
      const fresh = await open();
      expect(await run(fresh, (v) => v.kv.get("k"))).toBeNull();
    });

    it(`unavailable and setUnavailable make each named capability fail with its code from the next operation, for as() copies too, keeping stored data ${on}`, async () => {
      const a = await open({ unavailable: ["files"] });
      expectCode(await probe(a, (v) => v.files.put("x.txt", bytes("x"))), "FILES.UNAVAILABLE");
      await run(a, (v) => v.kv.put("k", "kept"));

      a.setUnavailable([]);
      await run(a, (v) => v.files.put("x.txt", bytes("stored")));
      const copy = a.as(mockUsers.user("u_copy"));
      a.setUnavailable(["sql", "secrets"]);
      expectCode(await probe(copy, (v) => v.kv.get("k")), "KV.UNAVAILABLE"); // sql also makes kv unavailable
      expectCode(await probe(copy, (v) => secret(v)), "SEC.UNAVAILABLE");
      expect((await run(copy, (v) => v.files.head("x.txt")))?.size, "files stay available").toBe(6);

      a.setUnavailable([]);
      expect(await run(a, (v) => v.kv.get("k")), "stored data is kept").toBe("kept");
      expect(await run(a, (v) => secret(v))).toBe("test-value");
      expect(() => a.setUnavailable(["mail" as never])).toThrow();
      await a.dispose();
      expect(() => a.setUnavailable([])).toThrow();
    });

    it(`logs() returns this app's entries in order, shaped as the log entry schema, with the request ID ${on}`, async () => {
      const a = await open();
      const other = await open();
      const ids = await run(a, async (v) => {
        v.log.write("testingsuite", "info", "first");
        v.log.write("testingsuite", "warn", "second");
        return v.requestId;
      });
      await run(other, async (v) => v.log.write("testingsuite", "info", "elsewhere"));
      const mine = a.logs().filter((e) => e.component === "testingsuite");
      expect(mine.map((e) => [e.severity, e.message])).toEqual([["info", "first"], ["warn", "second"]]);
      for (const e of mine) {
        expect(e).toMatchObject({ app: "testingsuite", requestId: ids });
        expect(Number.isNaN(Date.parse(e.time))).toBe(false);
        expect(typeof e.stage).toBe("string");
        expect(typeof e.target).toBe("string");
      }
      expect(a.logs().some((e) => e.message === "elsewhere"), "another app's entries are not included").toBe(false);
    });

    it(`requests are anonymous by default; as() sends as the given identity and leaves the original unchanged ${on}`, async () => {
      const a = await open();
      expect(await whoami(a)).toEqual({ level: "anonymous" });
      expect(await whoami(a.as(mockUsers.user("u_alice")))).toEqual({ level: "user", id: "u_alice", displayName: null });
      expect(await whoami(a.as(mockUsers.admin("u_boss")))).toMatchObject({ level: "admin", id: "u_boss" });
      expect(await whoami(a)).toEqual({ level: "anonymous" });
      expect(await whoami(await open({ user: mockUsers.admin("u_opt") }))).toMatchObject({ level: "admin", id: "u_opt" });
    });

    it(`loginWithStub logs in through the stub provider with the derived user ID; a refused login keeps no session; as() throws there ${on}`, async () => {
      const a = await open({ stubLoginProvider: true });
      await a.loginWithStub("alice", { displayName: "Alice" });
      const first = await me(a);
      expect(first).toMatchObject({ level: "user", id: deriveUserId("stub", "alice") });
      const again = await open({ stubLoginProvider: true });
      await again.loginWithStub("alice");
      expect((await me(again)).id, "the same subject yields the same ID").toBe(first.id);

      const refused = await open({ stubLoginProvider: true });
      await refused.loginWithStub("bob", { stubFailure: "refused" }).catch(() => undefined);
      expect((await me(refused)).level).toBe("anonymous");
      expect(() => a.as(mockUsers.user())).toThrow();
      await expect((await open()).loginWithStub("carol"), "needs the stub provider").rejects.toThrow();
    });

    it(`with the fake auth app, a role granted or revoked shows at the next role refresh after PAR-425, with one role call and no new sign-in ${on}`, async () => {
      const a = await open({ authAppLoginProvider: true });
      await a.loginWithAuthApp({ sub: "cf-sub-1", email: "member@example.com", role: "user" });
      const signedIn = await me(a);
      expect(signedIn).toMatchObject({ level: "user", id: deriveUserId("cf-account", "cf-sub-1"), displayName: null });
      expect(JSON.stringify(signedIn)).not.toContain("member@example.com");
      const id = signedIn.id!;

      await a.grantRole(id, "admin");
      const calls = a.authApp.calls.role;
      a.clock.advance(ROLE_REFRESH_MS);
      expect((await whoami(a)).level, "inside the interval the session's level stands").toBe("user");
      expect(a.authApp.calls.role).toBe(calls);
      a.clock.advance(1_000);
      expect((await whoami(a)).level).toBe("admin");
      expect(a.authApp.calls.role, "exactly one role call").toBe(calls + 1);
      expect((await whoami(a)).level).toBe("admin");
      expect(a.authApp.calls.role, "none until the next interval").toBe(calls + 1);

      await a.revokeRole(id, "admin");
      a.clock.advance(ROLE_REFRESH_MS + 1_000);
      expect((await whoami(a)).level).toBe("user");

      const mocked = await open();
      await expect(mocked.grantRole(id, "admin"), "the mock has no accounts").rejects.toThrow();
      expect(() => mocked.authApp, "authApp needs the auth-app provider").toThrow();
    });
  });
}
