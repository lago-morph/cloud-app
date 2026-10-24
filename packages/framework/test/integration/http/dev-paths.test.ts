/**
 * HTTP-AC-001 on the real local target: `dev` (Wrangler/workerd + Vite) serving one
 * `http://localhost:<port>` origin. Criteria: docs/components/http.md §4.
 */
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  CLIENT_MARKER,
  devFixtureFiles,
  errorResponseViolations,
  makeTempApp,
  startDev,
  type DevServer,
  type TempApp,
} from "../core/harness/harness.js";

let app: TempApp | undefined;
let devStart: Promise<DevServer> | undefined;

/** Starts `dev` on first use, so a failing start fails each test rather than skipping them. */
function server(): Promise<DevServer> {
  devStart ??= makeTempApp(devFixtureFiles()).then((a) => {
    app = a;
    return startDev(a.dir);
  });
  return devStart;
}

afterAll(async () => {
  await devStart?.then((d) => d.stop(), () => undefined);
  await app?.remove();
}, 60_000);

describe("HTTP-AC-001 on dev", { timeout: 240_000 }, () => {
  it(tag("HTTP-AC-001", "GET /api/does-not-exist returns 404 HTTP.NOT_FOUND JSON, never the client page"), async () => {
    const dev = await server();
    const res = await fetch(`${dev.baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
    const raw = await res.text();
    expect(raw).not.toContain(CLIENT_MARKER);
    const body = JSON.parse(raw) as { error: { code: string } };
    expect(errorResponseViolations(body)).toEqual([]);
    expect(body.error.code).toBe("HTTP.NOT_FOUND");
  });

  it(tag("HTTP-AC-001", "GET /some/deep/link returns the client entry page"), async () => {
    const dev = await server();
    const entry = await fetch(`${dev.baseUrl}/`);
    expect(entry.status).toBe(200);
    const entryHtml = await entry.text();
    expect(entryHtml).toContain(CLIENT_MARKER);

    const deep = await fetch(`${dev.baseUrl}/some/deep/link`);
    expect(deep.status).toBe(200);
    expect(deep.headers.get("content-type") ?? "").toMatch(/text\/html/);
    const deepHtml = await deep.text();
    expect(deepHtml).toContain(CLIENT_MARKER);
    expect(deepHtml).toBe(entryHtml);
  });
});
