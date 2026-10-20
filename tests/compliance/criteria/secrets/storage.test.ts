/**
 * SEC-AC-003: after a secret is set with the CLI, it exists at the specified location on each
 * target (docs/components/secrets.md §4; locations: SEC-REQ-003). Locally: `secrets set` on a
 * scratch copy of the reference app writes `SECRET_API_KEY` to its git-ignored `.dev.vars`, and the
 * app started there reads that value. The cloud part sets the secret on a further stage
 * (secrets/further-stage.test.ts); the AWS IAM simulation clause belongs to the AWS phase.
 */
import { describe, expect, it } from "vitest";
import { createClient, tag } from "../../harness/index.js";
import { cli, readDevVars, runCommand, scratchCopy, startDev, type DevSession } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, REPO_ROOT, secretLocation, sha256Hex, uniqueValue } from "../core/support/repo.js";

describe("SEC: storage per target", () => {
  // Untagged, so never selected as evidence: keeps the suite valid where the local test is not registered.
  it("the cloud part is in secrets/further-stage.test.ts", () => undefined);
  if (isLocal()) {
    it(
      tag("SEC-AC-003", "locally, secrets set writes the value to SECRET_<NAME> in the app's git-ignored .dev.vars, where the app reads it"),
      async () => {
        const copy = await scratchCopy(REFERENCE_DIR, "sec-ac-003");
        let dev: DevSession | undefined;
        try {
          const value = uniqueValue("secAc003");
          const set = await cli(["secrets", "set", "apiKey", "--target", "local", "--stage", "local"], { cwd: copy.dir, stdin: `${value}\n`, timeoutMs: 120_000 });
          expect(set.status, set.output).toBe(0);
          const location = secretLocation("local", "reference", "local", "apiKey");
          expect(location).toBe("SECRET_API_KEY");
          expect(readDevVars(copy.dir).get(location), `.dev.vars ${location}`).toBe(value);
          // The location is git-ignored where the app lives in the repository.
          const ignored = await runCommand("git", ["check-ignore", "-q", "apps/reference/.dev.vars"], { cwd: REPO_ROOT, timeoutMs: 30_000 });
          expect(ignored.status, "apps/reference/.dev.vars is ignored by git").toBe(0);

          dev = await startDev(copy.dir);
          const c = createClient({ baseUrl: dev.baseUrl });
          expect(c.expectStatus(await c.get("/api/ref/secret"), 200).json(), "the app reads the value from that location").toEqual({ sha256: sha256Hex(value) });
        } finally {
          if (dev !== undefined) await dev.stop();
          await copy.remove();
        }
      },
      300_000,
    );
  }
});
