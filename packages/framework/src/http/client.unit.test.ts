import { afterEach, describe, expect, it, vi } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { ApiError, api } from "./client.js";

/** Stubs `fetch` with `respond`, recording each call's URL and init. */
function stubFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error("expected the call to throw");
}

describe("api: successful responses", () => {
  it("calls /api<path> on the app's own origin with the session cookie and parses the JSON response", async () => {
    const calls = stubFetch(() => Response.json({ id: "n1" }));
    expect(await api("/notes/n1")).toEqual({ id: "n1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/notes/n1");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.credentials).toBe("same-origin");
  });

  it("sends the body as JSON and appends the query", async () => {
    const calls = stubFetch(() => Response.json({ ok: true }, { status: 201 }));
    await api("/notes", { method: "POST", body: { title: "a b" }, query: { tag: "x&y", page: "2" } });
    expect(calls[0]!.url).toBe("/api/notes?tag=x%26y&page=2");
    expect(calls[0]!.init.method).toBe("POST");
    expect(new Headers(calls[0]!.init.headers).get("content-type")).toBe("application/json");
    expect(calls[0]!.init.body).toBe('{"title":"a b"}');
  });

  it("resolves undefined for a 2xx with no body", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await api("/notes/n1", { method: "DELETE" })).toBeUndefined();
    stubFetch(() => new Response("", { status: 200 }));
    expect(await api("/ping")).toBeUndefined();
  });
});

const errorBody = (code: string, message = "nope", requestId = "req-9") => ({ error: { code, message, requestId } });

describe("api: failures", () => {
  it(tag("HTTP-AC-006", "unit part: an ErrorResponse becomes ApiError with the server's code, status, message and request ID"), async () => {
    stubFetch(() => Response.json(errorBody("HTTP.NOT_FOUND", "no such note"), { status: 404 }));
    const e = await caught(api("/notes/x"));
    expect(e.code).toBe("HTTP.NOT_FOUND");
    expect(e.status).toBe(404);
    expect(e.requestId).toBe("req-9");
    expect(e.message).toBe("no such note");
    expect(e.name).toBe("ApiError");
  });

  it(tag("HTTP-AC-006", "unit part: an unreachable API throws HTTP.NETWORK_ERROR with status and requestId null"), async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const e = await caught(api("/notes"));
    expect(e.code).toBe("HTTP.NETWORK_ERROR");
    expect(e.status).toBeNull();
    expect(e.requestId).toBeNull();
  });

  it(tag("HTTP-AC-006", "unit part: a 502 HTML response and a non-JSON 200 each throw HTTP.NETWORK_ERROR with that status, requestId null and the not-from-the-app message"), async () => {
    const cases: [number, Response][] = [
      [502, new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } })],
      [200, new Response("<html>app shell</html>", { status: 200, headers: { "Content-Type": "text/html" } })],
      [200, new Response("{broken", { status: 200, headers: { "Content-Type": "application/json" } })],
      [500, Response.json({ error: { code: "NOT.A_CODE", message: "m", requestId: "r" } }, { status: 500 })],
      [404, Response.json({ error: { code: "HTTP.NOT_FOUND", message: "m" } }, { status: 404 })],
      [400, Response.json({ error: errorBody("HTTP.INVALID_INPUT").error, extra: 1 }, { status: 400 })],
      [503, new Response(null, { status: 503 })],
    ];
    for (const [status, res] of cases) {
      stubFetch(() => res);
      const e = await caught(api("/notes"));
      expect(e.code, String(status)).toBe("HTTP.NETWORK_ERROR");
      expect(e.status).toBe(status);
      expect(e.requestId).toBeNull();
      expect(e.message).toBe(`response did not come from the app (status ${status})`);
    }
  });
});
