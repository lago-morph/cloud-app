/**
 * The in-page clauses of three demo criteria (docs/demo/demo-spec.md §2; Where: Local, cloud),
 * checked in Chromium against the running demo (root cause
 * ai/implementation/root-causes/2026-10-20-F-02-round-3-demo-issues.md, Review, fix item 3):
 *
 * - DEMO-AC-001 "A title containing `<script>` renders as text": a post whose title contains
 *   `<script>…</script>` shows that literal text, to its author and, once published, to an
 *   anonymous visitor in the list and on the post; no `script` element is added and the script
 *   never runs.
 * - DEMO-AC-003 "A 20 MB JPEG uploads, displays …": a JPEG of at least 20 MB attached through
 *   the page displays (an `<img>` is complete with `naturalWidth` > 0, at the photo's size).
 * - DEMO-AC-009 "… the copy button copies it": with clipboard permissions granted, the account
 *   page's copy button puts exactly the `/api/auth/me` user ID on the clipboard.
 *
 * The other clauses of these criteria (pagination, download, per-post maximum, deletion, the ID
 * shown) are evidenced elsewhere (the demo's smoke test); these tests carry the tags for the
 * clauses above only.
 *
 * Selectors (decision fix-f4b): the demo is rebuilt from its specification each round, so the
 * page is driven only through what the specification names (posts with a title and text, a
 * draft the author can attach photos to, publish and delete actions, an account page with a
 * copy button) and the framework's own routes (`/api/auth/mock-login`, `/api/auth/me`), found
 * by role and accessible name with tolerant patterns (the ASSUMED_* constants below). The only
 * structural selector is `input[type="file"]` (a file picker has no required accessible name).
 * No demo API route, element ID or class name is used.
 *
 * Target: `COMPLIANCE_DEMO_BASE_URL` names a running demo (on Cloudflare, the F-03 `test-`
 * stage). When it is unset on `local`, the tests start the demo under `dev` from a copy of
 * `apps/demo` in the git-ignored `.framework/e2e/` (as other E2E specs do with app copies) and
 * stop it afterwards. On a cloud target without it the criteria are recorded `blocked`, never
 * passed. Data: one post per test, deleted afterwards through the page.
 */
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { USER_AGENT, prerequisiteMissing, tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { copyApp, randomSuffix, removeDir } from "./support/apps.js";
import { REPO_ROOT, startDev, type DevServer } from "./support/process.js";

export const DEMO_BASE_URL_ENV = "COMPLIANCE_DEMO_BASE_URL";

/** Accessible names assumed for controls the specification names but does not label (decision fix-f4b). */
const ASSUMED_TITLE_FIELD = /title/i;
const ASSUMED_BODY_FIELD = /text|body|content|message/i;
const ASSUMED_CREATE_BUTTON = /create|new (draft|post)|add (draft|post)|submit|save draft/i;
const ASSUMED_ATTACH_BUTTON = /attach|upload|add photo/i;
const ASSUMED_PUBLISH_BUTTON = /^publish\b/i;
const ASSUMED_DELETE_BUTTON = /delete/i;
const ASSUMED_ACCOUNT_LINK = /account/i;
const ASSUMED_ACCOUNT_HEADING = /account/i;
const ASSUMED_COPY_BUTTON = /copy/i;

const MIB = 1024 * 1024;
/** "A 20 MB JPEG": at least 20 MiB, so it is 20 MB under either reading. */
const MIN_JPEG_BYTES = 20 * MIB;
/** Width and height of the generated photo; random pixels at quality 1 give about 2.8 bytes per pixel. */
const PHOTO_WIDTH = 3600;
const PHOTO_HEIGHT = 2400;

let demoOrigin: string | undefined;
let dev: DevServer | undefined;
let copyDir: string | undefined;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const given = process.env[DEMO_BASE_URL_ENV];
  if (given !== undefined && given !== "") {
    demoOrigin = new URL(given).origin;
    return;
  }
  if (target().target !== "local") return; // each test reports the missing prerequisite
  copyDir = copyApp(`${REPO_ROOT}/apps/demo`, "demo-pages");
  dev = await startDev(copyDir);
  demoOrigin = dev.origin;
});

test.afterAll(async () => {
  test.setTimeout(60_000);
  if (dev !== undefined) await dev.stop();
  if (copyDir !== undefined) removeDir(copyDir);
});

function origin(): string {
  if (demoOrigin === undefined) {
    prerequisiteMissing(`no running demo on ${target().target}: set ${DEMO_BASE_URL_ENV} to the demo's test stage origin (F-03 deploys it)`);
  }
  return demoOrigin;
}

