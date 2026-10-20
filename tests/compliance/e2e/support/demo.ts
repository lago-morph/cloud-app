/**
 * The demo app (`apps/demo`) for the DEMO-AC compliance specs (demo-criteria.spec.ts,
 * demo-local.spec.ts, E2E-002.spec.ts). Written from docs/demo/demo-spec.md, not from the demo's
 * code: the demo is rebuilt from its specification each round, so nothing here names a demo
 * API route, element ID, class name, configuration key or secret name.
 *
 * - **Where the demo runs.** `COMPLIANCE_DEMO_BASE_URL` names a running demo (on Cloudflare, the
 *   F-03 `test-` stage), as in demo-pages.spec.ts (decision fix-f4b-1). When it is unset on
 *   `local`, `startLocalDemo` copies `apps/demo` to the git-ignored `.framework/e2e/`, sets every
 *   secret the app declares to a random value with `secrets set` (values on standard input only),
 *   optionally writes configuration values, and starts `dev`. On a cloud target without it the
 *   criteria are recorded `blocked` (`prerequisiteMissing`), never passed.
 * - **What the app declares** (its secret names and configuration keys) is read from the app's
 *   own definition (`apps/demo/src/app.ts`, `definition.secrets` / `definition.config`, the
 *   core.d.ts contract), never assumed.
 * - **Demo routes are discovered, not assumed.** A `Recorder` records the API requests the
 *   page itself sends while a person uses it (method, path, body, status, JSON response). The
 *   specs replay them as other identities to check refusals, and in-process (`createTestApp`)
 *   for the clauses that need the stub login provider or a shifted clock. Values that differ
 *   between the recorded run and a replay (a new post's ID, a new share token) are carried over
 *   by matching the JSON paths of the two responses (`learn`, `substitute`).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { APIRequestContext, Browser, BrowserContext, Locator, Page, Request } from "@playwright/test";
import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { USER_AGENT, prerequisiteMissing, target } from "../../harness/index.js";
import { expect } from "../../harness/playwright.js";
import { copyApp, randomSuffix, removeDir, setSecret } from "./apps.js";
import { REPO_ROOT, startDev, type DevServer } from "./process.js";

export const DEMO_BASE_URL_ENV = "COMPLIANCE_DEMO_BASE_URL";
export const DEMO_DIR = join(REPO_ROOT, "apps", "demo");

/**
 * Accessible names assumed for controls the specification requires but does not label
 * (decision fix-f4b-2 names the first ones; the rest follow the same rule).
 */
export const ASSUMED = {
  titleField: /title/i,
  bodyField: /text|body|content|message/i,
  createButton: /create|new (draft|post)|add (draft|post)|submit|save draft/i,
  saveButton: /^(save|update)\b|save (changes|draft|post)/i,
  publishButton: /^publish\b/i,
  unpublishButton: /^unpublish\b/i,
  deleteButton: /delete/i,
  shareButton: /share/i,
  setBannerButton: /(set|save|update).*banner|^banner/i,
  bannerField: /banner/i,
  logoutButton: /log ?out|sign ?out/i,
  pageSizeControl: /per page|page size/i,
} as const;

// ---------------------------------------------------------------------------------------------
// The app's own declarations

interface DemoDefinition {
  readonly name: string;
  readonly config: Record<string, unknown>;
  readonly secrets: readonly string[];
}
type DefinedDemo = Parameters<typeof createTestApp>[0];

let loaded: DefinedDemo | undefined;

/** The demo's `app` export (core.d.ts `DefinedApp`), imported once. */
export async function demoApp(): Promise<DefinedDemo> {
  if (loaded === undefined) {
    const mod = (await import(pathToFileURL(join(DEMO_DIR, "src", "app.ts")).href)) as { app?: DefinedDemo; default?: DefinedDemo };
    const app = mod.app ?? mod.default;
    if (app === undefined) throw new Error("apps/demo/src/app.ts exports no app");
    loaded = app;
  }
  return loaded;
}

