/**
 * Demo criteria DEMO-AC-002, -004, -005, -007, -008 and -011 (docs/demo/demo-spec.md §2),
 * checked against the running demo in Chromium, and in-process (`createTestApp`) for the clauses
 * the specification gives to local tests: the expiry clause of DEMO-AC-007 (with a shifted
 * clock, the stand-in for the test runner's fake timers) and DEMO-AC-011 (the stub login
 * provider).
 *
 * Written from the specification, not from the demo's code (tests/compliance/e2e/support/demo.ts
 * says how): the page is driven by role and accessible name (support `ASSUMED`), identities come
 * from the framework's authentication mock, and the demo's API routes are never named. They are
 * learned at run time by recording the requests the page itself sends, then replayed as other
 * identities to check that forbidden actions are refused, and in-process for the local-only
 * clauses. "Refused" is 401, 403 or 404 (`REFUSED`); DEMO-AC-011 names 401 exactly.
 *
 * Target: `COMPLIANCE_DEMO_BASE_URL`, else on `local` a fresh `dev` copy of `apps/demo` (as
 * demo-pages.spec.ts, decision fix-f4b-1); on a cloud target without it every test reports a
 * missing prerequisite (`blocked`). DEMO-AC-008's cloud part reads the stage's entries in the
 * shared log bucket and also needs `COMPLIANCE_DEMO_STAGE` (the demo stage's name); it is meant
 * for F-03 and was not run here (no Cloudflare calls in this item). On a shared cloud stage, run
 * this file alone (`--workers=1`), since DEMO-AC-008 attributes log entries by time window.
 *
 * Data: a handful of posts per test, each deleted through the page or by the admin afterwards.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mockUsers, type TestApp } from "@lago-morph/prototype-framework/testing";
import type { Locator, Page } from "@playwright/test";
import { prerequisiteMissing, tag, target } from "../harness/index.js";
import { expect, test } from "../harness/playwright.js";
import { randomSuffix } from "./support/apps.js";
import { cloudLogEntries, utcDay } from "./support/cloud.js";
import { REPO_ROOT } from "./support/process.js";
import {
  ASSUMED,
  capture,
  configKey,
  createDraftAndOpen,
  demoDefinition,
  demoForThisRun,
  demoTestApp,
  expectAllowed,
  expectNotShown,
  expectRefused,
  expectShown,
  learn,
  listLink,
  me,
  mockLogin,
  openSettled,
  record,
  replay,
  replayInProcess,
  requireDemo,
  session,
  substitute,
  theMutation,
  visibleThrough,
  type Recorded,
  type RunningDemo,
  type Session,
  type Substitutions,
} from "./support/demo.js";

export const DEMO_STAGE_ENV = "COMPLIANCE_DEMO_STAGE";

let demo: RunningDemo | undefined;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  demo = await demoForThisRun("demo-criteria");
});

test.afterAll(async () => {
  test.setTimeout(60_000);
  if (demo !== undefined) await demo.stop();
});

function origin(): string {
  return requireDemo(demo).origin;
}

const local = (): boolean => target().target === "local";

/** `recorded` with `from` replaced by `to` in its path and body (e.g. a title in a create request). */
function withText(recorded: Recorded, from: string, to: string): Recorded {
  return substitute(recorded, new Map([[from, to]]));
}

