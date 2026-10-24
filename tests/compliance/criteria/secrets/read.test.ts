/**
 * SEC-AC-001: a declared secret with a value is returned; an undeclared name fails with
 * SEC.UNDECLARED; a declared name without a value fails with SEC.MISSING
 * (docs/components/secrets.md §4). The reference app never returns the value itself, only its
 * SHA-256 (ROUTES.md `GET /api/ref/secret`), so "is returned" is checked by digest.
 *
 * The run's deployment has the test secret set, so the "without a value" clause runs on a
 * deployment without it: locally a scratch copy of the reference app started with `dev` and no
 * value; on a cloud a further stage after the secret is deleted (secrets/further-stage.test.ts).
 */
import { describe, expect, it } from "vitest";
import { client, createClient, tag } from "../../harness/index.js";
import { readDevVars, scratchCopy, startDev, type DevSession } from "../core/support/processes.js";
import { catalogueStatus, isLocal, REFERENCE_DIR, sha256Hex } from "../core/support/repo.js";
import { testSecretValue } from "../core/support/stores.js";

describe("SEC: declared names only", () => {
  it(tag("SEC-AC-001", "the declared secret apiKey with a value is read by the app; an undeclared name fails with SEC.UNDECLARED"), async () => {
    const value = testSecretValue();
    const c = client();
    expect(c.expectStatus(await c.get("/api/ref/secret"), 200).json()).toEqual({ sha256: sha256Hex(value) });
    c.expectError(await c.get("/api/errors/SEC.UNDECLARED"), catalogueStatus("SEC.UNDECLARED"), "SEC.UNDECLARED");
    // Reading the declared secret is not an undeclared read: the SEC.MISSING route answers 200 when the value is set.
    expect(c.expectStatus(await c.get("/api/errors/SEC.MISSING"), 200).json()).toEqual({ raised: false });
  });

  if (isLocal()) {
    it(
      tag("SEC-AC-001", "locally, a declared secret without a value in the stage fails with SEC.MISSING"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "sec-ac-001");
        let dev: DevSession | undefined;
        try {
          dev = await startDev(copy.dir);
          expect(readDevVars(copy.dir).get("SECRET_API_KEY"), "the scratch copy has no value for apiKey").toBeUndefined();
          const c = createClient({ baseUrl: dev.baseUrl });
          const status = catalogueStatus("SEC.MISSING");
          c.expectError(await c.get("/api/ref/secret"), status, "SEC.MISSING");
          c.expectError(await c.get("/api/errors/SEC.MISSING"), status, "SEC.MISSING");
          // A missing value is not an undeclared name.
          c.expectError(await c.get("/api/errors/SEC.UNDECLARED"), catalogueStatus("SEC.UNDECLARED"), "SEC.UNDECLARED");
        } finally {
          if (dev !== undefined) await dev.stop();
          await copy.remove();
        }
      },
      300_000,
    );
  }
});