export async function demoDefinition(): Promise<DemoDefinition> {
  return (await demoApp()).definition as unknown as DemoDefinition;
}

/**
 * The one declared configuration key whose name matches `pattern` (e.g. the site title or the
 * share-link lifetime, which DEMO-REQ-006 says come from configuration but does not name).
 */
export async function configKey(pattern: RegExp, what: string): Promise<string> {
  const keys = Object.keys((await demoDefinition()).config).filter((k) => pattern.test(k));
  expect(keys, `exactly one declared configuration key for ${what} (keys matching ${String(pattern)})`).toHaveLength(1);
  return keys[0] ?? "";
}

/** A random value for every secret the demo declares. */
export async function randomSecrets(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of (await demoDefinition()).secrets) out[name] = `demo-${randomSuffix(16)}`;
  return out;
}

/** A fresh in-process demo (`createTestApp`: one build, fresh storage), with every declared secret set. */
export async function demoTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const app = await demoApp();
  const secrets = { ...(await randomSecrets()), ...(options.secrets ?? {}) };
  const cwd = process.cwd();
  process.chdir(DEMO_DIR);
  try {
    return await createTestApp(app, { ...options, secrets });
  } finally {
    process.chdir(cwd);
  }
}

// ---------------------------------------------------------------------------------------------
// A running demo

export interface RunningDemo {
  readonly origin: string;
  /** The app copy's directory (local `dev` only). */
  readonly dir?: string;
  stop(): Promise<void>;
}

/** Copies the demo, sets its declared secrets, writes `values` into `config/local.json`, and starts `dev`. */
export async function startLocalDemo(label: string, values: Record<string, unknown> = {}): Promise<RunningDemo> {
  const dir = copyApp(DEMO_DIR, label);
  try {
    for (const [name, value] of Object.entries(await randomSecrets())) await setSecret(dir, "local", "local", name, value);
    if (Object.keys(values).length > 0) writeLocalValues(dir, values);
    const dev: DevServer = await startDev(dir);
    return {
      origin: dev.origin,
      dir,
      stop: async () => {
        await dev.stop();
        removeDir(dir);
      },
    };
  } catch (error) {
    removeDir(dir);
    throw error;
  }
}

/** Replaces the copy's `config/local.json` values (stage-config.schema.json: `values`, `framework`). */
export function writeLocalValues(dir: string, values: Record<string, unknown>): void {
  writeFileSync(join(dir, "config", "local.json"), `${JSON.stringify({ values, framework: {} }, null, 2)}\n`);
}

/** The demo this spec file uses: `COMPLIANCE_DEMO_BASE_URL`, else (local only) a fresh `dev` copy. */
export async function demoForThisRun(label: string): Promise<RunningDemo | undefined> {
  const given = process.env[DEMO_BASE_URL_ENV];
  if (given !== undefined && given !== "") return { origin: new URL(given).origin, stop: () => Promise.resolve() };
  if (target().target !== "local") return undefined;
  return startLocalDemo(label);
}

export function requireDemo(demo: RunningDemo | undefined): RunningDemo {
  if (demo === undefined) prerequisiteMissing(`no running demo on ${target().target}: set ${DEMO_BASE_URL_ENV} to the demo's test stage origin (F-03 deploys it)`);
  return demo;
}

// ---------------------------------------------------------------------------------------------
// Sessions and page actions

export interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly origin: string;
}

/** Logs `request` in through the authentication mock (framework route, test stages and local only). */
export async function mockLogin(request: APIRequestContext, origin: string, level: "user" | "admin", id: string): Promise<void> {
  const login = await request.post(`${origin}/api/auth/mock-login`, { data: { level, id, displayName: `demo ${level} ${id}` }, headers: { origin } });
  expect(login.status(), `mock login as ${level} ${id}`).toBe(204);
}

/** A fresh browser context on the demo, logged in through the authentication mock, or anonymous. */
export async function session(browser: Browser, origin: string, level: "anonymous" | "user" | "admin", id?: string): Promise<Session> {
  const context = await browser.newContext({ baseURL: origin, userAgent: USER_AGENT });
  const page = await context.newPage();
  if (level !== "anonymous") await mockLogin(page.request, origin, level, id ?? `demo-${level}-${randomSuffix(4)}`);
  return { context, page, origin };
}