/** The textbox currently holding `value` (an edit form shows the draft's current title). */
async function fieldWithValue(page: Page, value: string): Promise<Locator> {
  const boxes = page.getByRole("textbox");
  await expect.poll(async () => (await boxes.all()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  for (const box of await boxes.all()) {
    if ((await box.inputValue().catch(() => "")) === value) return box;
  }
  throw new Error(`no text field on ${page.url()} holds ${JSON.stringify(value)} (the draft's edit form)`);
}

/** Edits the draft on `page` from `title` to `next` through its edit form, and returns the request the page sent. */
async function editTitle(s: Session, title: string, next: string): Promise<Recorded> {
  const field = await fieldWithValue(s.page, title);
  const rec = await record(s.page, s.origin, async () => {
    await field.fill(next);
    await s.page.getByRole("button", { name: ASSUMED.saveButton }).first().click();
  }, { mutation: true });
  return theMutation(rec, "saving the edited draft");
}

/** Clicks the control named `name` on `page` and returns the one state-changing request the page sent. */
async function act(s: Session, name: RegExp, what: string): Promise<Recorded> {
  s.page.once("dialog", (dialog) => void dialog.accept());
  const rec = await record(s.page, s.origin, async () => {
    await s.page.getByRole("button", { name }).first().click({ timeout: 30_000 });
  }, { mutation: true });
  return theMutation(rec, what);
}

/** The GET requests the post page at `url` sends whose response carries `title` (the post's data). */
async function postDataRequests(s: Session, url: string, title: string): Promise<Recorded[]> {
  const rec = await record(s.page, s.origin, () => openSettled(s.page, url));
  const gets = rec.filter((r) => r.method === "GET" && r.status === 200 && r.response.includes(title));
  expect(gets.length, `opening ${url} reads the post through the API`).toBeGreaterThan(0);
  return gets;
}

/** Whether the front page, as `s` sees it, lists a post titled `title`. */
async function listed(s: Session, title: string): Promise<boolean> {
  await openSettled(s.page, "/");
  return (await listLink(s.page, title).count()) > 0;
}

async function closeAll(...sessions: (Session | undefined)[]): Promise<void> {
  await Promise.all(sessions.map((s) => s?.context.close()));
}

// ---------------------------------------------------------------------------------------------

test(tag("DEMO-AC-002", "each cell of the permissions table with mock identities (anonymous, user, another user, admin): permitted actions succeed through the page, forbidden ones are refused by the app and change nothing"), async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const o = origin();
  const sfx = randomSuffix(4);
  const admin = await session(browser, o, "admin", `demo-ac002-admin-${sfx}`);
  const user = await session(browser, o, "user", `demo-ac002-user-${sfx}`);
  const other = await session(browser, o, "user", `demo-ac002-other-${sfx}`);
  const anon = await session(browser, o, "anonymous");
  const tUser = `AC002 user draft ${sfx}`;
  const tUserEdited = `AC002 user edited ${sfx}`;
  const tAdmin = `AC002 admin draft ${sfx}`;
  const tAdminEdited = `AC002 admin edited ${sfx}`;
  const tDel = `AC002 user to delete ${sfx}`;
  const cleanup: string[] = [];
  try {
    // --- Create a draft: user yes, admin yes, anonymous refused.
    const createUserRec = await record(user.page, o, async () => {
      cleanup.push(await createDraftAndOpen(user.page, tUser));
    });
    const createUser = theMutation(createUserRec, "a user creates a draft");
    const userPost = user.page.url();
    expectRefused(await replay(anon.page.request, o, withText(createUser, tUser, `AC002 anonymous ${sfx}`)), "anonymous: create a draft");

    // --- View own drafts: the user sees it; anonymous and another user are refused, and it is not listed.
    const userPostData = await postDataRequests(user, userPost, tUser);
    for (const get of userPostData) {
      expectRefused(await replay(anon.page.request, o, get), `anonymous: view a user's draft (${get.path})`);
      expectRefused(await replay(other.page.request, o, get), `another user: view a user's draft (${get.path})`);
    }
    await openSettled(other.page, userPost);
    await expectNotShown(other.page, tUser, "another user's page does not show the draft");
    expect(await listed(anon, tUser), "a draft is not listed for anonymous visitors").toBe(false);

    // --- Edit own drafts: the user edits; anonymous and another user are refused.
    await openSettled(user.page, userPost);
    const editUser = await editTitle(user, tUser, tUserEdited);
    await openSettled(user.page, userPost);
    await expectShown(user.page, tUserEdited, "the user's edit is saved");
    const forged = `AC002 forged ${sfx}`;
    expectRefused(await replay(anon.page.request, o, withText(editUser, tUserEdited, forged)), "anonymous: edit a user's draft");
    expectRefused(await replay(other.page.request, o, withText(editUser, tUserEdited, forged)), "another user: edit a user's draft");
    await openSettled(user.page, userPost);
    await expectShown(user.page, tUserEdited, "refused edits changed nothing");
    await expectNotShown(user.page, forged, "refused edits changed nothing");

    // --- The admin: creates, views and edits an own draft, then publishes it.
    const createAdminRec = await record(admin.page, o, async () => {
      cleanup.push(await createDraftAndOpen(admin.page, tAdmin));
    });
    const createAdmin = theMutation(createAdminRec, "an admin creates a draft");
    const adminPost = admin.page.url();
    await editTitle(admin, tAdmin, tAdminEdited);
    await openSettled(admin.page, adminPost);
    await expectShown(admin.page, tAdminEdited, "the admin's edit of an own draft is saved");
    const publishAdmin = await act(admin, ASSUMED.publishButton, "an admin publishes a post");
    // The admin's post → the user's post: values that differ between the two create responses (the post ID).
    const toUserPost: Substitutions = new Map();
    learn(toUserPost, createAdmin.response, createUser.response);
    expect(toUserPost.size, "the two create responses identify two different posts").toBeGreaterThan(0);
    const publishUserPost = substitute(publishAdmin, toUserPost);

    // --- View published posts: anonymous, user and admin all see the published post.
    for (const [who, s] of [["anonymous", anon], ["user", user], ["another user", other], ["admin", admin]] as const) {
      expect(await listed(s, tAdminEdited), `${who} sees the published post in the list`).toBe(true);
      await listLink(s.page, tAdminEdited).first().click();
      await expectShown(s.page, tAdminEdited, `${who} opens the published post`);
    }

    // --- Publish any post: admin only. The user may not publish even an own draft.
    expectRefused(await replay(user.page.request, o, publishUserPost), "user: publish an own draft");
    expectRefused(await replay(other.page.request, o, publishUserPost), "another user: publish a user's draft");
    expectRefused(await replay(anon.page.request, o, publishUserPost), "anonymous: publish a draft");
    expect(await listed(anon, tUserEdited), "refused publishes changed nothing").toBe(false);
    expectAllowed(await replay(admin.page.request, o, publishUserPost), "admin: publish another user's draft");
    expect(await listed(anon, tUserEdited), "the admin published the user's post").toBe(true);

    // --- Unpublish any post: admin only.
    await openSettled(admin.page, adminPost);
    const unpublishAdmin = await act(admin, ASSUMED.unpublishButton, "an admin unpublishes a post");
    expect(await listed(anon, tAdminEdited), "the admin unpublished the post").toBe(false);
    const unpublishUserPost = substitute(unpublishAdmin, toUserPost);
    expectRefused(await replay(user.page.request, o, unpublishUserPost), "user: unpublish an own published post");
    expectRefused(await replay(anon.page.request, o, unpublishUserPost), "anonymous: unpublish a post");
    expect(await listed(anon, tUserEdited), "refused unpublishes changed nothing").toBe(true);
    expectAllowed(await replay(admin.page.request, o, unpublishUserPost), "admin: unpublish another user's post");
    expect(await listed(anon, tUserEdited), "the admin unpublished the user's post").toBe(false);
    expectAllowed(await replay(admin.page.request, o, publishUserPost), "admin: publish it again");
    expectAllowed(await replay(admin.page.request, o, publishAdmin), "admin: publish the own post again");

    // --- Delete own drafts (user) and delete any post (admin).
    const createDelRec = await record(user.page, o, async () => {
      cleanup.push(await createDraftAndOpen(user.page, tDel));
    });
    const createDel = theMutation(createDelRec, "a user creates a second draft");
    const delPost = user.page.url();
    const deleteDelShape = await capture(user.page, o, () => user.page.getByRole("button", { name: ASSUMED.deleteButton }).first().click({ timeout: 30_000 }), "deleting an own draft");
    expectRefused(await replay(anon.page.request, o, deleteDelShape), "anonymous: delete a user's draft");
    expectRefused(await replay(other.page.request, o, deleteDelShape), "another user: delete a user's draft");
    await openSettled(user.page, delPost);
    await expectShown(user.page, tDel, "refused deletes changed nothing");
    const toFromDel: Substitutions = new Map();
    learn(toFromDel, createDel.response, createUser.response);
    expectRefused(await replay(user.page.request, o, substitute(deleteDelShape, toFromDel)), "user: delete an own post once published");
    const toFromDelToAdmin: Substitutions = new Map();
    learn(toFromDelToAdmin, createDel.response, createAdmin.response);
    expectRefused(await replay(user.page.request, o, substitute(deleteDelShape, toFromDelToAdmin)), "user: delete an admin's published post");
    expect(await listed(anon, tUserEdited), "refused deletes changed nothing").toBe(true);
    expect(await listed(anon, tAdminEdited), "refused deletes changed nothing").toBe(true);
    await openSettled(user.page, delPost);
    await act(user, ASSUMED.deleteButton, "a user deletes an own draft");
    for (const get of userPostData.map((g) => substitute(g, invert(toFromDel)))) {
      const after = await replay(user.page.request, o, get);
      expect(after.text.includes(tDel), "the deleted draft is gone").toBe(false);
    }
    expectAllowed(await replay(admin.page.request, o, substitute(deleteDelShape, toFromDel)), "admin: delete another user's published post");
    expect(await listed(anon, tUserEdited), "the admin deleted the user's post").toBe(false);
    // Admin: delete an own draft (unpublish the own post first, then delete it through the page).
    expectAllowed(await replay(admin.page.request, o, unpublishAdmin), "admin: unpublish the own post");
    await openSettled(admin.page, adminPost);
    await act(admin, ASSUMED.deleteButton, "an admin deletes an own draft");
    expect(await listed(anon, tAdminEdited), "deleted").toBe(false);
    cleanup.length = 0;

    // --- Set the site banner: admin only.
    const banner = `AC002 banner ${sfx}`;
    const setBanner = await setBannerThroughPage(admin, banner);
    await openSettled(anon.page, "/");
    await expectShown(anon.page, banner, "the admin's banner is shown");
    const forgedBanner = `AC002 forged banner ${sfx}`;
    expectRefused(await replay(user.page.request, o, withText(setBanner, banner, forgedBanner)), "user: set the site banner");
    expectRefused(await replay(anon.page.request, o, withText(setBanner, banner, forgedBanner)), "anonymous: set the site banner");
    await openSettled(anon.page, "/");
    await expectShown(anon.page, banner, "refused banner changes changed nothing");
    await expectNotShown(anon.page, forgedBanner, "refused banner changes changed nothing");
    await clearBanner(admin);
  } finally {
    for (const url of cleanup) await deleteAsAdmin(admin, url);
    await closeAll(admin, user, other, anon);
  }
});

function invert(map: Substitutions): Substitutions {
  return new Map(Array.from(map, ([a, b]) => [b, a]));
}

/** Best-effort cleanup: the admin opens the post and presses its delete control. */
async function deleteAsAdmin(admin: Session, url: string): Promise<void> {
  try {
    admin.page.once("dialog", (d) => void d.accept());
    await openSettled(admin.page, url);
    const button = admin.page.getByRole("button", { name: ASSUMED.deleteButton });
    if ((await button.count()) > 0) await button.first().click({ timeout: 10_000 });
    await admin.page.waitForLoadState("networkidle").catch(() => undefined);
  } catch {
    // cleanup only
  }
}

/** The banner's text field: named for the banner, else the text field just before the set-banner button. */
async function bannerField(page: Page): Promise<Locator> {
  const named = page.getByRole("textbox", { name: ASSUMED.bannerField });
  if ((await named.count()) > 0) return named.first();
  return page.getByRole("button", { name: ASSUMED.setBannerButton }).first().locator("xpath=preceding::*[self::input[not(@type) or @type='text'] or self::textarea][1]");
}

/** The admin sets the banner through the page; returns the request the page sent. */
async function setBannerThroughPage(admin: Session, text: string): Promise<Recorded> {
  await openSettled(admin.page, "/");
  const field = await bannerField(admin.page);
  await field.fill(text, { timeout: 30_000 });
  const rec = await record(admin.page, admin.origin, () => admin.page.getByRole("button", { name: ASSUMED.setBannerButton }).first().click(), { mutation: true });
  return theMutation(rec, "the admin sets the banner");
}

/** Best-effort cleanup: the admin clears the banner (a clear control, else an empty banner). */
async function clearBanner(admin: Session): Promise<void> {
  try {
    await openSettled(admin.page, "/");
    const clear = admin.page.getByRole("button", { name: /clear.*banner|remove.*banner/i });
    if ((await clear.count()) > 0) {
      await clear.first().click({ timeout: 10_000 });
    } else {
      await (await bannerField(admin.page)).fill("");
      await admin.page.getByRole("button", { name: ASSUMED.setBannerButton }).first().click({ timeout: 10_000 });
    }
    await admin.page.waitForLoadState("networkidle").catch(() => undefined);
  } catch {
    // cleanup only
  }
}

// ---------------------------------------------------------------------------------------------

test(tag("DEMO-AC-004", "a banner an admin sets through the page appears at the top of the page for anonymous visitors; a user's attempt to set it is refused and changes nothing"), async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const o = origin();
  const sfx = randomSuffix(4);
  const admin = await session(browser, o, "admin", `demo-ac004-admin-${sfx}`);
  const user = await session(browser, o, "user", `demo-ac004-user-${sfx}`);
  const anon = await session(browser, o, "anonymous");
  const banner = `AC004 banner ${sfx}`;
  try {
    await openSettled(anon.page, "/");
    await expectNotShown(anon.page, banner, "no banner before it is set");
    const setBanner = await setBannerThroughPage(admin, banner);

    await openSettled(anon.page, "/");
    await expectShown(anon.page, banner, "an anonymous visitor sees the banner");
    const userView = await session(browser, o, "user", `demo-ac004-viewer-${sfx}`);
    try {
      await openSettled(userView.page, "/");
      await expectShown(userView.page, banner, "the banner is shown for everyone, logged in too");
    } finally {
      await userView.context.close();
    }

    const userBanner = `AC004 user banner ${sfx}`;
    expectRefused(await replay(user.page.request, o, withText(setBanner, banner, userBanner)), "a user setting the banner");
    await openSettled(anon.page, "/");
    await expectShown(anon.page, banner, "the refused attempt changed nothing");
    await expectNotShown(anon.page, userBanner, "the refused attempt changed nothing");
  } finally {
    await clearBanner(admin);
    await closeAll(admin, user, anon);
  }
});

