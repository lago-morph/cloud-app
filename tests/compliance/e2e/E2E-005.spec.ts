/**
 * E2E-005 — Access levels, and nothing of the login provider exposed (Where: Local, cloud; rewritten
 * for v0.2.0, DEC-0753).
 *
 * Mock part, on every target (the text before v0.2.0, unchanged in substance):
 * "On each cloud test stage, use the mock to act as anonymous, user, and admin in a browser
 * against the reference app, exercising its protected routes. Inspect every API response and
 * the app-facing types. Pass: each level gets exactly its permitted actions. No response or
 * app-facing type exposes login-provider names, login-provider tokens, issuers, or email
 * addresses."
 *
 * The browser logs in through `/api/auth/mock-login` and calls the protected routes of
 * ROUTES.md with `fetch` from the app's own page, so cookies, `Origin` and same-site rules are
 * the browser's. Every `/api` response the browser receives is inspected (bodies and headers).
 * The app-facing types are the declaration files of the subpaths app code may import (`.`,
 * `./client`, `./testing`; CORE-REQ-005) as the package ships them, with every declaration file
 * they reach.
 *
 * Auth-app part, locally (DEC-0753, DEC-0764): a browser signs in through the auth app's pages and
 * mock-oauth2-server's login form, against the reference app's production bundle
 * (support/signin-stack.ts), as a member with no administrator role and as an administrator, both
 * with an email address; it checks each level's actions and that no app response carries either
 * address or any provider detail. This is also E2E-018's one UI test (the sign-in pages, cookies).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Page, Response } from "@playwright/test";
import { tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { REPO_ROOT } from "./support/process.js";
import { providerExposures, relativeImports, typeTokens } from "./support/scan.js";
import { APP_ID, startSignInStack } from "./support/signin-stack.js";
import { ACCOUNT_ID } from "../../../packages/framework/test/integration/auth-app/support.js";

type Level = "anonymous" | "user" | "admin";

interface Call {
  readonly method: "GET" | "POST";
  readonly path: string;
}

interface Outcome {
  readonly status: number;
  readonly body: unknown;
}

/** What each level may do on the reference app's protected routes (ROUTES.md "Access levels", "KV", "Files"). */
const EXPECTED: readonly { readonly call: Call; readonly allowed: readonly Level[]; readonly level: "user" | "admin" | "anyone" }[] = [
  { call: { method: "GET", path: "/api/levels/anyone" }, allowed: ["anonymous", "user", "admin"], level: "anyone" },
  { call: { method: "GET", path: "/api/levels/user" }, allowed: ["user", "admin"], level: "user" },
  { call: { method: "POST", path: "/api/levels/user" }, allowed: ["user", "admin"], level: "user" },
  { call: { method: "GET", path: "/api/levels/admin" }, allowed: ["admin"], level: "admin" },
  { call: { method: "POST", path: "/api/levels/admin" }, allowed: ["admin"], level: "admin" },
  { call: { method: "GET", path: "/api/levels/current" }, allowed: ["user", "admin"], level: "user" },
  { call: { method: "GET", path: "/api/kv/value?key=e2e005%3Aprobe" }, allowed: ["user", "admin"], level: "user" },
  { call: { method: "GET", path: "/api/files/head?name=e2e005%2Fprobe" }, allowed: ["user", "admin"], level: "user" },
];

async function browserFetch(page: Page, call: Call): Promise<Outcome> {
  return page.evaluate(async ({ method, path }) => {
    const init: RequestInit = method === "POST" ? { method, headers: { "content-type": "application/json" }, body: "{}" } : { method };
    const response = await fetch(path, init);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: response.status, body };
  }, call);
}

