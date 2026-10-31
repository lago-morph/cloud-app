/**
 * A browser's part of a sign-in, over plain HTTP (plan-v0.2.0 §4.1): a cookie jar per origin, no
 * redirects followed, `Origin` on state-changing requests. `signIn` walks app `/api/auth/login` →
 * the auth app's `/start` → mock-oauth2-server's login form (posted as a browser would) → the auth
 * app's `/callback` → the app's `/api/auth/callback`, and returns each hop so tests can check it.
 */
import type { SignInStack } from "./signin-stack.js";

export interface Hop {
  readonly status: number;
  readonly location: string | null;
  readonly setCookies: readonly string[];
  readonly text: string;
}

export class Browser {
  private readonly jars = new Map<string, Map<string, string>>();

  constructor(private readonly stack: SignInStack) {}

  cookie(origin: string, name: string): string | undefined {
    return this.jars.get(origin)?.get(name);
  }

  async go(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Hop> {
    const target = new URL(url);
    const jar = this.jars.get(target.origin) ?? new Map<string, string>();
    this.jars.set(target.origin, jar);
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (jar.size > 0) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.method !== undefined && init.method !== "GET") headers.origin ??= target.origin;
    const res = await fetch(url, { method: init.method ?? "GET", headers, redirect: "manual", ...(init.body === undefined ? {} : { body: init.body }) });
    const setCookies = res.headers.getSetCookie();
    for (const c of setCookies) {
      const pair = c.split(";")[0] ?? "";
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      if (/Max-Age=0/i.test(c) || pair.slice(eq + 1) === "") jar.delete(name);
      else jar.set(name, pair.slice(eq + 1));
    }
    const location = res.headers.get("location");
    return { status: res.status, location: location === null ? null : new URL(location, url).toString(), setCookies, text: await res.text() };
  }

  /** `/api/auth/login` and the auth app's `/start`: the issuer's authorize URL (or the refusal). */
  async start(): Promise<{ login: Hop; start: Hop }> {
    const login = await this.go(`${this.stack.appOrigin}/api/auth/login`);
    const start = login.location === null ? login : await this.go(login.location);
    return { login, start };
  }

  /** The person at the issuer: posts its login form as `sub` with `claims`; the redirect to the auth app's callback. */
  async atIssuer(authorizeUrl: string, sub: string, claims: Record<string, unknown>): Promise<string> {
    const r = await fetch(authorizeUrl, { method: "POST", redirect: "manual", body: new URLSearchParams({ username: sub, claims: JSON.stringify({ sub, ...claims }) }) });
    const location = r.headers.get("location");
    if (r.status !== 302 || location === null) throw new Error(`the issuer's login answered ${String(r.status)}`);
    return location;
  }

  /** The whole sign-in; the last hop is the app's callback answer. */
  async signIn(sub: string, claims: Record<string, unknown> = { email: `${sub}@example.com`, email_verified: true }): Promise<{ login: Hop; start: Hop; authCallback: Hop; appCallback: Hop }> {
    const { login, start } = await this.start();
    if (start.status !== 302 || start.location === null) throw new Error(`the auth app's /start answered ${String(start.status)}: ${start.text}`);
    const authCallback = await this.go(await this.atIssuer(start.location, sub, claims));
    if (authCallback.location === null) throw new Error(`the auth app's /callback answered ${String(authCallback.status)}: ${authCallback.text}`);
    const appCallback = await this.go(authCallback.location);
    return { login, start, authCallback, appCallback };
  }

  async me(): Promise<Record<string, unknown>> {
    return JSON.parse((await this.go(`${this.stack.appOrigin}/api/auth/me`)).text) as Record<string, unknown>;
  }

  async api(path: string, method = "GET"): Promise<Hop> {
    return this.go(`${this.stack.appOrigin}${path}`, method === "GET" ? {} : { method, headers: { "content-type": "application/json" }, body: "{}" });
  }
}