// ---------------------------------------------------------------------------------------------

test(tag("DEMO-AC-005", "a user's posts-per-page choice, made through the page, is still the choice after logging out and in again (same browser and a new one); another user keeps the default"), async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const o = origin();
  const sfx = randomSuffix(4);
  const id = `demo-ac005-user-${sfx}`;
  const user = await session(browser, o, "user", id);
  const other = await session(browser, o, "user", `demo-ac005-other-${sfx}`);
  let again: Session | undefined;
  try {
    const control = (p: Page) => p.getByRole("combobox", { name: ASSUMED.pageSizeControl }).first();
    const settledValue = async (p: Page): Promise<string> => {
      await openSettled(p, "/");
      await expect(control(p)).toBeVisible({ timeout: 30_000 });
      return control(p).inputValue();
    };
    const initial = await settledValue(user.page);
    const options = await control(user.page).locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const choice = options.find((v) => v !== initial);
    expect(choice, `the posts-per-page control offers a choice other than ${initial}`).toBeDefined();
    const chosen = choice ?? "";
    const rec = await record(user.page, o, async () => {
      await control(user.page).selectOption(chosen);
      await user.page.waitForTimeout(1_000);
    });
    const saves = rec.filter((r) => r.method !== "GET");
    if (saves.length === 0) {
      // A separate save control, if the choice is not saved on change.
      const save = user.page.getByRole("button", { name: ASSUMED.saveButton });
      if ((await save.count()) > 0) theMutation(await record(user.page, o, () => save.first().click(), { mutation: true }), "saving the posts-per-page choice");
    }
    expect(await settledValue(user.page), "the choice is shown after a reload").toBe(chosen);

    // Log out through the page's control, then log in again as the same user.
    await openSettled(user.page, "/");
    await user.page.getByRole("button", { name: ASSUMED.logoutButton }).first().click({ timeout: 30_000 });
    await expect.poll(async () => (await me(user.page.request, o)).level, { timeout: 30_000 }).toBe("anonymous");
    await mockLogin(user.page.request, o, "user", id);
    expect((await me(user.page.request, o)).id).toBe(id);
    expect(await settledValue(user.page), "the choice survives logout and login").toBe(chosen);

    // A new browser session for the same user (nothing kept in the browser).
    again = await session(browser, o, "user", id);
    expect(await settledValue(again.page), "the choice survives in a new session").toBe(chosen);
    expect(await settledValue(other.page), "the choice is this user's, not everyone's").toBe(initial);
  } finally {
    await closeAll(user, other, again);
  }
});

