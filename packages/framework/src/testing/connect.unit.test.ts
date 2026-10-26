import { describe, expect, it } from "vitest";
import { mockUsers } from "../auth/testing.js";
import { connectTestStage, connectWith, readSmokeConnection, SMOKE_CONNECTION_ENV, SMOKE_USER_AGENT, type SmokeConnection } from "./connect.js";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

/** A fake stage: answers `/api/auth/me`, mock-login (sets a session cookie per identity), logout and app routes. */
function fakeStage(overrides: Record<string, (seen: Seen) => Response> = {}) {
  const seen: Seen[] = [];
  let sessions = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const s: Seen = { method: request.method, url: request.url, headers: request.headers, body: request.method === "GET" ? undefined : await request.text() };
    seen.push(s);
    const path = new URL(request.url).pathname;
    const handler = overrides[`${request.method} ${path}`];
    if (handler !== undefined) return handler(s);
    if (path === "/api/auth/me") return Response.json({ level: "anonymous" });
    if (path === "/api/auth/mock-login") {
      sessions++;
      return new Response(null, { status: 204, headers: { "set-cookie": `fw_session=s${String(sessions)}; Path=/; HttpOnly` } });
    }
    if (path === "/api/auth/logout") return new Response(null, { status: 204, headers: { "set-cookie": "fw_session=; Path=/; Max-Age=0" } });
    return Response.json({ ok: true });
  };
  return { fetch, seen };
}

const LOCAL: SmokeConnection = { target: "local", stage: "local", baseUrl: "http://localhost:5179" };
const CLOUD: SmokeConnection = { target: "cloudflare", stage: "test-abc", baseUrl: "https://template-test-abc.sub.workers.dev" };

