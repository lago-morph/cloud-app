/**
 * HTTP-AC-006 browser test (Playwright, project "integration"): the `api` helper from
 * `<package>/client` running in Chromium on the `dev` origin. The helper module is the package's
 * real `./client` export, bundled for the browser with esbuild and added to the client page.
 * Criteria: docs/components/http.md §4; contract: docs/contracts/ts/client.d.ts.
 */
import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { tag } from "../../../../../tests/support/tags.js";
import {
  devFixtureFiles,
  makeTempApp,
  PACKAGE_NAME,
  REPO_ROOT,
  requireBuiltFramework,
  startDev,
  type DevServer,
  type TempApp,
} from "../core/harness/harness.js";
import type * as Client from "../../../src/client/index.js";

type ClientModule = typeof Client;

interface CaughtError {
  readonly threw: boolean;
  readonly isApiError?: boolean | undefined;
  readonly code?: string | undefined;
  readonly status?: number | null | undefined;
  readonly requestId?: string | null | undefined;
  readonly message?: string | undefined;
  readonly value?: unknown;
}

let app: TempApp | undefined;
let started: Promise<DevServer> | undefined;
let clientBundle: string | undefined;

// Tests run in order in one worker; a failure in one does not skip the others.
test.describe.configure({ timeout: 240_000 });

/** Starts `dev` and bundles `./client` on first use, so a failing start fails each test. */
function server(): Promise<DevServer> {
  started ??= (async () => {
    requireBuiltFramework();
    const bundled = await build({
      stdin: { contents: `export * from "${PACKAGE_NAME}/client";`, resolveDir: REPO_ROOT, loader: "ts" },
      bundle: true,
      format: "iife",
      globalName: "bt1fw",
      platform: "browser",
      write: false,
    });
    clientBundle = bundled.outputFiles[0]!.text;
    app = await makeTempApp(devFixtureFiles());
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

async function openClientPage(page: Page): Promise<void> {
  await page.goto(`${dev.baseUrl}/`);
  await page.addScriptTag({ content: clientBundle! });
}

/** Calls `api(path)` in the page and reports the result or the thrown error's fields. */
function callApi(page: Page, path: string): Promise<CaughtError> {
  return page.evaluate(async (p) => {
    const fw = (globalThis as unknown as { bt1fw: ClientModule }).bt1fw;
    try {
      const value = await fw.api(p);
      return { threw: false, value };
    } catch (e) {
      const err = e as { code?: string; status?: number | null; requestId?: string | null; message?: string };
      return {
        threw: true,
        isApiError: e instanceof fw.ApiError,
        code: err.code,
        status: err.status,
        requestId: err.requestId,
        message: err.message,
      };
    }
  }, path);
}

test(tag("HTTP-AC-006", "api sends the session cookie"), async ({ page }) => {
  await openClientPage(page);
  const before = await callApi(page, "/whoami");
  expect(before).toEqual({ threw: false, value: { level: "anonymous" } });

  const login = await page.request.post(`${dev.baseUrl}/api/auth/mock-login`, {
    data: { level: "user", id: "u_bt1browser", displayName: "Browser User" },
    headers: { Origin: dev.baseUrl },
  });
  expect(login.status()).toBe(204);

  const after = await callApi(page, "/whoami");
  expect(after).toEqual({ threw: false, value: { level: "user", id: "u_bt1browser", displayName: "Browser User" } });
});

test(tag("HTTP-AC-006", "api throws ApiError with the server's code on an error response"), async ({ page }) => {
  await openClientPage(page);
  const notFound = await callApi(page, "/does-not-exist");
  expect(notFound).toMatchObject({ threw: true, isApiError: true, code: "HTTP.NOT_FOUND", status: 404 });
  expect(typeof notFound.requestId).toBe("string");
  expect(notFound.requestId).not.toBe("");

  const internal = await callApi(page, "/throw/plain");
  expect(internal).toMatchObject({ threw: true, isApiError: true, code: "CORE.INTERNAL", status: 500 });
  expect(typeof internal.requestId).toBe("string");
});

test(tag("HTTP-AC-006", "api throws HTTP.NETWORK_ERROR when the API is unreachable"), async ({ page }) => {
  await openClientPage(page);
  await page.route(`${dev.baseUrl}/api/**`, (route) => route.abort("connectionrefused"));
  const res = await callApi(page, "/whoami");
  expect(res).toMatchObject({ threw: true, isApiError: true, code: "HTTP.NETWORK_ERROR", status: null, requestId: null });
});

test(tag("HTTP-AC-006", "a stubbed 502 HTML response throws HTTP.NETWORK_ERROR with that status, null requestId and the not-from-the-app message"), async ({ page }) => {
  await openClientPage(page);
  await page.route(`${dev.baseUrl}/api/**`, (route) =>
    route.fulfill({ status: 502, contentType: "text/html", body: "<html><body><h1>502 Bad Gateway</h1></body></html>" }),
  );
  const res = await callApi(page, "/whoami");
  expect(res).toEqual({
    threw: true,
    isApiError: true,
    code: "HTTP.NETWORK_ERROR",
    status: 502,
    requestId: null,
    message: "response did not come from the app (status 502)",
  });
});

test(tag("HTTP-AC-006", "a non-JSON 200 throws HTTP.NETWORK_ERROR with that status, null requestId and the not-from-the-app message"), async ({ page }) => {
  await openClientPage(page);
  await page.route(`${dev.baseUrl}/api/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>captive portal</body></html>" }),
  );
  const res = await callApi(page, "/whoami");
  expect(res).toEqual({
    threw: true,
    isApiError: true,
    code: "HTTP.NETWORK_ERROR",
    status: 200,
    requestId: null,
    message: "response did not come from the app (status 200)",
  });
});