// ---------------------------------------------------------------------------------------------

/** Presses the draft's share control and returns the share link it shows, and the request it sent. */
async function createShareLink(author: Session): Promise<{ link: string; request: Recorded }> {
  const page = author.page;
  const before = new Set(await page.locator("a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href)));
  const rec = await record(page, author.origin, () => page.getByRole("button", { name: ASSUMED.shareButton }).first().click({ timeout: 30_000 }), { mutation: true });
  const request = theMutation(rec, "creating a share link");
  const found = async (): Promise<string | undefined> => {
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
    const link = hrefs.find((h) => !before.has(h) && h.startsWith(author.origin));
    if (link !== undefined) return link;
    for (const box of await page.getByRole("textbox").all()) {
      const v = await box.inputValue().catch(() => "");
      if (v.startsWith(author.origin)) return v;
    }
    const text = await page.locator("body").innerText();
    return text.match(new RegExp(`${author.origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\S+`))?.[0];
  };
  await expect.poll(found, { message: "the page shows the share link", timeout: 30_000 }).toBeDefined();
  return { link: (await found()) ?? "", request };
}

/** The link with one character of its longest part (the signature or token) changed. */
function altered(link: string): string {
  const url = new URL(link);
  const parts = [...url.pathname.split("/"), ...Array.from(url.searchParams.values())];
  const longest = parts.reduce((a, b) => (b.length > a.length ? b : a), "");
  expect(longest.length, `the share link ${link} carries a token`).toBeGreaterThanOrEqual(16);
  const i = Math.floor(longest.length / 2);
  const swapped = `${longest.slice(0, i)}${longest[i] === "A" ? "B" : "A"}${longest.slice(i + 1)}`;
  const out = link.replace(longest, swapped).replace(encodeURIComponent(longest), encodeURIComponent(swapped));
  expect(out, "the link was altered").not.toBe(link);
  return out;
}

test(tag("DEMO-AC-007", "a share link created through the page shows the draft to an anonymous visitor; the same link with one character altered is refused and shows nothing of the draft"), async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const o = origin();
  const sfx = randomSuffix(4);
  const author = await session(browser, o, "user", `demo-ac007-user-${sfx}`);
  const anon = await session(browser, o, "anonymous");
  const title = `AC007 shared draft ${sfx}`;
  let created = false;
  try {
    await createDraftAndOpen(author.page, title);
    created = true;
    const postUrl = author.page.url();
    const { link } = await createShareLink(author);
    expect(await listed(anon, title), "the draft is not published").toBe(false);

    const valid = await record(anon.page, o, () => openSettled(anon.page, link));
    await expectShown(anon.page, title, "the share link shows the draft to an anonymous visitor");
    expect(valid.some((r) => r.status === 200 && r.response.includes(title)), "the draft came from the API").toBe(true);

    const bad = altered(link);
    const refused = await record(anon.page, o, () => openSettled(anon.page, bad));
    await expectNotShown(anon.page, title, "an altered link shows nothing of the draft");
    expect(
      refused.some((r) => r.status >= 400 && r.status < 500),
      `an altered link is refused by the app (responses: ${refused.map((r) => `${r.method} ${r.path} ${String(r.status)}`).join(", ")})`,
    ).toBe(true);
    expect(refused.every((r) => !r.response.includes(title)), "no response carries the draft").toBe(true);
    await openSettled(author.page, postUrl);
  } finally {
    if (created) {
      author.page.once("dialog", (d) => void d.accept());
      await author.page.getByRole("button", { name: ASSUMED.deleteButton }).first().click({ timeout: 10_000 }).catch(() => undefined);
      await author.page.waitForLoadState("networkidle").catch(() => undefined);
    }
    await closeAll(author, anon);
  }
});

/** Runs `fn` with the process clock moved forward by `ms` (the stand-in for the test runner's fake timers). */
async function withClockShift<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;
  class ShiftedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(RealDate.now() + ms);
      else super(...(args as [number]));
    }
    static override now(): number {
      return RealDate.now() + ms;
    }
  }
  globalThis.Date = ShiftedDate as DateConstructor;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

