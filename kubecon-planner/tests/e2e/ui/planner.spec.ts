import { expect, test, type APIRequestContext } from "@playwright/test";
import type { SessionList, SessionSummary } from "../../../src/shared/types";

/**
 * What only a browser shows: sign-in, the browse page rendering sessions with search and the
 * details dialog, and the My schedule day grid drawing conflicting selections side by side.
 * Every other case of these flows is an API test (../api/).
 *
 * Edge cases (the skill's reference/testing/e2e.md): access applies here (anonymous sees "Log in",
 * a signed-in user sees the planner); conflicts are the boundary that applies to the grid (two
 * overlapping selections). Text, order, repetition and failures are covered by the API and
 * in-process tests.
 */

/** Signs the page's context in as a fresh mock user; state-changing requests carry the app's origin. */
async function signInFresh(request: APIRequestContext, origin: string): Promise<void> {
  const headers = { Origin: origin };
  const res = await request.post("/api/auth/mock-login", { headers, data: { level: "user", id: `e2e-ui-${crypto.randomUUID()}` } });
  expect(res.status()).toBe(204);
  const imported = await request.post("/api/schedule/refresh", { headers, data: { onlyIfEmpty: true }, timeout: 90_000 });
  expect(imported.status()).toBe(200);
}

/** Two 20-to-60-minute talks on Tuesday that overlap, with distinct titles. */
async function overlappingPair(request: APIRequestContext): Promise<[SessionSummary, SessionSummary]> {
  const body: SessionList = await (await request.get("/api/sessions", { params: { day: "2026-11-10" } })).json();
  const minutes = (t: string): number => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  const talks = body.sessions.filter((s) => {
    const length = minutes(s.endsAt) - minutes(s.startsAt);
    return length >= 20 && length <= 60 && s.endsAt.startsWith("2026-11-10");
  });
  for (const a of talks) {
    const b = talks.find((x) => x.id !== a.id && x.title !== a.title && x.startsAt === a.startsAt);
    if (b !== undefined) return [a, b];
  }
  throw new Error("no overlapping pair on Tuesday");
}

test("the login button signs in, and the browse page lists, searches and shows details", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("KubeCon planner");
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Browse sessions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("article.session").first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Times are Salt Lake City time/)).toBeVisible();

  await page.getByRole("combobox", { name: "Co-located event", exact: true }).selectOption("ArgoCon");
  await page.getByRole("searchbox", { name: "Search", exact: true }).fill("argocon project");
  const result = page.locator("article.session").filter({ hasText: /ArgoCon/ }).first();
  await expect(result).toBeVisible();
  await expect(page.getByText(/^\d+ sessions?$/)).toBeVisible();
  await result.locator("button.title").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Description" })).toBeVisible();
  await expect(dialog.getByText("Room")).toBeVisible();
  await expect(dialog.getByText(/Salt Lake City time/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("two overlapping selections show side by side on the day grid, marked as conflicts", async ({ page }) => {
  await page.goto("/");
  await signInFresh(page.request, new URL(page.url()).origin);
  const [a, b] = await overlappingPair(page.request);
  await page.reload();
  await expect(page.locator("article.session").first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("combobox", { name: "Day", exact: true }).selectOption("2026-11-10");

  for (const s of [a, b]) {
    await page.getByRole("searchbox", { name: "Search", exact: true }).fill(s.title.slice(0, 60));
    const add = page.locator(`article.session[data-session-id="${s.id}"]`).getByRole("button", { name: `Add ${s.title}` });
    await add.click();
    await expect(page.locator(`article.session[data-session-id="${s.id}"]`).getByRole("button", { name: `Remove ${s.title}` })).toHaveAttribute("aria-pressed", "true");
  }

  await page.getByRole("tab", { name: "My schedule" }).click();
  const tuesday = page.getByRole("tab", { name: /^Tue, Nov 10: 2 selected, 2 in conflict$/ });
  await expect(tuesday).toBeVisible();
  await tuesday.click();
  await expect(page.getByText(/2 overlapping \(shown side by side in red\)/)).toBeVisible();

  const blockA = page.locator(`.block[data-session-id="${a.id}"]`);
  const blockB = page.locator(`.block[data-session-id="${b.id}"]`);
  await expect(blockA).toHaveClass(/conflict/);
  await expect(blockB).toHaveClass(/conflict/);
  await expect(blockA.getByText("Conflict")).toBeVisible();
  const boxA = await blockA.boundingBox();
  const boxB = await blockB.boundingBox();
  expect(boxA !== null && boxB !== null).toBe(true);
  if (boxA === null || boxB === null) return;
  // Same start, so the same top; side by side, so the boxes do not overlap horizontally.
  expect(Math.abs(boxA.y - boxB.y)).toBeLessThan(1);
  expect(boxA.x + boxA.width <= boxB.x + 0.5 || boxB.x + boxB.width <= boxA.x + 0.5).toBe(true);
  // A longer session is a taller block (sized by duration).
  const minutes = (t: string): number => Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16));
  const lengthA = minutes(a.endsAt) - minutes(a.startsAt);
  const lengthB = minutes(b.endsAt) - minutes(b.startsAt);
  if (lengthA !== lengthB) expect(boxA.height > boxB.height).toBe(lengthA > lengthB);
});
