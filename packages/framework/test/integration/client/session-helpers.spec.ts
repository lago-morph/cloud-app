/**
 * `./client`'s AUTH helpers in Chromium on the `dev` origin (S4 coverage list §1.1 item 3;
 * Playwright project "integration"): `getCurrentUser`, `login(returnTo)` and `logout`, from the
 * package's real `./client` export bundled for the browser, against `dev` with the mock (local
 * development installs only the mock: `/api/auth/login` sets a mock session for the default user
 * and redirects to the sanitized `returnTo`, auth.md §2 "Provider per stage", DEC-0171/0694).
 * Written from client.d.ts, auth.md §2 (login flow, AUTH-REQ-006/010) and framework.openapi.yaml,
 * not from the code. Untagged: AUTH-AC-010's hostile values are evidenced in-process; this suite
 * checks the browser helpers end to end.
 */
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { devFixtureFiles, makeTempApp, PACKAGE_NAME, REPO_ROOT, requireBuiltFramework, startDev, type DevServer, type TempApp } from "../core/harness/harness.js";
import type * as Client from "../../../src/client/index.js";

type ClientModule = typeof Client;
/** The local session cookie (auth.md §2 "Session cookie"). */
const SESSION_COOKIE = "session_local";
/** AUTH-AC-010's hostile `returnTo` values: each must land on `/`. */
const HOSTILE = ["//evil.example", "/\\evil.example", "https://evil.example", "/%2F%2Fevil.example", "javascript:alert(1)"];

let app: TempApp | undefined;
let started: Promise<DevServer> | undefined;
let clientBundle: string | undefined;
test.describe.configure({ timeout: 240_000 });

/** Starts `dev` and bundles `./client` on first use, so a failing start fails each test. */
function server(): Promise<DevServer> {
  started ??= (async () => {
    requireBuiltFramework();
    const bundled = await build({
      stdin: { contents: `export * from "${PACKAGE_NAME}/client";`, resolveDir: REPO_ROOT, loader: "ts" },
      bundle: true,
      format: "iife",
      globalName: "t3fw",
      platform: "browser",
      write: false,
    });
    clientBundle = bundled.outputFiles[0]!.text;
    app = await makeTempApp(devFixtureFiles({ name: "clientsuite" }));
    return startDev(app.dir);
  })();
  return started;
}
let dev: DevServer;
test.beforeEach(async () => {
  dev = await server();
});
test.afterAll(async () => {
  await started?.then((d) => d.stop(), () => undefined);
  await app?.remove();
});

/** Opens `path` on the dev origin with `./client` loaded in the page. */
async function open(page: Page, path = "/"): Promise<void> {
  await page.goto(`${dev.baseUrl}${path}`);
  await page.addScriptTag({ content: clientBundle! });
}
const currentUser = (page: Page) => page.evaluate(() => (globalThis as unknown as { t3fw: ClientModule }).t3fw.getCurrentUser());
/** Calls `login(returnTo)` in the page and waits for the navigation it starts to settle on the dev origin. */
async function loginTo(page: Page, returnTo?: string): Promise<URL> {
  // The next document the page commits after the call (the /api/auth/login redirect is not committed).
  const navigated = page.waitForEvent("framenavigated", { predicate: (f) => f === page.mainFrame(), timeout: 60_000 });
  // If the page commits the new document before evaluate returns, evaluate reports the lost context.
  const call = page.evaluate((r) => (globalThis as unknown as { t3fw: ClientModule }).t3fw.login(r), returnTo).catch((e: unknown) => {
    if (!/context was destroyed|navigat/i.test(String(e))) throw e;
  });
  await Promise.all([navigated, call]);
  await page.waitForLoadState("load");
  await page.addScriptTag({ content: clientBundle! });
  return new URL(page.url());
}
const sessionCookie = async (page: Page) => (await page.context().cookies(dev.baseUrl)).find((c) => c.name === SESSION_COOKIE);

test("getCurrentUser: anonymous without a session, user after login, admin after a mock admin login", async ({ page }) => {
  await open(page);
  expect(await currentUser(page)).toEqual({ level: "anonymous" });

  await loginTo(page, "/");
  const user = await currentUser(page);
  expect(user.level).toBe("user");
  expect(user.level !== "anonymous" && typeof user.id === "string" && user.id.length > 0).toBe(true);
  expect(Object.keys(user).sort(), "exactly the fields of a logged-in CurrentUser").toEqual(["displayName", "id", "level"]);

  // The mock lets a test choose the level (AUTH-REQ-009); a same-origin POST from the page carries Origin.
  const status = await page.evaluate(async () => (await fetch("/api/auth/mock-login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "admin", id: "u_admin_t3", displayName: "T3 Admin" }) })).status);
  expect(status, "framework.openapi.yaml: mock-login answers 204").toBe(204);
  expect(await currentUser(page)).toEqual({ level: "admin", id: "u_admin_t3", displayName: "T3 Admin" });
});

test("login(returnTo) goes through /api/auth/login and lands on returnTo with a session; without returnTo it returns to the current page", async ({ page }) => {
  const seen: string[] = [];
  page.on("request", (r) => seen.push(new URL(r.url()).pathname));
  await open(page, "/start/here");
  const landed = await loginTo(page, "/notes/42?tab=files#top");
  expect(seen).toContain("/api/auth/login");
  expect(`${landed.pathname}${landed.search}`).toBe("/notes/42?tab=files");
  expect((await sessionCookie(page))?.httpOnly).toBe(true);
  expect((await currentUser(page)).level).toBe("user");

  await page.context().clearCookies();
  await open(page, "/some/deep/page?q=1");
  const back = await loginTo(page);
  expect(`${back.pathname}${back.search}`).toBe("/some/deep/page?q=1");
});

for (const hostile of HOSTILE) {
  test(`login(${JSON.stringify(hostile)}) lands on / of the app's own origin`, async ({ page }) => {
    await open(page);
    const landed = await loginTo(page, hostile);
    expect(landed.origin).toBe(dev.baseUrl);
    expect(landed.pathname).toBe("/");
    expect((await currentUser(page)).level, "the login itself still succeeds").toBe("user");
  });
}

test("logout ends the session: the cookie is cleared and the server sees anonymous; a second logout is harmless", async ({ page }) => {
  await open(page);
  await loginTo(page, "/");
  expect(await sessionCookie(page)).toBeDefined();
  await page.evaluate(() => (globalThis as unknown as { t3fw: ClientModule }).t3fw.logout());
  expect(await sessionCookie(page)).toBeUndefined();
  expect(await currentUser(page)).toEqual({ level: "anonymous" });
  await page.evaluate(() => (globalThis as unknown as { t3fw: ClientModule }).t3fw.logout());
  expect(await currentUser(page)).toEqual({ level: "anonymous" });
});