const DAY_MS = 24 * 60 * 60_000;

if (local()) {
  test(tag("DEMO-AC-007", "expiry clause (local, in-process with a moved clock): with the share-link lifetime configured to 1 day, a link opens after 12 hours and is refused after 2 days"), async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const o = origin();
    const sfx = randomSuffix(4);
    const author = await session(browser, o, "user", `demo-ac007x-user-${sfx}`);
    const anon = await session(browser, o, "anonymous");
    const title = `AC007 expiry ${sfx}`;
    let app: TestApp | undefined;
    try {
      // Learn the requests from the running demo: create a draft, create its share link, open the link.
      const createRec = theMutation(await record(author.page, o, async () => void (await createDraftAndOpen(author.page, title))), "creating a draft");
      const { link, request: shareRec } = await createShareLink(author);
      const viewRec = (await record(anon.page, o, () => openSettled(anon.page, link))).filter((r) => r.method === "GET" && r.status === 200 && r.response.includes(title));
      expect(viewRec.length, "opening the share link reads the draft through the API").toBeGreaterThan(0);
      author.page.once("dialog", (d) => void d.accept());
      await author.page.getByRole("button", { name: ASSUMED.deleteButton }).first().click({ timeout: 10_000 });

      // The same requests in-process, with the lifetime configured to 1 day (DEMO-REQ-006).
      const lifetimeKey = await configKey(/share/i, "the share-link lifetime in days");
      const authorId = `demo-ac007x-author-${sfx}`;
      app = await demoTestApp({ config: { [lifetimeKey]: 1 } });
      const asAuthor = app.as(mockUsers.user(authorId));
      const subs: Substitutions = new Map();
      const created = await replayInProcess(asAuthor, createRec);
      expectAllowed(created, "in-process: create the draft");
      learn(subs, createRec.response, created.text);
      const shared = await replayInProcess(asAuthor, substitute(shareRec, subs));
      expectAllowed(shared, "in-process: create the share link");
      learn(subs, shareRec.response, shared.text);
      const anonymous = app;
      const open = async (): Promise<{ status: number; text: string }> => {
        const results = await Promise.all(viewRec.map((r) => replayInProcess(anonymous, substitute(r, subs))));
        return { status: Math.max(...results.map((r) => r.status)), text: results.map((r) => r.text).join("\n") };
      };
      const now = await open();
      expectAllowed(now, "in-process: the new link opens");
      expect(now.text, "in-process: the new link shows the draft").toContain(title);
      const later = await withClockShift(DAY_MS / 2, open);
      expectAllowed(later, "after 12 hours the link still opens");
      expect(later.text).toContain(title);
      const expired = await withClockShift(2 * DAY_MS, open);
      expect(expired.status, `after 2 days the link is refused (got ${String(expired.status)})`).toBeGreaterThanOrEqual(400);
      expect(expired.status).toBeLessThan(500);
      expect(expired.text, "an expired link shows nothing of the draft").not.toContain(title);
    } finally {
      if (app !== undefined) await app.dispose();
      await closeAll(author, anon);
    }
  });
}

