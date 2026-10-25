/**
 * The password routes and pages (password.md §2 "Routes and pages", "Answers";
 * internal/auth-password.openapi.yaml) and AUTH's login-forgery check (AUTH-REQ-007, DEC-0516),
 * over a scripted CredentialProvider: no credential library, database or mail involved.
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import { assembleApp } from "../../core/assemble.js";
import { FrameworkError, type ErrorCode } from "../../core/errors.js";
import { createDeployment } from "../../core/identity.js";
import { defineApp, type Services } from "../../core/public.js";
import { createHttpParts } from "../../http/runtime.js";
import { FRAMEWORK_SECRETS } from "../../secrets/names.js";
import { LOCAL_COOKIES } from "../local-cookies.js";
import type { CredentialProvider } from "../login-provider.js";
import { createAuthMock } from "../mock.js";
import { createAuthParts } from "../runtime.js";

const KEY = "unit-test-key-0123456789abcdefghijklmnop";
const ORIGIN = "http://localhost:8787";

type Op = Exclude<keyof CredentialProvider, "id">;

/** A provider that records its calls and fails an operation with `fail[op]` when set. */
function scripted(fail: Partial<Record<Op, ErrorCode>> = {}) {
  const calls: { op: Op; input: unknown }[] = [];
  const run = async (op: Op, input: unknown) => {
    calls.push({ op, input });
    const code = fail[op];
    if (code !== undefined) throw new FrameworkError(code, `scripted ${op} failure`);
  };
  const provider: CredentialProvider = {
    id: "password",
    signUp: (_ctx, input) => run("signUp", input),
    async signIn(_ctx, input) {
      await run("signIn", input);
      return { subject: "subject-1", displayName: "Display" };
    },
    sendVerification: (_ctx, input) => run("sendVerification", input),
    verify: (_ctx, input) => run("verify", input),
    requestReset: (_ctx, input) => run("requestReset", input),
    reset: (_ctx, input) => run("reset", input),
    accountStatus: async () => ({ verified: true, roles: [] }),
  };
  return { provider, calls };
}

function harness(fail: Partial<Record<Op, ErrorCode>> = {}, withMock = false) {
  const { provider, calls } = scripted(fail);
  const deployment = createDeployment({ app: "notes", stage: "local", target: "local" });
  const auth = createAuthParts({
    deployment,
    publicOrigin: ORIGIN,
    secret: async (_c, name) => {
      if (name === FRAMEWORK_SECRETS.sessionKey) return KEY;
      throw new Error(`unexpected secret ${name}`);
    },
    cookies: LOCAL_COOKIES,
    credentialProvider: () => provider,
    ...(withMock ? { mock: createAuthMock() } : {}),
  });
  const http = createHttpParts();
  const app = defineApp({ name: "notes", config: {}, secrets: [], tables: {}, routes: () => undefined });
  const hono = assembleApp(app, {
    deployment,
    createLog: () => ({ write: () => undefined }),
    createServices: () => ({}) as unknown as Omit<Services, "log">,
    currentUser: auth.currentUser,
    forgeryCheck: auth.forgeryCheck,
    ...http.parts,
    frameworkRoutes: (api) => {
      http.parts.frameworkRoutes?.(api);
      auth.routes(api);
    },
  });
  http.attach(hono);
  return { request: (path: string, init?: RequestInit) => hono.request(path, init), calls };
}

