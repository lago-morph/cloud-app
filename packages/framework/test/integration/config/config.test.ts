/**
 * CFG-AC-001 in-process through `createTestApp` (testing.d.ts): declared keys, typed values,
 * defaults, and `CFG.UNDECLARED_KEY`. Criteria: docs/components/config.md §4.
 */
import { afterEach, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { TestApp } from "../../../src/testing/index.js";
import { errorBody, errorResponseViolations } from "../core/harness/harness.js";
import { createRefApp } from "../core/harness/reference-app.js";

let app: TestApp | undefined;
afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

describe("CFG-AC-001", () => {
  it(tag("CFG-AC-001", "declared keys read with their defaults, typed"), async () => {
    app = await createRefApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const values = (await res.json()) as Record<string, unknown>;
    expect(values).toEqual({ greeting: "hello", limit: 7, enabled: true, tags: ["alpha", "beta"], title: "bt1 title" });
    expect(Number.isInteger(values["limit"])).toBe(true);
    expect(typeof values["enabled"]).toBe("boolean");
  });

  it(tag("CFG-AC-001", "declared keys read with their supplied typed values"), async () => {
    app = await createRefApp({ config: { greeting: "hi", limit: 42, enabled: false, tags: [], title: "other" } });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ greeting: "hi", limit: 42, enabled: false, tags: [], title: "other" });
  });

  it(tag("CFG-AC-001", "reading an undeclared key fails with CFG.UNDECLARED_KEY"), async () => {
    app = await createRefApp();
    const res = await app.request("/api/config/undeclared");
    expect(res.status).toBe(500);
    const body = await errorBody(res);
    expect(errorResponseViolations(body)).toEqual([]);
    expect(body.error.code).toBe("CFG.UNDECLARED_KEY");
  });
});