/** The current user as `/api/auth/me` reports it. */
export async function me(request: APIRequestContext, origin: string): Promise<{ level: string; id?: string }> {
  const response = await request.get(`${origin}/api/auth/me`);
  expect(response.status(), "/api/auth/me").toBe(200);
  return (await response.json()) as { level: string; id?: string };
}

/** Every element on the page whose whole text is exactly `text`. */
export function exactText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true });
}

export async function expectShown(page: Page, text: string, what: string): Promise<void> {
  await expect(exactText(page, text).first(), what).toBeVisible({ timeout: 30_000 });
}

/** `text` is not shown once the page has settled (its API calls finished). */
export async function expectNotShown(page: Page, text: string, what: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await expect(exactText(page, text), what).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Creates a draft through the page (title, and text when there is a separate text field) and
 * leaves `page` on that post; returns the post page's URL. As in demo-pages.spec.ts.
 */
export async function createDraftAndOpen(page: Page, title: string, text = "Created by a demo compliance spec."): Promise<string> {
  await page.goto("/");
  await page.getByRole("textbox", { name: ASSUMED.titleField }).first().fill(title, { timeout: 30_000 });
  const body = page.getByRole("textbox", { name: ASSUMED.bodyField });
  if ((await body.count()) > 0) await body.first().fill(text);
  const before = page.url();
  await page.getByRole("button", { name: ASSUMED.createButton }).first().click();
  await expect.poll(async () => page.url() !== before || (await page.getByRole("link", { name: title, exact: true }).count()) > 0, { timeout: 60_000 }).toBe(true);
  await page.waitForLoadState("load");
  const toPost = page.getByRole("link", { name: title, exact: true });
  if (page.url() === before && (await toPost.count()) > 0) {
    await toPost.first().click();
    await page.waitForLoadState("load");
  }
  await expectShown(page, title, "the new draft's page shows its title");
  return page.url();
}

/** Opens `url` and waits until the page's API calls have finished. */
export async function openSettled(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Selects the published-post link named `title` on the front page, if listed. */
export function listLink(page: Page, title: string): Locator {
  return page.getByRole("link", { name: title, exact: true });
}

// ---------------------------------------------------------------------------------------------
// Recording the page's own API requests, and replaying them

export interface Recorded {
  readonly method: string;
  /** Path and query on the app's origin. */
  readonly path: string;
  readonly body?: string;
  readonly contentType?: string;
  readonly status: number;
  /** The response body as text (JSON responses only; empty otherwise). */
  readonly response: string;
}

function isAppApi(origin: string, request: Request): boolean {
  const url = new URL(request.url());
  return url.origin === origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/") && !url.pathname.startsWith("/api/__framework/");
}

/**
 * Records the app API requests (outside `/api/auth/*`) a page sends, with their responses. The
 * requests pass through `page.route` and `route.fetch()`, so a response body is kept even when the
 * page navigates away as soon as it arrives (a create that opens the new post).
 */
export class Recorder {
  private readonly done: Recorded[] = [];
  private readonly pattern: string;
  /** App API requests sent so far, how many of them were state-changing, and how many are still open. */
  sent = 0;
  mutationsSent = 0;
  private open = 0;

  private constructor(
    private readonly page: Page,
    origin: string,
  ) {
    this.pattern = `${origin}/api/**`;
  }

  static async start(page: Page, origin: string): Promise<Recorder> {
    const recorder = new Recorder(page, origin);
    await page.route(recorder.pattern, async (route) => {
      const request = route.request();
      if (!isAppApi(origin, request)) {
        await route.fallback();
        return;
      }
      recorder.sent += 1;
      if (request.method() !== "GET" && request.method() !== "HEAD") recorder.mutationsSent += 1;
      recorder.open += 1;
      const url = new URL(request.url());
      const body = request.postData() ?? undefined;
      const contentType = request.headers()["content-type"];
      const base = { method: request.method(), path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }), ...(contentType === undefined ? {} : { contentType }) };
      try {
        const response = await route.fetch();
        const text = await response.text();
        recorder.done.push({ ...base, status: response.status(), response: (response.headers()["content-type"] ?? "").includes("json") ? text : "" });
        await route.fulfill({ response, body: text }).catch(() => undefined);
      } catch {
        recorder.done.push({ ...base, status: 0, response: "" });
        await route.abort().catch(() => undefined);
      } finally {
        recorder.open -= 1;
      }
    });
    return recorder;
  }

  /**
   * Stops recording once every request sent has finished and the page has been quiet for a
   * moment (a click's API call starts asynchronously, after the click returns), and returns what
   * was recorded, in the order the responses arrived.
   */
  async stop(): Promise<Recorded[]> {
    let last = -1;
    await expect
      .poll(
        async () => {
          await this.page.waitForLoadState("load").catch(() => undefined);
          const quiet = this.open === 0 && last === this.sent;
          last = this.sent;
          return quiet;
        },
        { timeout: 60_000, intervals: [500] },
      )
      .toBe(true);
    await this.page.unroute(this.pattern);
    return [...this.done];
  }
}