// ---------------------------------------------------------------------------------------------

interface LogEntry {
  readonly time: string;
  readonly app: string;
  readonly severity: string;
  readonly component: string;
  readonly message: string;
  readonly requestId?: string;
}

/** Every entry of the demo's log on this target: the local copy's `.logs/*.log`, or the stage's entries in the shared log bucket. */
async function logEntries(appName: string, days: readonly Date[]): Promise<LogEntry[]> {
  const t = target();
  if (t.target === "local") {
    const dir = requireDemo(demo).dir;
    if (dir === undefined) return prerequisiteMissing(`the local log of a demo given by COMPLIANCE_DEMO_BASE_URL is not readable here: leave it unset to start the demo locally`);
    const logs = join(dir, ".logs");
    if (!existsSync(logs)) return [];
    return readdirSync(logs)
      .filter((n) => n.endsWith(".log"))
      .flatMap((n) => readFileSync(join(logs, n), "utf8").split("\n"))
      .filter((l) => l.trim() !== "")
      .map((l) => JSON.parse(l) as LogEntry);
  }
  const stage = process.env[DEMO_STAGE_ENV];
  if (stage === undefined || stage === "") return prerequisiteMissing(`cloud part: set ${DEMO_STAGE_ENV} to the demo's test stage name (F-03) to read its entries in the shared log bucket`);
  const out: LogEntry[] = [];
  for (const day of new Set(days.map(utcDay))) for (const stored of await cloudLogEntries(t.target, appName, stage, day)) out.push(JSON.parse(stored.body) as LogEntry);
  return out;
}

