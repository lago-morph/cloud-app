/**
 * `./testing`'s `TestApp` contract as such (S4 coverage list §1.1 item 2), in-process on one SQL
 * dialect per process: fresh migrated storage and its isolation between two test apps, `dispose`,
 * the `unavailable` option and `setUnavailable`, `logs()` and the stderr echo, `as()`,
 * `loginWithStub`, and v0.2.0's role path through the fake auth-app binding (`loginWithAuthApp`,
 * `authApp.setRole`, `grantRole`/`revokeRole`, `clock`).
 *
 * Written from docs/contracts/ts/testing.d.ts, core.md §2 "Testing", auth.md §2 (role refresh,
 * stub provider, user ID) and B's DEC-0668/0672/0673 (PAR-425 = 300 s), not from the code.
 * Every other suite uses `createTestApp` as a harness; this one checks the harness itself, so it
 * is untagged. Imports the framework: load only after the dialect is selected.
 *
 * Message matchers such as /disposed/, /failed/, /mock/ or /login provider/ pin today's messages,
 * which testing.d.ts does not word; they keep a bare `toThrow()` from passing on any TypeError.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineApp, defineTable, id, text } from "../../../src/index.js";
import { createTestApp, mockUsers, type TestApp, type TestAppOptions } from "../../../src/testing/index.js";
import { deriveUserId } from "../auth/support.js";
import { DIALECT_LABEL, type Dialect } from "../sql/support/dialect.js";
import { expectCode } from "../sql/support/errors.js";
import { probe, probeRoutes, run, type Vars } from "../sql/support/probe.js";

/** PAR-425: a confirmed level is used for up to and including 300 s, and read again after. */
const ROLE_REFRESH_MS = 300_000;
const HOOK = 120_000;

