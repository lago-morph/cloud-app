/**
 * E2E-005 — Access levels on a deployed app (Where: Cloud; written now, run in phase D).
 *
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
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Page, Response } from "@playwright/test";
import { tag } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { REPO_ROOT } from "./support/process.js";
import { providerExposures, relativeImports, typeTokens } from "./support/scan.js";

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
