/**
 * AWS-AC-001 (aws.md §4; AWS-REQ-001): "A deployed test stage serves the client and the API from
 * the CloudFront origin; deep links serve the client; an API 403 and an unknown API path's 404
 * keep their JSON ErrorResponse through CloudFront."
 *
 * Runs against the run's stage, so it creates nothing. Reading: "the CloudFront origin" = the
 * base URL the driver gives the tests, which is the stage's CloudFront URL (aws.md §2, DEC-0073:
 * no custom domains), and every response carries CloudFront's `x-amz-cf-id`; "serves the client" =
 * `/` and a deep link answer the same entry page, whose scripts and stylesheets come from that
 * origin; "the API" = `/api/ref/deployment` answers this stage's deployment as JSON; "an API 403"
 * = a user on an admin route and the app-raised `AUTH.FORBIDDEN` route; "unknown API path's
 * 404" = several unknown `/api` paths. Each error keeps a schema-valid ErrorResponse with a JSON
 * content type (SPA fallback is for non-`/api` paths only, never custom error responses, §2).
 *
 * Cloud usage: about 15 HTTP requests to the stage; no AWS API requests; no database rows.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { client, tag, target, type HttpResponse } from "../../harness/index.js";
import { catalogueStatus, errorResponseViolations } from "../core/support/repo.js";

const rand = (): string => randomBytes(6).toString("hex");

/** script `src` and stylesheet / modulepreload `href` values of an HTML page. */
function pageAssets(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) out.push(m[1] ?? "");
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(m[0])) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[0])?.[1];
    if (href !== undefined) out.push(href);
  }
  return out.filter((u) => u !== "");
}

function throughCloudFront(r: HttpResponse): void {
  expect(r.headers.get("x-amz-cf-id") ?? "", `${r.method} ${r.path} was served through CloudFront (x-amz-cf-id)`).not.toBe("");
}

function keepsErrorResponse(r: HttpResponse): void {
  throughCloudFront(r);
  expect(r.headers.get("content-type") ?? "", `${r.method} ${r.path} content type`).toMatch(/^application\/json\b/i);
  expect(errorResponseViolations(r.json()), `${r.method} ${r.path} body is an ErrorResponse`).toEqual([]);
}

if (target().target === "aws") {
  describe("AWS-AC-001 runtime shape (aws)", () => {
    it(tag("AWS-AC-001", "the CloudFront origin serves the client, deep links and the API, and API 403 and 404 responses keep their JSON ErrorResponse"), async () => {
      const c = client();
      const origin = new URL(c.baseUrl);
      expect(origin.protocol, "the stage's origin is https").toBe("https:");
      expect(origin.hostname, "the stage's origin is its CloudFront URL").toMatch(/\.cloudfront\.net$/);

      // The client: entry page and its assets, from the one origin.
      const root = c.expectStatus(await c.get("/"), 200);
      throughCloudFront(root);
      expect(root.headers.get("content-type") ?? "", "GET / content type").toMatch(/^text\/html\b/i);
      const assets = pageAssets(root.text);
      expect(assets.length, "the entry page loads at least one script").toBeGreaterThan(0);
      for (const asset of assets) {
        const url = new URL(asset, `${origin.origin}/`);
        expect(url.origin, `asset ${asset} is served from the stage's origin`).toBe(origin.origin);
        const r = c.expectStatus(await c.get(`${url.pathname}${url.search}`), 200);
        expect(r.headers.get("content-type") ?? "", `asset ${url.pathname} is not the entry page`).not.toMatch(/^text\/html\b/i);
      }

      // Deep links serve the client.
      for (const path of [`/deep/link-${rand()}`, `/deep/link-${rand()}/page`, `/a/b/c-${rand()}?q=1`]) {
        const deep = c.expectStatus(await c.get(path), 200);
        throughCloudFront(deep);
        expect(deep.headers.get("content-type") ?? "", `deep link ${path} content type`).toMatch(/^text\/html\b/i);
        expect(deep.text, `deep link ${path} answers the same entry page as /`).toBe(root.text);
      }

      // The API, from the same origin.
      const api = c.expectStatus(await c.get("/api/ref/deployment"), 200);
      throughCloudFront(api);
      expect(api.headers.get("content-type") ?? "", "the API answers JSON").toMatch(/^application\/json\b/i);
      expect(api.json(), "the API at the same origin is this stage's app").toEqual({ deployment: { app: "reference", stage: target().stage } });

      // An API 403 keeps its JSON ErrorResponse.
      const forbidden = catalogueStatus("AUTH.FORBIDDEN");
      const user = await c.as("user", { id: "g-t2-aws001-user" });
      keepsErrorResponse(user.expectError(await user.get("/api/levels/admin"), forbidden, "AUTH.FORBIDDEN"));
      keepsErrorResponse(c.expectError(await c.get("/api/errors/AUTH.FORBIDDEN"), forbidden, "AUTH.FORBIDDEN"));

      // An unknown API path's 404 keeps its JSON ErrorResponse.
      const notFound = catalogueStatus("HTTP.NOT_FOUND");
      const cases: [string, string][] = [
        ["GET", "/api"],
        ["GET", `/api/no-such-route-${rand()}`],
        ["GET", `/api/ref/no-such-${rand()}`],
        ["GET", `/api/${rand()}/${rand()}/deeper`],
        ["POST", `/api/no-such-route-${rand()}`],
      ];
      for (const [method, path] of cases) {
        keepsErrorResponse(c.expectError(await c.request(method, path, method === "POST" ? { json: {} } : {}), notFound, "HTTP.NOT_FOUND"));
      }
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on other targets.
  describe("AWS-AC-001 (aws only)", () => {
    it("has nothing to run on this target", () => undefined);
  });
}