const MARGIN_MS = 2_000;
const GAP_MS = 5_000;

test(tag("DEMO-AC-008", "publishing a post and deleting it through the page each produce an info entry of the demo, written during that request, in the target's log"), async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const o = origin();
  const sfx = randomSuffix(4);
  const { name: appName } = await demoDefinition();
  const admin = await session(browser, o, "admin", `demo-ac008-admin-${sfx}`);
  const title = `AC008 logged ${sfx}`;
  let created = false;
  try {
    await createDraftAndOpen(admin.page, title);
    created = true;
    await admin.page.waitForTimeout(GAP_MS);
    const publishFrom = new Date(Date.now() - MARGIN_MS);
    await act(admin, ASSUMED.publishButton, "publishing the post");
    const publishTo = new Date(Date.now() + MARGIN_MS);
    await admin.page.waitForTimeout(GAP_MS);
    const deleteFrom = new Date(Date.now() - MARGIN_MS);
    await act(admin, ASSUMED.deleteButton, "deleting the post");
    created = false;
    const deleteTo = new Date(Date.now() + MARGIN_MS);

    const infoIn = (entries: readonly LogEntry[], from: Date, to: Date): LogEntry[] =>
      entries.filter((e) => e.app === appName && e.severity === "info" && e.requestId !== undefined && new Date(e.time) >= from && new Date(e.time) <= to);
    let entries: LogEntry[] = [];
    await expect
      .poll(
        async () => {
          entries = await logEntries(appName, [publishFrom, deleteTo]);
          return infoIn(entries, publishFrom, publishTo).length > 0 && infoIn(entries, deleteFrom, deleteTo).length > 0;
        },
        { message: "the log holds an info entry for the publish and one for the delete", timeout: local() ? 30_000 : 120_000, intervals: [1_000, 2_000, 5_000] },
      )
      .toBe(true)
      .catch((error: unknown) => {
        const recent = entries.filter((e) => new Date(e.time) >= publishFrom).map((e) => `${e.time} ${e.severity} ${e.component}: ${e.message}`);
        throw new Error(`${String(error)}\nentries since the publish:\n${recent.join("\n")}`);
      });
  } finally {
    if (created) await deleteAsAdmin(admin, admin.page.url());
    await closeAll(admin);
  }
});

// ---------------------------------------------------------------------------------------------

