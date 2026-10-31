/**
 * The Cloudflare runtime's sign-in through the auth app (plan-v0.2.0 §3, §4.1 steps 1 and 4):
 * production stages use the auth-app provider over the `AUTH` service binding, with the auth
 * app's origin from `FRAMEWORK_AUTH_APP_ORIGIN`. The binding is the in-memory fake; nothing is
 * contacted.
 */
import { describe, expect, it } from "vitest";
import { defineApp } from "../../index.js";
import { createDeployment } from "../../core/identity.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import { createFakeAuthAppBinding } from "../../auth/auth-app-binding.js";
import { deriveUserId } from "../../auth/user-id.js";
import { issueSession } from "../../auth/session.js";
import { createCloudflareWorker } from "./public.js";
import { authAppId } from "./auth-app.js";
import { BINDINGS } from "./bindings.js";

const app = defineApp({ name: "cfauth", config: {}, secrets: [], tables: {}, routes: () => undefined });
const ORIGIN = "https://cfauth-prod.example.workers.dev";
const AUTH_ORIGIN = "https://auth.example.workers.dev";
const deployment = createDeployment({ app: "cfauth", stage: "prod", target: "cloudflare" });
const resolved: ResolvedConfig = { deployment, values: {}, secrets: [] };
const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} };

function setup(overrides: Record<string, unknown> = {}) {
  const binding = createFakeAuthAppBinding();
  const env: Record<string, unknown> = {
    [BINDINGS.publicOrigin]: ORIGIN,
    [BINDINGS.authApp]: binding,
    [BINDINGS.authAppOrigin]: AUTH_ORIGIN,
    SECRET_FRAMEWORK_SESSION_KEY: "s".repeat(43),
    // Never used by these routes; the services are built per request.
    [BINDINGS.database]: {},
    [BINDINGS.files]: {},
    ...overrides,
  };
  const worker = createCloudflareWorker(app, resolved);
  const fetch = (path: string, init?: RequestInit) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env, ctx);
  return { binding, fetch };
}

describe("Cloudflare runtime: sign-in through the auth app", () => {
  it("the app ID at the auth app is the Worker name <app>-<stage>", () => {
    expect(authAppId(deployment)).toBe("cfauth-prod");
  });

  it("a production stage's login redirects to the auth app's /start", async () => {
    const res = await setup().fetch("/api/auth/login");
    expect(res.status).toBe(302);
    const start = new URL(res.headers.get("location") ?? "");
    expect(`${start.origin}${start.pathname}`).toBe(`${AUTH_ORIGIN}/start`);
    expect(start.searchParams.get("app")).toBe("cfauth-prod");
    expect(start.searchParams.get("return")).toBe(`${ORIGIN}/api/auth/callback`);
    expect(res.headers.get("set-cookie")).toMatch(/^__Host-login=/);
  });

  it("the callback redeems the code over AUTH and issues a cf-account session", async () => {
    const { binding, fetch } = setup();
    const begun = await fetch("/api/auth/login");
    const start = new URL(begun.headers.get("location") ?? "");
    const tx = (begun.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const code = binding.issueCode({ sub: "cf-sub", email: "a@example.com", role: "admin" }, { app: "cfauth-prod", returnUrl: start.searchParams.get("return") ?? "" });
    const query = new URLSearchParams({ code, state: start.searchParams.get("state") ?? "" });
    const done = await fetch(`/api/auth/callback?${query.toString()}`, { headers: { cookie: tx } });
    expect(done.status).toBe(302);
    const session = done.headers.getSetCookie().find((line) => line.startsWith("__Host-session=")) ?? "";
    const me = await fetch("/api/auth/me", { headers: { cookie: session.split(";")[0] ?? "" } });
    expect(await me.json()).toStrictEqual({ level: "admin", id: await deriveUserId("cf-account", "cf-sub"), displayName: null });
  });

  const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  it("without the auth app's origin, login is CORE.MISCONFIGURED", async () => {
    const res = await setup({ [BINDINGS.authAppOrigin]: undefined }).fetch("/api/auth/login");
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("CORE.MISCONFIGURED");
  });

  it("without the AUTH binding, a cf-account session reads as anonymous (the role read fails)", async () => {
    const token = await issueSession("s".repeat(43), { id: "u_X", displayName: null, provider: "cf-account", subject: "cf-sub" }, Date.now());
    const res = await setup({ [BINDINGS.authApp]: undefined }).fetch("/api/auth/me", { headers: { cookie: `__Host-session=${token}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ level: "anonymous" });
  });

  it("without the AUTH binding, the callback is CORE.MISCONFIGURED, not a failed login", async () => {
    const { fetch } = setup({ [BINDINGS.authApp]: undefined });
    const begun = await fetch("/api/auth/login");
    const state = new URL(begun.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const tx = (begun.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const res = await fetch(`/api/auth/callback?${new URLSearchParams({ code: "c".repeat(43), state }).toString()}`, { headers: { cookie: tx } });
    expect(res.status).toBe(500);
    expect(await code(res)).toBe("CORE.MISCONFIGURED");
  });
});
