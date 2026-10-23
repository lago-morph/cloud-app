import { test, expect } from "@playwright/test";

test("Vite client reaches the Worker through the /api proxy", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#status")).toHaveText("api ok");
});

test("browser context cookie API works", async ({ page, context }) => {
  await page.goto("/");
  await context.addCookies([{ name: "probe", value: "1", url: "http://127.0.0.1:5199" }]);
  const cookies = await context.cookies();
  expect(cookies.some((c) => c.name === "probe")).toBe(true);
});