/** A fresh browser context on the demo, logged in through the authentication mock (or anonymous). */
async function session(browser: Browser, level: "anonymous" | "user" | "admin", id?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: origin(), userAgent: USER_AGENT });
  const page = await context.newPage();
  if (level !== "anonymous") {
    // AUTH-REQ-007 (DEC-0516): every POST under /api/auth/ carries Origin equal to the public origin.
    const login = await page.request.post("/api/auth/mock-login", { data: { level, ...(id === undefined ? {} : { id }), displayName: `demo-pages ${level}` }, headers: { origin: origin() } });
    expect(login.status(), "mock login").toBe(204);
  }
  return { context, page };
}

/** Elements whose whole text is exactly `text` (any role). */
function exactText(page: Page, text: string): Locator {
  return page.getByText(text, { exact: true });
}

/**
 * Creates a draft through the page and leaves `page` on that post: fills the title (and the
 * text, when there is a separate text field), presses the create control, then opens the post
 * through a link named by its title unless the app already went to it.
 */
async function createDraftAndOpen(page: Page, title: string): Promise<void> {
  await page.goto("/");
  await page.getByRole("textbox", { name: ASSUMED_TITLE_FIELD }).first().fill(title, { timeout: 30_000 });
  const body = page.getByRole("textbox", { name: ASSUMED_BODY_FIELD });
  if ((await body.count()) > 0) await body.first().fill("Created by the demo-pages compliance spec.");
  const before = page.url();
  await page.getByRole("button", { name: ASSUMED_CREATE_BUTTON }).first().click();
  // The app either goes to the new post or lists it; wait for one of the two.
  await expect.poll(async () => page.url() !== before || (await page.getByRole("link", { name: title, exact: true }).count()) > 0, { timeout: 60_000 }).toBe(true);
  await page.waitForLoadState("load");
  const toPost = page.getByRole("link", { name: title, exact: true });
  if (page.url() === before && (await toPost.count()) > 0) {
    await toPost.first().click();
    await page.waitForLoadState("load");
  }
}

/** Opens the post named `title` from the front page's list. */
async function openFromList(page: Page, title: string): Promise<void> {
  await page.goto("/");
  const toPost = page.getByRole("link", { name: title, exact: true });
  await expect(toPost.first()).toBeVisible({ timeout: 30_000 });
  await toPost.first().click();
  await page.waitForLoadState("load");
}

/** Best-effort cleanup: the post's delete control on its page (confirming any dialog). */
async function deleteThroughPage(page: Page): Promise<void> {
  try {
    page.on("dialog", (dialog) => void dialog.accept());
    const button = page.getByRole("button", { name: ASSUMED_DELETE_BUTTON });
    if ((await button.count()) === 0) return;
    const before = page.url();
    await button.first().click({ timeout: 10_000 });
    await expect.poll(() => page.url(), { timeout: 30_000 }).not.toBe(before);
  } catch {
    // cleanup only
  }
}

/** The page shows `title` as literal text: an element with exactly that text, no element children, no script added or run. */
async function expectTitleAsText(page: Page, title: string, marker: string): Promise<void> {
  const shown = exactText(page, title);
  await expect(shown.first(), "an element shows the literal title").toBeVisible({ timeout: 30_000 });
  for (const node of await shown.all()) {
    expect(await node.evaluate((n) => (n as HTMLElement).innerText.trim()), "the rendered text is the literal title").toBe(title);
    expect(await node.evaluate((n) => n.querySelectorAll("*").length), "the title's element has no child elements").toBe(0);
  }
  expect(await page.evaluate((m) => Array.from(document.querySelectorAll("script")).filter((s) => (s.textContent ?? "").includes(m)).length, marker), "no script element from the title").toBe(0);
  expect(await page.evaluate((m) => (window as unknown as Record<string, unknown>)[m], marker), "the title's script did not run").toBeUndefined();
}

test(tag("DEMO-AC-001", "a post title containing <script>…</script> shows as literal text to its author and, published, to an anonymous visitor in the list and on the post; no script element is added and the script does not run"), async ({ browser }) => {
  test.setTimeout(240_000);
  const suffix = randomSuffix(4);
  const marker = `demoPagesXss${suffix}`;
  const title = `Hello <script>window.${marker}=1</script> ${suffix}`;
  // An admin author: the specification lets an admin create a draft and publish any post.
  const author = await session(browser, "admin", `demo-pages-author-${suffix}`);
  const visitor = await session(browser, "anonymous");
  let created = false;
  try {
    const page = author.page;
    await createDraftAndOpen(page, title);
    created = true;
    await expectTitleAsText(page, title, marker);

    await page.getByRole("button", { name: ASSUMED_PUBLISH_BUTTON }).first().click({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: ASSUMED_PUBLISH_BUTTON }), "published").toHaveCount(0, { timeout: 30_000 });

    // The anonymous visitor: the published list, then the post itself.
    await visitor.page.goto("/");
    await expectTitleAsText(visitor.page, title, marker);
    await openFromList(visitor.page, title);
    await expectTitleAsText(visitor.page, title, marker);
  } finally {
    if (created) {
      await openFromList(author.page, title).catch(() => undefined);
      await deleteThroughPage(author.page);
    }
    await Promise.all([author.context.close(), visitor.context.close()]);
  }
});

