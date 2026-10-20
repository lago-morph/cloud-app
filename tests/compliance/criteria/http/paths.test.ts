/**
 * HTTP-AC-001: API and client paths on this run's target (docs/components/http.md §4).
 */
import { describe, expect, it } from "vitest";
import { client, tag } from "../../harness/index.js";
import { errorResponseViolations, UUID } from "../core/support/repo.js";

describe("HTTP: API and client paths", () => {
  it(tag("HTTP-AC-001", "an unknown /api path is 404 HTTP.NOT_FOUND JSON; an unknown non-API deep link serves the client entry page"), async () => {
    const c = client();
    for (const path of ["/api/does-not-exist", "/api/does/not/exist/deeply"]) {
      const r = c.expectError(await c.get(path), 404, "HTTP.NOT_FOUND");
      expect(r.headers.get("content-type") ?? "", path).toMatch(/^application\/json\b/);
      expect(errorResponseViolations(r.json()), path).toEqual([]);
      expect(r.requestId ?? "", path).toMatch(UUID);
      expect(r.text, `${path} must not be the client page`).not.toMatch(/<html/i);
    }

    const entry = c.expectStatus(await c.get("/"), 200);
    expect(entry.headers.get("content-type") ?? "").toMatch(/^text\/html\b/);
    for (const path of ["/some/deep/link", "/another/unknown/page?x=1"]) {
      const deep = c.expectStatus(await c.get(path), 200);
      expect(deep.headers.get("content-type") ?? "", path).toMatch(/^text\/html\b/);
      expect(deep.text, `${path} serves the client entry page`).toBe(entry.text);
    }
  });
});
