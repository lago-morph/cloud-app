import { expect, test } from "@playwright/test";

/**
 * What only a browser shows: the home page renders the greeting, and the login button signs in
 * (locally, the authentication mock's default user). Every other case is an API test (../api/).
 *
 * Edge cases, listed before the test (the skill's reference/testing/e2e.md): access is the one that
 * applies here (anonymous sees "Log in", a signed-in user sees "Log out"); boundaries, text, order,
 * repetition and failures are covered by the API and in-process tests.
 */
test("the login button signs in, and the page shows who is logged in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hello");
  await expect(page.getByText("You are not logged in.")).toBeVisible();

  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText(/^Logged in as .+ \(user\)\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByText("You are not logged in.")).toBeVisible();
});