if (local()) {
  test(tag("DEMO-AC-011", "every committed production values file sets framework.users; in-process with the stub login provider, a login on the users list creates a draft and a login on neither list is refused with 401 and sees only published posts"), async ({ browser }) => {
    test.setTimeout(6 * 60_000);
    // 1. Every committed production values file (config/<target>/<stage>.json, stage not `test`; not config/local.json).
    const tracked = execFileSync("git", ["ls-files", "apps/demo/config"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter((p) => /^apps\/demo\/config\/[^/]+\/[^/]+\.json$/.test(p) && !p.endsWith("/test.json"));
    expect(tracked.length, "the demo commits at least one production values file (DEMO-REQ-011)").toBeGreaterThan(0);
    for (const path of tracked) {
      const file = JSON.parse(readFileSync(join(REPO_ROOT, path), "utf8")) as { framework?: { users?: unknown } };
      expect(Array.isArray(file.framework?.users), `${path} sets framework.users`).toBe(true);
    }

    // 2. Learn the requests from the running demo: create a draft, publish it, list the front page anonymously.
    const o = origin();
    const sfx = randomSuffix(4);
    const admin = await session(browser, o, "admin", `demo-ac011-admin-${sfx}`);
    const anon = await session(browser, o, "anonymous");
    const learned = `AC011 learned ${sfx}`;
    let app: TestApp | undefined;
    let ids: TestApp | undefined;
    try {
      const createRec = theMutation(await record(admin.page, o, async () => void (await createDraftAndOpen(admin.page, learned))), "creating a draft");
      const publishRec = await act(admin, ASSUMED.publishButton, "publishing the post");
      const listRec = (await record(anon.page, o, () => openSettled(anon.page, "/"))).filter((r) => r.method === "GET" && r.status === 200 && r.response.includes(learned));
      expect(listRec.length, "the front page lists published posts through the API").toBeGreaterThan(0);
      await deleteAsAdmin(admin, admin.page.url());

      // The user IDs the stub provider's subjects get (a build with no lists: every login is at least a user).
      const subject = { listed: `ac011-listed-${sfx}`, admin: `ac011-admin-${sfx}`, other: `ac011-other-${sfx}` };
      ids = await demoTestApp({ stubLoginProvider: true, config: { framework: {} } });
      const idOf = async (s: string): Promise<string> => {
        await (ids as TestApp).loginWithStub(s);
        const body = (await (await (ids as TestApp).request("/api/auth/me")).json()) as { id?: string };
        expect(typeof body.id, `the stub login of ${s} has a user ID`).toBe("string");
        return body.id ?? "";
      };
      const listedId = await idOf(subject.listed);
      const adminId = await idOf(subject.admin);
      await ids.dispose();
      ids = undefined;

      app = await demoTestApp({ stubLoginProvider: true, config: { framework: { users: [listedId], admins: [adminId] } } });
      const level = async (): Promise<string> => ((await (await (app as TestApp).request("/api/auth/me")).json()) as { level: string }).level;
      const tPublished = `AC011 published ${sfx}`;
      const tDraft = `AC011 listed draft ${sfx}`;

      // An admin publishes a post, so there is something published to see.
      await app.loginWithStub(subject.admin);
      expect(await level()).toBe("admin");
      const subs: Substitutions = new Map([[learned, tPublished]]);
      const created = await replayInProcess(app, substitute(createRec, subs));
      expectAllowed(created, "in-process: an admin creates a draft");
      learn(subs, createRec.response, created.text);
      expectAllowed(await replayInProcess(app, substitute(publishRec, subs)), "in-process: the admin publishes it");

      // A login on the users list can create a draft.
      await app.loginWithStub(subject.listed);
      expect(await level(), "a login on the users list is a user").toBe("user");
      expectAllowed(await replayInProcess(app, withText(createRec, learned, tDraft)), "a login on the users list creates a draft");

      // A login on neither list: refused with 401, and sees only published posts.
      await app.loginWithStub(subject.other);
      expect(await level(), "a login on neither list is anonymous").toBe("anonymous");
      const refused = await replayInProcess(app, withText(createRec, learned, `AC011 unlisted ${sfx}`));
      expect(refused.status, `a login on neither list creating a draft is refused with 401 (got ${String(refused.status)}: ${refused.text.slice(0, 200)})`).toBe(401);
      const seen = await visibleThrough((r) => replayInProcess(app as TestApp, r), listRec.map((r) => substitute(r, subs)));
      expect(seen, "the unlisted login sees the published post").toContain(tPublished);
      expect(seen, "the unlisted login does not see the draft").not.toContain(tDraft);
    } finally {
      if (ids !== undefined) await ids.dispose();
      if (app !== undefined) await app.dispose();
      await closeAll(admin, anon);
    }
  });
}
