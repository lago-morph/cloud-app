import { describe, expect, it } from "vitest";
import { createClient, HttpCheckError, USER_AGENT } from "./http.js";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly redirect: RequestRedirect | undefined;
  readonly hasSignal: boolean;
}

function stubFetch(respond: (seen: Seen) => Response): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fetchStub = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const s: Seen = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
      redirect: init?.redirect,
      hasSignal: init?.signal !== undefined,
    };
    seen.push(s);
    return Promise.resolve(respond(s));
  };
  return { fetch: fetchStub as typeof fetch, seen };
}

const errorBody = (code: string, requestId: string): string => JSON.stringify({ error: { code, message: "m", requestId } });

describe("base-URL HTTP client", () => {
  it("sends an explicit User-Agent (DEC-0089), no automatic redirects, and a bounded timeout", async () => {
    const { fetch, seen } = stubFetch(() => new Response(null, { status: 204 }));
    const client = createClient({ baseUrl: "https://w.example.workers.dev/", fetch });
    const res = await client.get("/api/__framework/health");
    expect(res.status).toBe(204);
    expect(seen[0]?.url).toBe("https://w.example.workers.dev/api/__framework/health");
    expect(seen[0]?.headers.get("user-agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^prototype-framework-compliance\//);
    expect(seen[0]?.redirect).toBe("manual");
    expect(seen[0]?.hasSignal).toBe(true);
  });

  it("sets Origin on state-changing requests only, and sends JSON bodies", async () => {
    const { fetch, seen } = stubFetch(() => new Response("{}", { status: 200 }));
    const client = createClient({ baseUrl: "http://localhost:5173", fetch });
    await client.get("/api/x");
    await client.post("/api/x", { a: 1 });
    await client.request("DELETE", "/api/x", { origin: false });
    await client.request("PUT", "/api/x", { origin: "https://evil.example" });
    expect(seen.map((s) => s.headers.get("origin"))).toEqual([null, "http://localhost:5173", null, "https://evil.example"]);
    expect(seen[1]?.body).toBe('{"a":1}');
    expect(seen[1]?.headers.get("content-type")).toBe("application/json");
  });

  it("keeps cookies from Set-Cookie and drops cleared ones", async () => {
    let n = 0;
    const { fetch, seen } = stubFetch(() => {
      n += 1;
      const headers = new Headers();
      if (n === 1) {
        headers.append("set-cookie", "session_local=abc; Path=/; HttpOnly");
        headers.append("set-cookie", "other=1; Path=/");
      }
      if (n === 2) headers.append("set-cookie", "other=; Path=/; Max-Age=0");
      return new Response(null, { status: 204, headers });
    });
    const client = createClient({ baseUrl: "http://localhost:1", fetch });
    await client.get("/a");
    await client.get("/b");
    await client.get("/c");
    expect(seen[1]?.headers.get("cookie")).toBe("session_local=abc; other=1");
    expect(seen[2]?.headers.get("cookie")).toBe("session_local=abc");
    expect(client.cookies()).toEqual({ session_local: "abc" });
  });

  it("with keepCookies false, remembers no Set-Cookie and sends the caller's cookie header unchanged", async () => {
    const { fetch, seen } = stubFetch(() => new Response(null, { status: 204, headers: { "set-cookie": "session_local=issued; Path=/" } }));
    const client = createClient({ baseUrl: "http://localhost:1", fetch, keepCookies: false });
    await client.get("/a");
    await client.get("/b", { headers: { cookie: "session_local=crafted" } });
    await client.get("/c");
    expect(seen[1]?.headers.get("cookie")).toBe("session_local=crafted");
    expect(seen[2]?.headers.get("cookie")).toBeNull();
    expect(client.cookies()).toEqual({});
  });

  it("logs in through mock-login and gives each identity its own cookie jar", async () => {
    const { fetch, seen } = stubFetch((s) => {
      if (s.url.endsWith("/api/auth/mock-login")) return new Response(null, { status: 204, headers: { "set-cookie": `session_local=${s.body ?? ""}; Path=/` } });
      return new Response("{}", { status: 200 });
    });
    const client = createClient({ baseUrl: "http://localhost:1", fetch });
    const admin = await client.as("admin", { id: "admin-1" });
    await admin.get("/api/me");
    await client.get("/api/me");
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.body).toBe('{"level":"admin","id":"admin-1"}');
    expect(seen[0]?.headers.get("origin")).toBe("http://localhost:1");
    expect(seen[1]?.headers.get("cookie")).toContain("session_local=");
    expect(seen[2]?.headers.get("cookie")).toBeNull();
  });

  it("a failed check names method, path, status, error code and requestId", async () => {
    const { fetch } = stubFetch(() => new Response(errorBody("CORE.INTERNAL", "req-42"), { status: 500, headers: { "content-type": "application/json" } }));
    const client = createClient({ baseUrl: "http://localhost:1", fetch });
    const res = await client.get("/api/kv/x");
    expect(res.errorCode).toBe("CORE.INTERNAL");
    expect(res.requestId).toBe("req-42");
    expect(() => client.expectStatus(res, 200)).toThrow(HttpCheckError);
    expect(() => client.expectStatus(res, 200)).toThrow("HTTP check failed: GET /api/kv/x → status 500, code CORE.INTERNAL, requestId req-42 (expected status 200)");
    expect(client.expectStatus(res, [500])).toBe(res);
    expect(() => client.expectError(res, 500, "SQL.CONFLICT")).toThrow("(expected status 500 with code SQL.CONFLICT)");
    expect(client.expectError(res, 500, "CORE.INTERNAL")).toBe(res);
  });

  it("reports a non-JSON response with code none", async () => {
    const { fetch } = stubFetch(() => new Response("<html>", { status: 403 }));
    const client = createClient({ baseUrl: "http://localhost:1", fetch });
    const res = await client.get("/");
    expect(res.text).toBe("<html>");
    expect(() => client.expectStatus(res, 200)).toThrow("status 403, code none, requestId none");
    expect(() => res.json()).toThrow(/not JSON/);
  });
});