async function mockLogin(page: Page, level: "user" | "admin", id: string, displayName: string): Promise<void> {
  const outcome = await page.evaluate(async (json) => {
    const response = await fetch("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
    return response.status;
  }, { level, id, displayName });
  expect(outcome, `mock-login as ${level}`).toBe(204);
}

/** Every `/api` response the page receives, with its body and headers. */
function recordApiResponses(page: Page): { readonly seen: { url: string; status: number; text: string; headers: Record<string, string> }[]; settle(): Promise<void> } {
  const seen: { url: string; status: number; text: string; headers: Record<string, string> }[] = [];
  const pending: Promise<void>[] = [];
  page.on("response", (response: Response) => {
    if (!new URL(response.url()).pathname.startsWith("/api/")) return;
    pending.push(
      (async () => {
        let text = "";
        try {
          text = (await response.body()).toString("utf8");
        } catch {
          // redirects and aborted responses have no body
        }
        seen.push({ url: response.url(), status: response.status(), text, headers: await response.allHeaders() });
      })(),
    );
  });
  return { seen, settle: async () => void (await Promise.all(pending)) };
}

function checkLevel(level: Level, outcomes: readonly { readonly call: Call; readonly outcome: Outcome }[], userId: string | undefined): void {
  for (const { call, outcome } of outcomes) {
    const rule = EXPECTED.find((e) => e.call === call);
    if (rule === undefined) continue;
    const what = `${level}: ${call.method} ${call.path}`;
    if (rule.allowed.includes(level)) {
      expect(outcome.status, `${what} is permitted`).toBe(200);
      if (call.path.startsWith("/api/levels/")) {
        // `/levels/anyone` answers `{ level }`; the guarded ones `{ level, id }` (ROUTES.md).
        expect(outcome.body, `${what} body`).toEqual(level === "anonymous" || rule.level === "anyone" ? { level } : { level, id: userId });
      }
    } else {
      const expected = level === "anonymous" ? { status: 401, code: "AUTH.UNAUTHENTICATED" } : { status: 403, code: "AUTH.FORBIDDEN" };
      expect(outcome.status, `${what} is refused`).toBe(expected.status);
      expect((outcome.body as { error?: { code?: string } }).error?.code, `${what} code`).toBe(expected.code);
    }
  }
}

test(tag("E2E-005", "anonymous, user and admin each get exactly their permitted actions in a browser, and no API response exposes login-provider details"), async ({ page }) => {
  const recorder = recordApiResponses(page);
  await page.goto("/");
  await expect(page.getByTestId("account")).toBeVisible();

  const ids = { user: `e2e005-user-${randomSuffix()}`, admin: `e2e005-admin-${randomSuffix()}` };
  const run = async (level: Level): Promise<void> => {
    if (level !== "anonymous") {
      await mockLogin(page, level, ids[level], `E2E Five ${level}`);
      await page.reload();
      await expect(page.getByTestId("account")).toBeVisible();
    }
    const me = await browserFetch(page, { method: "GET", path: "/api/auth/me" });
    expect(me.status).toBe(200);
    expect(me.body).toEqual(level === "anonymous" ? { level: "anonymous" } : { level, id: ids[level], displayName: `E2E Five ${level}` });
    const ref = await browserFetch(page, { method: "GET", path: "/api/ref/me" });
    expect(ref.body).toEqual({ user: level === "anonymous" ? { level: "anonymous" } : { level, id: ids[level], displayName: `E2E Five ${level}` } });
    const outcomes: { call: Call; outcome: Outcome }[] = [];
    for (const { call } of EXPECTED) outcomes.push({ call, outcome: await browserFetch(page, call) });
    checkLevel(level, outcomes, level === "anonymous" ? undefined : ids[level]);
  };

  await run("anonymous");
  await run("user");
  // Logging out returns the browser to anonymous.
  expect((await browserFetch(page, { method: "POST", path: "/api/auth/logout" })).status).toBe(204);
  expect((await browserFetch(page, { method: "GET", path: "/api/auth/me" })).body).toEqual({ level: "anonymous" });
  await run("admin");

  await recorder.settle();
  expect(recorder.seen.length, "API responses were recorded").toBeGreaterThan(EXPECTED.length * 3);
  const exposures: string[] = [];
  for (const r of recorder.seen) {
    const headerText = Object.entries(r.headers)
      .filter(([name]) => name !== "set-cookie")
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n");
    for (const label of providerExposures(`${r.text}\n${headerText}`)) exposures.push(`${new URL(r.url).pathname} (${String(r.status)}): ${label}`);
  }
  expect(exposures, `API responses exposing login-provider details:\n${exposures.join("\n")}`).toEqual([]);
});

/** The declaration file a package export's `types` condition names. */
function exportTypes(pkgDir: string, subpath: string): string {
  const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { exports: Record<string, { types?: string }> };
  const types = pkg.exports[subpath]?.types;
  if (types === undefined) throw new Error(`the framework package has no types for ${subpath}`);
  return resolve(pkgDir, types);
}

test(tag("E2E-005", "no app-facing type exposes login-provider names, tokens, issuers or email addresses"), () => {
  // Positive controls: the detector sees each kind of exposure.
  for (const sample of ["googleSub", "idToken", "access_token", "issuer", "OAuthClient", "email", "a@b.example", "eyJhbGciOi.eyJzdWIiOi.sig"]) {
    expect(providerExposures(sample), `detector misses ${sample}`).not.toEqual([]);
  }
  expect(providerExposures("displayName level id requestId")).toEqual([]);
  const pkgDir = join(REPO_ROOT, "node_modules", "@lago-morph", "prototype-framework");
  const queue = [".", "./client", "./testing"].map((s) => exportTypes(pkgDir, s));
  const seen = new Set<string>();
  const exposures: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift() ?? "";
    if (seen.has(file)) continue;
    seen.add(file);
    expect(existsSync(file), `${relative(pkgDir, file)} exists (build the framework first)`).toBe(true);
    const source = readFileSync(file, "utf8");
    for (const token of typeTokens(source)) {
      for (const label of providerExposures(token)) exposures.push(`${relative(pkgDir, file)}: ${JSON.stringify(token)} (${label})`);
    }
    for (const spec of relativeImports(source)) {
      const base = resolve(dirname(file), spec);
      const candidate = [base.replace(/\.js$/, ".d.ts"), `${base}.d.ts`, join(base, "index.d.ts")].find((c) => existsSync(c));
      if (candidate !== undefined) queue.push(candidate);
    }
  }
  expect(seen.size, "declaration files scanned").toBeGreaterThan(3);
  expect(exposures, `app-facing types exposing login-provider details:\n${exposures.join("\n")}`).toEqual([]);
});