/** A baseline JPEG of random pixels encoded by the browser at quality 1, at least MIN_JPEG_BYTES. */
async function makeLargeJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      const image = ctx.createImageData(w, h);
      let s = 20;
      for (let i = 0; i < image.data.length; i += 4) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        image.data[i] = s & 255;
        image.data[i + 1] = (s >>> 8) & 255;
        image.data[i + 2] = (s >>> 16) & 255;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 1 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    [PHOTO_WIDTH, PHOTO_HEIGHT] as const,
  );
  const jpeg = Buffer.from(base64, "base64");
  expect(jpeg.subarray(0, 3).toString("hex"), "JPEG signature").toBe("ffd8ff");
  expect(jpeg.length, "the photo is at least 20 MB").toBeGreaterThanOrEqual(MIN_JPEG_BYTES);
  return jpeg;
}

/** The size of each image on the page that has finished loading ("loading" for one that has not). */
function imageSizes(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.images, (img) => (img.complete ? `${String(img.naturalWidth)}x${String(img.naturalHeight)}` : "loading")));
}

test(tag("DEMO-AC-003", "a JPEG of at least 20 MB attached through the page displays: an image on the post is complete with naturalWidth > 0, at the photo's size"), async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const suffix = randomSuffix(4);
  const title = `Large photo ${suffix}`;
  const author = await session(browser, "user", `demo-pages-photo-${suffix}`);
  let created = false;
  try {
    const page = author.page;
    const jpeg = await makeLargeJpeg(page);
    await createDraftAndOpen(page, title);
    created = true;
    const postUrl = page.url();
    expect(await imageSizes(page), "the post shows no photo before the upload").not.toContain(`${String(PHOTO_WIDTH)}x${String(PHOTO_HEIGHT)}`);

    await page.locator('input[type="file"]').first().setInputFiles({ name: `large-${suffix}.jpg`, mimeType: "image/jpeg", buffer: jpeg });
    const attach = page.getByRole("button", { name: ASSUMED_ATTACH_BUTTON });
    if ((await attach.count()) > 0) await attach.first().click();

    // Displays: an image on the post finishes loading at the photo's own size (naturalWidth > 0).
    const shown = `${String(PHOTO_WIDTH)}x${String(PHOTO_HEIGHT)}`;
    await expect.poll(() => imageSizes(page), { timeout: 10 * 60_000, intervals: [2_000] }).toContain(shown);
    // And again on a fresh load of the post, so it is the stored photo, not a local preview.
    await page.goto(postUrl);
    await expect.poll(() => imageSizes(page), { timeout: 5 * 60_000, intervals: [2_000] }).toContain(shown);
    const widths = await page.evaluate(() => Array.from(document.images, (img) => img.naturalWidth));
    expect(Math.max(0, ...widths), "naturalWidth > 0").toBeGreaterThan(0);
  } finally {
    if (created) await deleteThroughPage(author.page);
    await author.context.close();
  }
});

test(tag("DEMO-AC-009", "with clipboard permissions granted, the account page's copy button puts exactly the /api/auth/me user ID on the clipboard"), async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = randomSuffix(4);
  const user = await session(browser, "user", `demo-pages-copy-${suffix}`);
  try {
    const page = user.page;
    await user.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin() });
    const me = await page.request.get("/api/auth/me");
    expect(me.status()).toBe(200);
    const { id } = (await me.json()) as { id: string };
    expect(id).toBe(`demo-pages-copy-${suffix}`);

    // The account page, reached through the page's own link if it has one; otherwise it is shown on `/`.
    await page.goto("/");
    const accountLink = page.getByRole("link", { name: ASSUMED_ACCOUNT_LINK });
    if ((await accountLink.count()) > 0) {
      await accountLink.first().click();
      await page.waitForLoadState("load");
    }
    await expect(page.getByRole("heading", { name: ASSUMED_ACCOUNT_HEADING }).first()).toBeVisible({ timeout: 30_000 });
    // The account page shows the same ID as /api/auth/me.
    await expect(page.getByText(id, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    const copy = page.getByRole("button", { name: ASSUMED_COPY_BUTTON });
    await expect(copy.first()).toBeVisible({ timeout: 30_000 });
    // Something else on the clipboard first, so only the copy button can put the ID there.
    const sentinel = `not-the-id-${suffix}`;
    await page.evaluate((text) => navigator.clipboard.writeText(text), sentinel);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentinel);

    await copy.first().click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 10_000 }).toBe(id);
  } finally {
    await user.context.close();
  }
});