function post(path: string, body: Record<string, string>, options: { json?: boolean; origin?: string | null; accept?: boolean } = {}): RequestInit & { path: string } {
  const json = options.json ?? true;
  const headers: Record<string, string> = { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" };
  if (options.accept ?? json) headers["accept"] = "application/json";
  if (options.origin !== null) headers["origin"] = options.origin ?? ORIGIN;
  return { path, method: "POST", headers, body: json ? JSON.stringify(body) : new URLSearchParams(body).toString() };
}

async function send(h: ReturnType<typeof harness>, r: ReturnType<typeof post>): Promise<Response> {
  const { path, ...init } = r;
  return h.request(path, init);
}

async function code(res: Response): Promise<string> {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

const BODIES = {
  "sign-up": { email: "a@example.test", password: "p".repeat(12), displayName: "A" },
  "sign-in": { email: "a@example.test", password: "p".repeat(12) },
  resend: { email: "a@example.test" },
  verify: { token: "tok" },
  forgot: { email: "a@example.test" },
  reset: { token: "tok", password: "p".repeat(12) },
} as const;

describe("password pages", () => {
  const pages = ["/api/auth/sign-in", "/api/auth/sign-up", "/api/auth/forgot", "/api/auth/verify?token=t0k", "/api/auth/reset?token=t0k"];

  it.each(pages)(tag("AUTH-AC-005", "GET %s is a scriptless HTML page with a form, never cached, naming no provider"), async (path) => {
    const res = await harness().request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html><html lang="en">/);
    expect(html).toMatch(/<form method="post" action="\/api\/auth\/password\//);
    expect(html).not.toMatch(/<script/i);
    expect(html.toLowerCase()).not.toMatch(/better.?auth|cloudflare|google|provider/);
    // Every input has a label.
    for (const [, id] of html.matchAll(/<input id="([^"]+)"/g)) expect(html).toContain(`<label for="${id}">`);
  });

  it("the sign-in page keeps a sanitized returnTo as a hidden field, escaped, and drops an unsafe one", async () => {
    const h = harness();
    expect(await (await h.request("/api/auth/sign-in?returnTo=%2Fnotes%3Fa%3D1%26b%3D%22x%22")).text()).toContain('name="returnTo" value="/notes?a=1&#38;b=&#34;x&#34;"');
    expect(await (await h.request("/api/auth/sign-in?returnTo=%2F%2Fevil.example")).text()).not.toContain("returnTo");
  });

  it("messages are fixed texts chosen by ?error= and ?notice=; anything else shows nothing", async () => {
    const h = harness();
    expect(await (await h.request("/api/auth/sign-in?error=not_verified")).text()).toContain('role="alert"');
    expect(await (await h.request("/api/auth/sign-in?notice=check_email")).text()).toContain('role="status"');
    const odd = await (await h.request("/api/auth/sign-in?error=%3Cb%3Eowned&notice=x")).text();
    expect(odd).not.toContain("owned");
    expect(odd).not.toContain('role="alert"');
  });

  it("the verify and reset pages change nothing: they only carry the token into a POST form", async () => {
    const h = harness();
    const page = await (await h.request("/api/auth/verify?token=a%22b")).text();
    expect(page).toContain('<form method="post" action="/api/auth/password/verify">');
    expect(page).toContain('name="token" value="a&#34;b"');
    expect(await (await h.request("/api/auth/reset")).text()).not.toContain("<form");
    expect(h.calls).toEqual([]);
  });

  it(tag("AUTH-AC-005", "GET /api/auth/login redirects (302) to the sign-in page with the sanitized returnTo, even beside the mock"), async () => {
    const h = harness({}, true);
    const res = await h.request("/api/auth/login?returnTo=%2Fnotes");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/api/auth/sign-in?returnTo=%2Fnotes");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await h.request("/api/auth/login?returnTo=https%3A%2F%2Fevil.example")).headers.get("location")).toBe("/api/auth/sign-in");
  });
});

describe("password endpoints", () => {
  it.each(Object.keys(BODIES) as (keyof typeof BODIES)[])(
    tag("AUTH-AC-014", "POST /api/auth/password/%s without a session and with Origin missing or foreign is 403 AUTH.REQUEST_FORGERY and reaches no provider"),
    async (name) => {
      const h = harness();
      for (const origin of [null, "https://evil.example", "null", `${ORIGIN}/`]) {
        for (const json of [true, false]) {
          const res = await send(h, post(`/api/auth/password/${name}`, BODIES[name], { origin, json, accept: true }));
          expect(res.status).toBe(403);
          expect(await code(res)).toBe("AUTH.REQUEST_FORGERY");
          expect(res.headers.getSetCookie()).toEqual([]);
        }
      }
      expect(h.calls).toEqual([]);
      expect((await send(h, post(`/api/auth/password/${name}`, BODIES[name]))).status).toBe(200);
    },
  );

  it(tag("AUTH-AC-014", "every other POST under /api/auth/ also needs the public origin without a session (logout, mock-login)"), async () => {
    const h = harness({}, true);
    for (const path of ["/api/auth/logout", "/api/auth/mock-login"]) {
      const res = await send(h, post(path, { level: "user" }, { origin: "https://evil.example" }));
      expect(res.status).toBe(403);
      expect(await code(res)).toBe("AUTH.REQUEST_FORGERY");
    }
  });

  it("JSON answers: the fixed results of the contract; sign-in sets only the session cookie and returns the sanitized returnTo", async () => {
    const h = harness();
    const results: Record<keyof typeof BODIES, unknown> = {
      "sign-up": { result: "check-email" },
      "sign-in": { result: "signed-in", returnTo: "/" },
      resend: { result: "check-email" },
      verify: { result: "verified" },
      forgot: { result: "check-email" },
      reset: { result: "password-reset" },
    };
    for (const [name, body] of Object.entries(BODIES) as [keyof typeof BODIES, Record<string, string>][]) {
      const res = await send(h, post(`/api/auth/password/${name}`, body));
      expect(res.status, name).toBe(200);
      expect(await res.json(), name).toStrictEqual(results[name]);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.getSetCookie().map((c) => c.split("=")[0]), name).toEqual(name === "sign-in" ? ["session_local"] : []);
    }
    const back = await send(h, post("/api/auth/password/sign-in", { ...BODIES["sign-in"], returnTo: "//evil.example" }));
    expect(await back.json()).toStrictEqual({ result: "signed-in", returnTo: "/" });
    expect(h.calls.find((c) => c.op === "reset")?.input).toStrictEqual({ token: "tok", newPassword: "p".repeat(12) });
  });

  it("form answers: a 303 to the matching page, or to returnTo after a sign-in", async () => {
    const h = harness();
    const locations: Record<keyof typeof BODIES, string> = {
      "sign-up": "/api/auth/sign-in?notice=check_email",
      "sign-in": "/notes",
      resend: "/api/auth/sign-in?notice=check_email",
      verify: "/api/auth/sign-in?notice=verified",
      forgot: "/api/auth/sign-in?notice=check_email",
      reset: "/api/auth/sign-in?notice=password_reset",
    };
    for (const [name, body] of Object.entries(BODIES) as [keyof typeof BODIES, Record<string, string>][]) {
      const res = await send(h, post(`/api/auth/password/${name}`, name === "sign-in" ? { ...body, returnTo: "/notes" } : body, { json: false }));
      expect(res.status, name).toBe(303);
      expect(res.headers.get("location"), name).toBe(locations[name]);
    }
  });

  it("refusals: the catalogue error in JSON (429 with Retry-After), a generic page message for a form, never a cookie", async () => {
    const failed = harness({ signIn: "AUTH.LOGIN_FAILED" });
    const json = await send(failed, post("/api/auth/password/sign-in", BODIES["sign-in"]));
    expect(json.status).toBe(400);
    expect(await code(json)).toBe("AUTH.LOGIN_FAILED");
    expect(json.headers.getSetCookie()).toEqual([]);
    const form = await send(failed, post("/api/auth/password/sign-in", { ...BODIES["sign-in"], returnTo: "/notes" }, { json: false }));
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe("/api/auth/sign-in?error=login_failed&returnTo=%2Fnotes");
    expect(form.headers.getSetCookie()).toEqual([]);

    const limited = harness({ signUp: "AUTH.RATE_LIMITED" });
    const r = await send(limited, post("/api/auth/password/sign-up", BODIES["sign-up"]));
    expect(r.status).toBe(429);
    expect(await code(r)).toBe("AUTH.RATE_LIMITED");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);

    const expired = harness({ reset: "AUTH.LOGIN_FAILED" });
    expect((await send(expired, post("/api/auth/password/reset", BODIES.reset, { json: false }))).headers.get("location")).toBe("/api/auth/forgot?error=link_invalid");
    const short = harness({ reset: "HTTP.INVALID_INPUT" });
    expect((await send(short, post("/api/auth/password/reset", BODIES.reset, { json: false }))).headers.get("location")).toBe("/api/auth/reset?token=tok&error=invalid_input");
  });

  it("JSON bodies follow the contract's schemas: unknown fields, non-strings, missing fields and other content types are 400 HTTP.INVALID_INPUT", async () => {
    const h = harness();
    for (const body of [{ ...BODIES.forgot, extra: "x" }, { email: 5 }, {}]) {
      const res = await h.request("/api/auth/password/forgot", { method: "POST", headers: { origin: ORIGIN, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe("HTTP.INVALID_INPUT");
    }
    const text = await h.request("/api/auth/password/forgot", { method: "POST", headers: { origin: ORIGIN, accept: "application/json", "content-type": "text/plain" }, body: "email=a" });
    expect(await code(text)).toBe("HTTP.INVALID_INPUT");
    expect(h.calls).toEqual([]);
  });

  it("the credential library's own paths are not routed", async () => {
    const res = await send(harness(), post("/api/auth/password/sign-in/email", BODIES["sign-in"]));
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("HTTP.NOT_FOUND");
  });
});
