/**
 * CF-AC-001 (cloudflare.md §4): a deployed test stage serves the client and the API from one
 * origin, and unknown API paths return JSON 404s.
 *
 * Runs against the run's stage (the driver's `test-<run ID>` deployment of apps/reference), so
 * it creates nothing. Reading (D-T.md): "serves the client" = `/` and a deep link answer the
 * entry page (static assets with fallback to the entry page, cloudflare.md §2), and every
 * script and stylesheet the page loads comes from that same origin and answers 200; "the API"
 * = `/api/ref/deployment` answers JSON from that origin; "unknown API paths" = several paths
 * under `/api` (incl. `/api` itself, nested, under `__framework`, and a POST) each answer 404
 * with a schema-valid `ErrorResponse` with code `HTTP.NOT_FOUND` and a JSON content type. No
 * response redirects (the client follows none).
 *
 * Cloud usage: about 12 HTTP requests to the stage; no Cloudflare API requests; no D1 rows
 * (none of the routes touches the database). Needs D1 only through the run stage's deploy, so
 * it is blocked while DEC-0317 holds.
 */
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { client, tag, target } from "../../harness/index.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { catalogueStatus, errorResponseViolations, isLocal } from "../core/support/repo.js";

const rand = (): string => randomBytes(6).toString("hex");

/** script `src` and stylesheet / modulepreload `href` values of an HTML page. */
function pageAssets(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) out.push(m[1] ?? "");
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tagText = m[0];
    if (!/\brel\s*=\s*["'](?:stylesheet|modulepreload)["']/i.test(tagText)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tagText)?.[1];
    if (href !== undefined) out.push(href);
  }
  return out.filter((u) => u !== "");
}

if (!isLocal()) {
  describe("CF-AC-001 one origin (cloud)", () => {
    it(tag("CF-AC-001", "the stage serves the client entry page, its assets and the API from one origin"), async () => {
      requireCloudD1(target().target);
      const c = client();
      const origin = new URL(c.baseUrl).origin;

      const root = c.expectStatus(await c.get("/"), 200);
      expect(root.headers.get("content-type") ?? "", "GET / content type").toMatch(/^text\/html\b/i);
      const assets = pageAssets(root.text);
      expect(assets.length, "the entry page loads at least one script").toBeGreaterThan(0);
      for (const asset of assets) {
        const url = new URL(asset, `${origin}/`);
        expect(url.origin, `asset ${asset} is served from the stage's origin`).toBe(origin);
        const r = c.expectStatus(await c.get(`${url.pathname}${url.search}`), 200);
        expect(r.headers.get("content-type") ?? "", `asset ${url.pathname} is not the entry page`).not.toMatch(/^text\/html\b/i);
      }

      const deep = c.expectStatus(await c.get(`/deep/link-${rand()}/page`), 200);
      expect(deep.headers.get("content-type") ?? "", "a deep link answers the entry page").toMatch(/^text\/html\b/i);
      expect(deep.text, "a deep link answers the same entry page as /").toBe(root.text);

      const api = c.expectStatus(await c.get("/api/ref/deployment"), 200);
      expect(api.headers.get("content-type") ?? "", "the API answers JSON").toMatch(/^application\/json\b/i);
      expect(api.json(), "the API at the same origin is this stage's app").toEqual({ deployment: { app: "reference", stage: target().stage } });
    });

    it(tag("CF-AC-001", "unknown API paths return JSON 404s with HTTP.NOT_FOUND"), async () => {
      requireCloudD1(target().target);
      const c = client();
      const status = catalogueStatus("HTTP.NOT_FOUND");
      const cases: [string, string][] = [
        ["GET", "/api"],
        ["GET", `/api/no-such-route-${rand()}`],
        ["GET", `/api/ref/no-such-${rand()}`],
        ["GET", `/api/${rand()}/${rand()}/deeper`],
        ["GET", `/api/__framework/no-such-${rand()}`],
        ["POST", `/api/no-such-route-${rand()}`],
      ];
      for (const [method, path] of cases) {
        const r = c.expectError(await c.request(method, path, method === "POST" ? { json: {} } : {}), status, "HTTP.NOT_FOUND");
        expect(r.headers.get("content-type") ?? "", `${method} ${path} content type`).toMatch(/^application\/json\b/i);
        expect(errorResponseViolations(r.json()), `${method} ${path} body`).toEqual([]);
      }
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("CF-AC-001 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