/**
 * Records the app API requests sent while `action` runs (and the page settles). With
 * `mutation`, first waits until the page has sent a state-changing request.
 */
export async function record(page: Page, origin: string, action: () => Promise<void>, options: { readonly mutation?: boolean } = {}): Promise<Recorded[]> {
  const recorder = await Recorder.start(page, origin);
  await action();
  if (options.mutation === true) await expect.poll(() => recorder.mutationsSent, { message: "the page sends a state-changing API request", timeout: 30_000 }).toBeGreaterThan(0);
  return recorder.stop();
}

/** The one state-changing request among `recorded`, which must have succeeded. */
export function theMutation(recorded: readonly Recorded[], what: string): Recorded {
  const mutations = recorded.filter((r) => r.method !== "GET" && r.method !== "HEAD");
  expect(
    mutations.map((m) => `${m.method} ${m.path} ${String(m.status)}`),
    `${what}: the page sent exactly one state-changing API request`,
  ).toHaveLength(1);
  const mutation = mutations[0] as Recorded;
  expect(mutation.status, `${what}: ${mutation.method} ${mutation.path} succeeded`).toBeGreaterThanOrEqual(200);
  expect(mutation.status, `${what}: ${mutation.method} ${mutation.path} succeeded`).toBeLessThan(300);
  return mutation;
}

/**
 * Captures the request a page action would send, without letting it reach the app: the first
 * state-changing app API request is aborted and returned. Used to learn the shape of an action
 * (e.g. deleting a draft) before checking that other identities are refused it.
 */
export async function capture(page: Page, origin: string, action: () => Promise<void>, what: string): Promise<Recorded> {
  let captured: Recorded | undefined;
  const pattern = `${origin}/api/**`;
  await page.route(pattern, async (route) => {
    const request = route.request();
    if (captured === undefined && request.method() !== "GET" && request.method() !== "HEAD" && isAppApi(origin, request)) {
      const url = new URL(request.url());
      const body = request.postData() ?? undefined;
      const contentType = request.headers()["content-type"];
      captured = { method: request.method(), path: `${url.pathname}${url.search}`, ...(body === undefined ? {} : { body }), ...(contentType === undefined ? {} : { contentType }), status: 0, response: "" };
      await route.abort();
      return;
    }
    await route.continue();
  });
  try {
    await action();
    await expect.poll(() => captured !== undefined, { message: `${what}: the page sends a state-changing API request`, timeout: 30_000 }).toBe(true);
  } finally {
    await page.unroute(pattern);
  }
  return captured as Recorded;
}

/** Old → new values carried from a recorded run into a replay. */
export type Substitutions = Map<string, string>;

