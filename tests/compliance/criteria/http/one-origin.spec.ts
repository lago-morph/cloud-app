/**
 * HTTP-AC-004 (Cloud): the deployed client calls the API with no CORS preflight and no
 * cross-origin requests to the API (docs/components/http.md §4). The reference client asks for
 * the current user on load (ROUTES.md "Client"), so loading the page makes API calls.
 */
import { tag } from "../../harness/index.js";
import { expect, test } from "../../harness/playwright.js";

test(tag("HTTP-AC-004", "the deployed client's API calls are all same-origin, with no CORS preflight"), async ({ page }) => {
  const seen: { method: string; url: string }[] = [];
  page.on("request", (request) => seen.push({ method: request.method(), url: request.url() }));

  for (const path of ["/", "/some/deep/link"]) {
    const meResponse = page.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/api/"), { timeout: 30_000 });
    await page.goto(path);
    await meResponse;
    await page.waitForLoadState("networkidle");
  }

  const pageOrigin = new URL(page.url()).origin;
  const api = seen.filter((r) => new URL(r.url).pathname.startsWith("/api"));
  expect(api.length, "the client made API calls").toBeGreaterThan(0);
  expect(api.filter((r) => new URL(r.url).origin !== pageOrigin), "API requests to another origin").toEqual([]);
  expect(seen.filter((r) => r.method === "OPTIONS"), "CORS preflight requests").toEqual([]);
  // Nothing the page loads (scripts, styles, API) comes from another origin either.
  expect(seen.filter((r) => /^https?:/.test(r.url) && new URL(r.url).origin !== pageOrigin), "cross-origin requests").toEqual([]);
});