/** An ID as `newId()` makes them (lowercase UUID v4). */
const N1 = "3f1c2a4e-9b7d-4c1e-8a2b-5d6e7f8a9b0c";
const notes = defineTable("notes", { id: id(), title: text() });
const app = defineApp({
  name: "testingsuite",
  config: {},
  secrets: ["apiKey"],
  tables: { notes },
  routes: (api) => {
    // The probe routes are typed for an app with no secrets; only the request vars' type differs.
    probeRoutes(api as unknown as Parameters<typeof probeRoutes>[0]);
    api.get("/whoami", (c) => c.json(c.var.user));
  },
});

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
/** The probe's request vars are typed for an app with no secrets; this app declares `apiKey`. */
const secret = (v: Vars): Promise<string> => (v.secrets as { get(name: "apiKey"): Promise<string> }).get("apiKey");
const addNote = (v: Vars, noteId: string) => v.sql.insert(notes).values({ id: noteId, title: "a note" });
const noteIds = async (v: Vars) => (await v.sql.select({ id: notes.id }).from(notes)).map((r) => r.id).sort();

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
    it(`each test app starts with fresh, migrated storage of its own; as() shares its app's storage ${on}`, async () => {
      const a = await open();
      const b = await open();
      expect(await run(a, noteIds), "the app's table exists and is empty").toEqual([]);
      await run(a, async (v) => {
        await addNote(v, N1);
        await v.kv.put("k", "from a");
        await v.files.put("f.txt", bytes("from a"), { contentType: "text/plain" });
      });
      expect(await run(b, noteIds)).toEqual([]);
      expect(await run(b, (v) => v.kv.get("k"))).toBeNull();
      expect(await run(b, (v) => v.files.head("f.txt"))).toBeNull();
      const asUser = a.as(mockUsers.user("u_shared"));
      expect(await run(asUser, noteIds)).toEqual([N1]);
      expect(await run(asUser, (v) => v.kv.get("k"))).toBe("from a");
      expect((await run(asUser, (v) => v.files.head("f.txt")))?.size).toBe(6);
    });

    it(`dispose through any of an app and its as() copies disposes all; a new app starts empty ${on}`, async () => {
      for (const which of ["copy", "original"] as const) {
        const a = await open();
        await run(a, (v) => addNote(v, N1));
        const copy = a.as(mockUsers.admin());
        await (which === "copy" ? copy : a).dispose();
        await expect(a.request("/api/whoami")).rejects.toThrow(/disposed/);
        await expect(copy.request("/api/whoami")).rejects.toThrow(/disposed/);
      }
      expect(await run(await open(), noteIds)).toEqual([]);
    });

    it(`unavailable and setUnavailable make each named capability fail with its code from the next operation, for as() copies too, keeping stored data ${on}`, async () => {
      const a = await open({ unavailable: ["files"] });
      expectCode(await probe(a, (v) => v.files.put("x.txt", bytes("x"))), "FILES.UNAVAILABLE");
      await run(a, async (v) => {
        await v.kv.put("k", "kept");
        await addNote(v, N1);
      });

      a.setUnavailable(["kv"]);
      expectCode(await probe(a, (v) => v.kv.get("k")), "KV.UNAVAILABLE");
      expect(await run(a, noteIds), "kv alone leaves sql available").toEqual([N1]);

      a.setUnavailable([]);
      await run(a, (v) => v.files.put("x.txt", bytes("stored")));
      const copy = a.as(mockUsers.user("u_copy"));
      a.setUnavailable(["sql", "secrets"]);
      expectCode(await probe(copy, noteIds), "SQL.UNAVAILABLE");
      expectCode(await probe(copy, (v) => v.kv.get("k")), "KV.UNAVAILABLE"); // sql also makes kv unavailable
      expectCode(await probe(copy, secret), "SEC.UNAVAILABLE");
      expect((await run(copy, (v) => v.files.head("x.txt")))?.size, "files stay available").toBe(6);

      a.setUnavailable([]);
      expect(await run(a, (v) => v.kv.get("k")), "stored data is kept").toBe("kept");
      expect(await run(a, noteIds)).toEqual([N1]);
      expect(await run(a, secret)).toBe("test-value");
      expect(() => a.setUnavailable(["mail" as never])).toThrow(/mail/);
      await a.dispose();
      expect(() => a.setUnavailable([])).toThrow(/disposed/);
    });

    it(`logs() returns this app's entries in order, shaped as the log entry schema, with the request ID; error entries are echoed to stderr ${on}`, async () => {
      const a = await open();
      const other = await open();
      const echoed: string[] = [];
      const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => (echoed.push(String(chunk)), true));
      let ids: string;
      try {
        ids = await run(a, async (v) => {
          v.log.write("testingsuite", "info", "first");
          v.log.write("testingsuite", "error", "second");
          return v.requestId;
        });
      } finally {
        spy.mockRestore();
      }
      await run(other, async (v) => v.log.write("testingsuite", "info", "elsewhere"));
      const mine = a.logs().filter((e) => e.component === "testingsuite");
      expect(mine.map((e) => [e.severity, e.message])).toEqual([["info", "first"], ["error", "second"]]);
      for (const e of mine) {
        expect(e).toMatchObject({ app: "testingsuite", requestId: ids });
        expect(Number.isNaN(Date.parse(e.time))).toBe(false);
        expect(typeof e.stage).toBe("string");
        expect(typeof e.target).toBe("string");
      }
      expect(a.logs().some((e) => e.message === "elsewhere"), "another app's entries are not included").toBe(false);
      expect(echoed.filter((l) => l.includes('"second"')), "the error entry is echoed").toHaveLength(1);
      expect(echoed.some((l) => l.includes('"first"')), "an info entry is not echoed").toBe(false);
    });

    it(`requests are anonymous by default; as() sends as the given identity and leaves the original unchanged ${on}`, async () => {
      const a = await open();
      expect(await whoami(a)).toEqual({ level: "anonymous" });
      expect(await whoami(a.as(mockUsers.user("u_alice")))).toEqual({ level: "user", id: "u_alice", displayName: null });
      expect(await whoami(a.as(mockUsers.admin("u_boss")))).toMatchObject({ level: "admin", id: "u_boss" });
      expect(await whoami(a)).toEqual({ level: "anonymous" });
      expect(await whoami(await open({ user: mockUsers.admin("u_opt") }))).toMatchObject({ level: "admin", id: "u_opt" });
    });

    it(`loginWithStub logs in through the stub provider with the derived user ID; refused and replayed logins keep no session; grantRole shows at the next refresh ${on}`, async () => {
      const a = await open({ stubLoginProvider: true });
      await a.loginWithStub("alice", { displayName: "Alice" });
      const first = await me(a);
      expect(first).toMatchObject({ level: "user", id: deriveUserId("stub", "alice"), displayName: "Alice" });
      const again = await open({ stubLoginProvider: true });
      await again.loginWithStub("alice");
      expect((await me(again)).id, "the same subject yields the same ID").toBe(first.id);

      for (const failure of ["refused", "replayed"] as const) {
        const failed = await open({ stubLoginProvider: true });
        await expect(failed.loginWithStub("bob", { stubFailure: failure }), `a ${failure} login rejects`).rejects.toThrow(/failed/);
        expect((await me(failed)).level).toBe("anonymous");
      }

      await a.grantRole(first.id!, "admin");
      expect((await whoami(a)).level, "inside the interval the session's level stands").toBe("user");
      a.clock.advance(ROLE_REFRESH_MS + 1_000);
      expect((await whoami(a)).level).toBe("admin");

      expect(() => a.as(mockUsers.user())).toThrow(/mock/);
      await expect((await open()).loginWithStub("carol"), "needs the stub provider").rejects.toThrow(/stubLoginProvider/);
    });

    it(`with the fake auth app, a role changed by grantRole/revokeRole or authApp.setRole shows at the next role refresh after PAR-425, with one role call and no new sign-in ${on}`, async () => {
      const a = await open({ authAppLoginProvider: true });
      await a.loginWithAuthApp({ sub: "cf-sub-1", email: "member@example.com", role: "user" });
      const signedIn = await me(a);
      expect(signedIn).toMatchObject({ level: "user", id: deriveUserId("cf-account", "cf-sub-1"), displayName: null });
      expect(JSON.stringify(signedIn)).not.toContain("member@example.com");
      const id = signedIn.id!;
      const redeems = a.authApp.calls.redeem;

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

      a.authApp.setRole("cf-sub-1", "admin");
      a.clock.advance(ROLE_REFRESH_MS + 1_000);
      expect((await whoami(a)).level, "a change in the fake's record shows the same way").toBe("admin");
      expect(a.authApp.calls.redeem, "no new sign-in").toBe(redeems);

      const mocked = await open();
      await expect(mocked.grantRole(id, "admin"), "the mock has no accounts").rejects.toThrow(/login provider/);
      expect(() => mocked.authApp, "authApp needs the auth-app provider").toThrow(/authAppLoginProvider/);
    });
  });
}