// Locally only: test stages and `dev` have the mock only (plan-v0.2.0 §4.3), so the auth-app part needs the local stack.
if (target().target === "local") {
  test(tag(["E2E-005", "E2E-018"], "auth-app part: members with an email address sign in through the sign-in pages in a browser, get exactly their level's actions, and no app response carries the address or a provider detail"), async ({ page }) => {
    test.setTimeout(600_000);
    const stack = await startSignInStack();
    try {
      await stack.registry.register(APP_ID, `${stack.appOrigin}/api/auth/callback`);
      const people = {
        user: { sub: "e2e005-user", email: "e2e005.user@example.com", roles: ["HTTP Applications Read"] },
        admin: { sub: "e2e005-admin", email: "e2e005.admin@example.com", roles: ["Super Administrator - All Privileges"] },
      };
      for (const p of Object.values(people)) stack.members.set(p.sub, { email: p.email, memberships: [{ account: { id: ACCOUNT_ID }, status: "accepted", roles: p.roles }] });
      const app = (path: string) => `${stack.appOrigin}${path}`;
      const fetchIn = async (call: Call): Promise<Outcome> => {
        const r = await page.request.fetch(app(call.path), { method: call.method, ...(call.method === "POST" ? { headers: { "content-type": "application/json", origin: stack.appOrigin }, data: "{}" } : {}) });
        const text = await r.text();
        let body: unknown = text;
        try {
          body = JSON.parse(text);
        } catch {
          // not JSON
        }
        return { status: r.status(), body };
      };
      for (const level of ["user", "admin"] as const) {
        const person = people[level];
        await page.context().clearCookies();
        // The sign-in pages: the app's login, the auth app's /start, the issuer's login form, both callbacks.
        await page.goto(app("/api/auth/login"));
        await expect(page).toHaveURL(new RegExp(`^${stack.oauth.baseUrl}/`));
        await page.locator('input[name="username"]').fill(person.sub);
        await page.locator('textarea[name="claims"]').fill(JSON.stringify({ sub: person.sub, email: person.email, email_verified: true }));
        await page.locator('input[type="submit"], button[type="submit"]').first().click();
        await page.waitForURL((u) => u.origin === stack.appOrigin);
        const cookies = await page.context().cookies(stack.appOrigin);
        expect(cookies.find((c) => c.name === "__Host-session"), `${level}: the session cookie`).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
        const me = await fetchIn({ method: "GET", path: "/api/auth/me" });
        expect(me.body).toMatchObject({ level });
        const outcomes: { call: Call; outcome: Outcome }[] = [];
        for (const { call } of EXPECTED) outcomes.push({ call, outcome: await fetchIn(call) });
        checkLevel(level, outcomes, (me.body as { id?: string }).id);
      }
      expect(stack.appResponses.length, "app responses were recorded").toBeGreaterThan(EXPECTED.length * 2);
      const exposures: string[] = [];
      for (const r of stack.appResponses) {
        const seen = `${r.text}\n${r.headers}`;
        for (const p of Object.values(people)) if (seen.includes(p.email) || seen.includes(p.sub)) exposures.push(`${new URL(r.url).pathname}: ${p.sub}'s address or subject`);
        for (const label of providerExposures(seen)) exposures.push(`${new URL(r.url).pathname} (${String(r.status)}): ${label}`);
      }
      expect(exposures, `app responses exposing login-provider details:\n${exposures.join("\n")}`).toEqual([]);
    } finally {
      await stack.close();
    }
  });
}