describe("connectTestStage (testing.d.ts; CLI-AC-005 local part)", () => {
  it("reads the connection the smoke command passes to the test run", () => {
    expect(readSmokeConnection({ [SMOKE_CONNECTION_ENV]: JSON.stringify(LOCAL) })).toEqual(LOCAL);
  });

  it("rejects outside a smoke run, saying how to start one", async () => {
    expect(() => readSmokeConnection({})).toThrow(/only in a test run started by `smoke`.*npm run smoke -- --target/);
    const saved = process.env[SMOKE_CONNECTION_ENV];
    delete process.env[SMOKE_CONNECTION_ENV];
    try {
      await expect(connectTestStage()).rejects.toThrow(/only in a test run started by `smoke`/);
    } finally {
      if (saved !== undefined) process.env[SMOKE_CONNECTION_ENV] = saved;
    }
  });

  it("rejects a malformed connection", () => {
    expect(() => readSmokeConnection({ [SMOKE_CONNECTION_ENV]: "{" })).toThrow(/malformed/);
    expect(() => readSmokeConnection({ [SMOKE_CONNECTION_ENV]: JSON.stringify({ target: "local" }) })).toThrow(/malformed/);
  });

  it("rejects a cloud stage that is not a test stage, before sending anything", async () => {
    const stage = fakeStage();
    await expect(connectWith({ ...CLOUD, stage: "prod" }, stage.fetch)).rejects.toThrow(/stage "prod" is not a test stage.*test-/);
    expect(stage.seen).toEqual([]);
  });

  it("connects with a probe of /api/auth/me, sending its own User-Agent (DEC-0089)", async () => {
    const stage = fakeStage();
    await connectWith(LOCAL, stage.fetch);
    expect(stage.seen.map((s) => `${s.method} ${s.url}`)).toEqual(["GET http://localhost:5179/api/auth/me"]);
    expect(stage.seen[0]?.headers.get("user-agent")).toBe(SMOKE_USER_AGENT);
  });

  it("an unexpected response while connecting names method, path, status, code and requestId", async () => {
    const stage = fakeStage({
      "GET /api/auth/me": () => Response.json({ error: { code: "CORE.INTERNAL", message: "boom", requestId: "req-1" } }, { status: 500 }),
    });
    await expect(connectWith(CLOUD, stage.fetch)).rejects.toThrow("connecting to stage test-abc: GET /api/auth/me answered HTTP 500, error code CORE.INTERNAL, requestId req-1");
  });

  it("no answer while connecting names the method, URL and cause", async () => {
    const fetch = async (): Promise<Response> => {
      throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:5179") });
    };
    await expect(connectWith(LOCAL, fetch)).rejects.toThrow(/GET http:\/\/localhost:5179\/api\/auth\/me: no response \(fetch failed: connect ECONNREFUSED 127\.0\.0\.1:5179\).*`dev`/);
  });

  it("requests go to the base URL with the User-Agent; state-changing ones carry the stage's Origin", async () => {
    const stage = fakeStage();
    const app = await connectWith(CLOUD, stage.fetch);
    const res = await app.request("/api/hello");
    expect(res.status).toBe(200);
    await app.request("/api/notes", { method: "POST", body: "{}" });
    await app.request("/api/notes", { method: "PUT", headers: { origin: "https://elsewhere.example" } });
    const [, get, post, put] = stage.seen;
    expect(get?.url).toBe("https://template-test-abc.sub.workers.dev/api/hello");
    expect(get?.headers.get("origin")).toBeNull();
    expect(get?.headers.get("user-agent")).toBe(SMOKE_USER_AGENT);
    expect(post?.headers.get("origin")).toBe("https://template-test-abc.sub.workers.dev");
    expect(put?.headers.get("origin")).toBe("https://elsewhere.example");
  });

  it("does not follow redirects", async () => {
    const stage = fakeStage({ "GET /go": () => new Response(null, { status: 302, headers: { location: "/elsewhere" } }) });
    const app = await connectWith(LOCAL, stage.fetch);
    const res = await app.request("/go");
    expect(res.status).toBe(302);
    expect(stage.seen.map((s) => new URL(s.url).pathname)).toEqual(["/api/auth/me", "/go"]);
  });

  it("as(user) logs in through mock-login once and keeps the session cookie for its requests", async () => {
    const stage = fakeStage();
    const base = await connectWith(LOCAL, stage.fetch);
    const user = base.as(mockUsers.user("u-1"));
    await user.request("/api/notes");
    await user.request("/api/notes", { method: "POST", body: "{}" });
    await base.request("/api/notes");
    const login = stage.seen.filter((s) => s.url.endsWith("/api/auth/mock-login"));
    expect(login).toHaveLength(1);
    expect(JSON.parse(login[0]?.body ?? "")).toEqual({ level: "user", id: "u-1", displayName: null });
    expect(login[0]?.headers.get("origin")).toBe("http://localhost:5179");
    const notes = stage.seen.filter((s) => s.url.endsWith("/api/notes"));
    expect(notes.map((s) => s.headers.get("cookie"))).toEqual(["fw_session=s1", "fw_session=s1", null]);
  });

  it("each identity has its own session", async () => {
    const stage = fakeStage();
    const base = await connectWith(LOCAL, stage.fetch);
    await base.as(mockUsers.user("a")).request("/x");
    await base.as(mockUsers.admin("b")).request("/x");
    expect(stage.seen.filter((s) => s.url.endsWith("/x")).map((s) => s.headers.get("cookie"))).toEqual(["fw_session=s1", "fw_session=s2"]);
  });

  it("a failed mock-login rejects the request with method, path, status, code and requestId", async () => {
    const stage = fakeStage({
      "POST /api/auth/mock-login": () => Response.json({ error: { code: "HTTP.NOT_FOUND", message: "no", requestId: "r-9" } }, { status: 404 }),
    });
    const base = await connectWith(CLOUD, stage.fetch);
    await expect(base.as(mockUsers.admin("x")).request("/api/admin/secret")).rejects.toThrow(
      "logging in as admin x on stage test-abc: POST /api/auth/mock-login answered HTTP 404, error code HTTP.NOT_FOUND, requestId r-9",
    );
  });

  it("a response without an error body still names the status", async () => {
    const stage = fakeStage({ "POST /api/auth/mock-login": () => new Response("Forbidden", { status: 403 }) });
    const base = await connectWith(LOCAL, stage.fetch);
    await expect(base.as(mockUsers.user("x")).request("/a")).rejects.toThrow("POST /api/auth/mock-login answered HTTP 403, error code (none), requestId (none)");
  });

  it("as(anonymous) sends no login and no cookie", async () => {
    const stage = fakeStage();
    const base = await connectWith(LOCAL, stage.fetch);
    await base.as(mockUsers.anonymous).request("/a");
    expect(stage.seen.map((s) => new URL(s.url).pathname)).toEqual(["/api/auth/me", "/a"]);
    expect(stage.seen[1]?.headers.get("cookie")).toBeNull();
  });

  it("dispose() only logs out (stage data is kept), and the test app refuses requests afterwards", async () => {
    const stage = fakeStage();
    const base = await connectWith(LOCAL, stage.fetch);
    const user = base.as(mockUsers.user("u"));
    await user.request("/a");
    await user.dispose();
    const logout = stage.seen.at(-1);
    expect(`${logout?.method ?? ""} ${new URL(logout?.url ?? "http://x").pathname}`).toBe("POST /api/auth/logout");
    expect(logout?.headers.get("cookie")).toBe("fw_session=s1");
    await expect(user.request("/a")).rejects.toThrow(/disposed/);
    const before = stage.seen.length;
    await base.dispose();
    expect(stage.seen.length).toBe(before);
  });

  describe("refuses URLs on any other origin before sending (root cause F-02 entry 2 revised)", () => {
    const STAGE = "https://template-test-abc.sub.workers.dev";
    const others = (seen: readonly Seen[]) => seen.filter((s) => new URL(s.url).origin !== STAGE || !s.url.startsWith(`${STAGE}/`));
    const refused = /is not the app's origin \(https:\/\/template-test-abc\.sub\.workers\.dev\); the test app sends requests only to the app\. Send requests to other hosts, such as a cloud upload or download ticket's url, with fetch\./;

    for (const [name, target, init] of [
      ["an absolute URL on another host (an R2-style signed PUT)", "https://acct.r2.cloudflarestorage.com/bucket/key?X-Amz-Signature=x", { method: "PUT", body: "data" }],
      ["a protocol-relative //host URL", "//other.example/p", {}],
      ["the backslash form /\\host", "/\\other.example/p", { method: "POST", body: "{}" }],
      ["http: on the stage's https host", "http://template-test-abc.sub.workers.dev/api/hello", {}],
      ["a blob: URL whose origin is the stage's", "blob:https://template-test-abc.sub.workers.dev/x", {}],
    ] as const) {
      it(`refuses ${name}: nothing sent, no cookie or Origin leaves the stage, the jar stays the stage's`, async () => {
        const stage = fakeStage();
        const base = await connectWith(CLOUD, stage.fetch);
        const admin = base.as(mockUsers.admin("a1"));
        await admin.request("/api/warm");
        const before = stage.seen.length;
        await expect(admin.request(target, init as RequestInit)).rejects.toThrow(refused);
        expect(stage.seen.length).toBe(before);
        expect(others(stage.seen)).toEqual([]);
        await admin.request("/api/after");
        expect(stage.seen.at(-1)?.headers.get("cookie")).toBe("fw_session=s1");
      });
    }

    it("refuses before logging in", async () => {
      const stage = fakeStage();
      const base = await connectWith(CLOUD, stage.fetch);
      await expect(base.as(mockUsers.admin("a1")).request("//other.example/p")).rejects.toThrow(refused);
      expect(stage.seen.map((s) => new URL(s.url).pathname)).toEqual(["/api/auth/me"]);
    });

    it("a redirect: \"follow\" request to a stage route answering 302 to another host reaches no other host", async () => {
      const stage = fakeStage({ "PUT /redir": () => new Response(null, { status: 302, headers: { location: "https://other.example/x" } }) });
      const base = await connectWith(CLOUD, stage.fetch);
      const res = await base.as(mockUsers.admin("a1")).request("/redir", { method: "PUT", body: "x", redirect: "follow" });
      expect(res.status).toBe(302);
      expect(others(stage.seen)).toEqual([]);
    });

    it("accepts an absolute URL on the stage's own origin, normalized for case and default port", async () => {
      const stage = fakeStage();
      const base = await connectWith(CLOUD, stage.fetch);
      const user = base.as(mockUsers.user("u"));
      expect((await user.request(`${STAGE}/api/a`)).status).toBe(200);
      expect((await user.request("HTTPS://TEMPLATE-TEST-ABC.sub.workers.dev:443/api/b")).status).toBe(200);
      expect(stage.seen.slice(-2).map((s) => [s.url, s.headers.get("cookie")])).toEqual([
        [`${STAGE}/api/a`, "fw_session=s1"],
        [`${STAGE}/api/b`, "fw_session=s1"],
      ]);
    });
  });

  it("logs() throws, naming where the entries are", async () => {
    const app = await connectWith(LOCAL, fakeStage().fetch);
    expect(() => app.logs()).toThrow(/not available on a connected stage.*log location.*smoke/);
  });

  it("loginWithStub is not available on a connected stage", async () => {
    const app = await connectWith(LOCAL, fakeStage().fetch);
    await expect(app.loginWithStub("s")).rejects.toThrow(/not available on a connected stage/);
  });
});