/** Adds every scalar leaf that differs between two responses of the same shape (≥ 4 characters). */
export function learn(substitutions: Substitutions, recordedResponse: string, replayedResponse: string): void {
  let a: unknown;
  let b: unknown;
  try {
    a = JSON.parse(recordedResponse);
    b = JSON.parse(replayedResponse);
  } catch {
    return;
  }
  const walk = (x: unknown, y: unknown): void => {
    if ((typeof x === "string" || typeof x === "number") && (typeof y === "string" || typeof y === "number")) {
      const from = String(x);
      const to = String(y);
      if (from !== to && from.length >= 4) substitutions.set(from, to);
      // A link (e.g. a share link) also carries its parts: map each differing path segment or query value.
      const pa = from.split(/[/?&=#]/);
      const pb = to.split(/[/?&=#]/);
      if (pa.length > 1 && pa.length === pb.length) {
        pa.forEach((part, i) => {
          const other = pb[i] ?? part;
          if (part !== other && part.length >= 4) substitutions.set(decodeURIComponent(part), decodeURIComponent(other));
        });
      }
      return;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      x.forEach((v, i) => walk(v, y[i]));
      return;
    }
    if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
      for (const [k, v] of Object.entries(x)) walk(v, (y as Record<string, unknown>)[k]);
    }
  };
  walk(a, b);
}

function replaceAll(text: string, substitutions: Substitutions): string {
  let out = text;
  // Longest first: a token may contain a shorter learned value (such as the post ID).
  for (const [from, to] of [...substitutions].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(from).join(to);
    const encFrom = encodeURIComponent(from);
    if (encFrom !== from) out = out.split(encFrom).join(encodeURIComponent(to));
  }
  return out;
}

/** `recorded` with every learned value replaced in its path and body. */
export function substitute(recorded: Recorded, substitutions: Substitutions): Recorded {
  return { ...recorded, path: replaceAll(recorded.path, substitutions), ...(recorded.body === undefined ? {} : { body: replaceAll(recorded.body, substitutions) }) };
}

export interface Replayed {
  readonly status: number;
  readonly text: string;
}

/** Sends a recorded request again through a browser context's cookies (the identity of that session). */
export async function replay(request: APIRequestContext, origin: string, recorded: Recorded): Promise<Replayed> {
  const headers: Record<string, string> = { origin };
  if (recorded.contentType !== undefined) headers["content-type"] = recorded.contentType;
  const response = await request.fetch(`${origin}${recorded.path}`, { method: recorded.method, headers, ...(recorded.body === undefined ? {} : { data: recorded.body }), maxRedirects: 0 });
  return { status: response.status(), text: await response.text() };
}

/** Sends a recorded request to an in-process test app. */
export async function replayInProcess(app: TestApp, recorded: Recorded): Promise<Replayed> {
  const headers: Record<string, string> = {};
  if (recorded.contentType !== undefined) headers["content-type"] = recorded.contentType;
  const response = await app.request(recorded.path, { method: recorded.method, headers, ...(recorded.body === undefined ? {} : { body: recorded.body }) });
  return { status: response.status, text: await response.text() };
}

/** "Refused": the app answers 401, 403 or 404 (an `ErrorResponse`), never a 2xx. */
export const REFUSED = [401, 403, 404];

export function expectRefused(result: Replayed, what: string): void {
  expect(REFUSED, `${what} is refused (got ${String(result.status)}: ${result.text.slice(0, 300)})`).toContain(result.status);
}

export function expectAllowed(result: Replayed, what: string): void {
  expect(result.status, `${what} is allowed (got ${String(result.status)}: ${result.text.slice(0, 300)})`).toBeGreaterThanOrEqual(200);
  expect(result.status, `${what} is allowed (got ${String(result.status)}: ${result.text.slice(0, 300)})`).toBeLessThan(300);
}

/** The responses of recorded GET requests, replayed, joined (to check what an identity can see). */
export async function visibleThrough(send: (r: Recorded) => Promise<Replayed>, gets: readonly Recorded[]): Promise<string> {
  const parts: string[] = [];
  for (const get of gets.filter((r) => r.method === "GET")) parts.push((await send(get)).text);
  return parts.join("\n");
}
