/**
 * PROV-AC-002 (provisioning.md §4), Cloudflare: the deploy sequence's failure handling and its
 * health check.
 *
 * Clauses and how each is checked (readings in D-T.md):
 * 1. "With one credential removed, deploy names it and stops before creating anything": a
 *    deploy of a never-deployed `test-<random>` stage with `CLOUDFLARE_API_TOKEN` removed from
 *    its environment exits non-zero, names `CLOUDFLARE_API_TOKEN`, and afterwards the stage has
 *    no resource at all (`_cloud/stage-resources.ts`: databases, Worker, bucket, token, state).
 *    Needs no D1.
 * 2. "On Cloudflare, with a credential that lacks the permission to create R2 API tokens,
 *    deploy names that permission and stops before creating anything": needs such a token from
 *    the operator in `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`; otherwise a
 *    missing prerequisite (`blocked`). Runs in the sandbox too: the proxy no longer replaces the
 *    Authorization header (DEC-0420). Needs no D1.
 * 3. "A clean deploy passes the health check": the first deploy of a shared stage exits 0
 *    (after setting the declared secret when the first deploy asks for it), and the stage's
 *    health endpoint answers 204.
 * 4. "A failing migration stops the deploy with failure status, the previous version answers
 *    again afterwards, and the output names the failed step, the migration file, the stage's
 *    state ('previous version restarted'), and the next action": with the data fixture loaded,
 *    a deploy of the `unique-fail` overlay (ROUTES.md) exits non-zero; its output names the
 *    migrate step, `0001_unique_label`, "previous version restarted" and a next action; the
 *    stage answers `schema-version` v1 again with the fixture unchanged and one database.
 * 5. "With one declared secret unset on the deployed stage (removed by a test hook after the
 *    preflight), deploy fails at the health step and names the error code": a redeploy of v1
 *    during which the hook deletes `apiKey` once the preflight is past (first output beyond
 *    step 1, or 20 s into the deploy; one retry at 45 s if the deploy still stopped at the
 *    preflight) exits non-zero and its output names the health step and `SEC.MISSING`.
 *
 * Passes (DEC-0318): clause 4 holds two D1 databases (the copy), so this file runs in a pass
 * with no run stage, like the MIG criteria (the database cap is checked; with another
 * test-stage database present clauses 3–5 report a missing prerequisite).
 *
 * Cloud usage (estimate, D-T.md): clauses 1–2 create nothing (≈ 10 Cloudflare API requests for
 * the probes). Clauses 3–5: 4 deploys and one remove of one stage; D1 ≈ 50 rows written by the
 * first deploy, 8 fixture rows (+ index entries ≈ 16), ≈ 60 rows written into the migration
 * copy that is then dropped; ≈ 150 rows written, ≈ 200 read in all; ≈ 15 API requests by the
 * hooks and probes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { CLOUD_WAITS, newTestStage, tag, target, waitFor } from "../../harness/index.js";
import { cloudHooks as hooksFor } from "../_cloud/index.js";
import { listStageResources, stageDatabases } from "../_cloud/stage-resources.js";
import { requireDatabaseRoom } from "../_cloud/d1.js";
import { acquireLock, scratchCopy } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, uniqueValue } from "../core/support/repo.js";
import { restrictedToken } from "./support/restricted-token.js";
import { healthStatus, restoreCommitted, runCli, sharedStage, tail, type CloudStage, type CommandResult } from "./support/stage.js";

/** Output showing the deploy is past step 1 (any later step, or the provisioning tool running). */
const PAST_PREFLIGHT = /\bstep\s*[2-6]\b|find the databases|long-lived infrastructure|\bsst\b|pulumi|\bdeploying\b|\bupdating\b/i;

/** Deploys a never-deployed stage of a scratch copy with an environment change; removes anything it created. */
async function deployNewStage(env: { readonly unset?: readonly string[]; readonly env?: Readonly<Record<string, string>> }): Promise<{ result: CommandResult; left: string[]; stage: string }> {
  const t = target().target;
  // A correct deploy creates nothing here; a defective one could create a database, so the
  // further-stage lock and the database cap apply as for any further stage.
  const release = await acquireLock("further-stage", 60 * 60_000);
  const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov002");
  const stage = newTestStage();
  try {
    await requireDatabaseRoom(1, "PROV-AC-002 (stopped deploy)");
    const result = await runCli(["deploy", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 10 * 60_000, ...env });
    const left = await listStageResources({ target: t, app: "reference", stage });
    if (left.length > 0) {
      // A defect: clean up what the failed deploy created, then report it through the assertion.
      await runCli(["remove", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 20 * 60_000 });
    }
    return { result, left, stage };
  } finally {
    await copy.remove();
    await release();
  }
}

if (!isLocal()) {
  describe("PROV-AC-002 preflight (cloud, no D1)", () => {
    it(tag("PROV-AC-002", "with one credential (CLOUDFLARE_API_TOKEN) removed, deploy names it and stops before creating anything"), async () => {
      const { result, left } = await deployNewStage({ unset: ["CLOUDFLARE_API_TOKEN"] });
      expect(result.status, `deploy without CLOUDFLARE_API_TOKEN must fail:\n${tail(result.output)}`).not.toBe(0);
      expect(result.output, "the output names the missing credential").toContain("CLOUDFLARE_API_TOKEN");
      expect(left, "resources the stopped deploy created").toEqual([]);
    }, 15 * 60_000);

    it(tag("PROV-AC-002", "Cloudflare: with a credential lacking the permission to create R2 API tokens, deploy names that permission and stops before creating anything"), async () => {
      const token = restrictedToken();
      const { result, left } = await deployNewStage({ env: { CLOUDFLARE_API_TOKEN: token } });
      expect(result.status, `deploy with the restricted token must fail:\n${tail(result.output)}`).not.toBe(0);
      expect(result.output, "the output names the missing permission to create R2 API tokens").toMatch(/R2 API tokens?|API Tokens? (?:Write|Edit)/i);
      expect(result.output.includes(token), "the output does not print the token").toBe(false);
      expect(left, "resources the stopped deploy created").toEqual([]);
    }, 15 * 60_000);
  });

  describe("PROV-AC-002 deploy, failing migration and health (cloud, D1)", () => {
    const secret = uniqueValue("dt1prov002");
    const shared = sharedStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: secret }, databases: 2 });
    let deployed = false;
    afterAll(() => shared.close(), 30 * 60_000);

    async function ready(): Promise<CloudStage> {
      const s = await shared.get();
      if (!deployed) {
        await s.deployReady();
        deployed = true;
      }
      return s;
    }

    it(tag("PROV-AC-002", "a clean deploy passes the health check"), async () => {
      const s = await shared.get();
      const r = await s.deployReady();
      deployed = true;
      expect(r.status, "a clean deploy exits 0 (its health step passed)").toBe(0);
      expect(await healthStatus(s.client()), "the stage's health check").toBe(204);
    }, 30 * 60_000);

    it(tag("PROV-AC-002", "a failing migration stops the deploy; the previous version answers again; the output names the step, migration file, stage state and next action"), async () => {
      const s = await ready();
      const user = await s.client().as("user");
      user.expectStatus(await user.post("/api/fixture/load", {}), 201);
      const before = user.expectStatus(await user.get("/api/fixture/dump"), 200).json();
      expect((await stageDatabases(s)).length, "databases before").toBe(1);

      s.applyOverlay("unique-fail");
      const failed = await s.deploy();
      restoreCommitted(s.copy.dir);
      expect(failed.status, `the deploy of the failing migration must fail:\n${tail(failed.output)}`).not.toBe(0);
      expect(failed.output, "names the failed step").toMatch(/\bmigrat/i);
      expect(failed.output, "names the migration file").toContain("0001_unique_label");
      expect(failed.output, "names the stage's state").toMatch(/previous version restarted/i);
      expect(failed.output, "names the next action").toMatch(/deploy again|next action/i);

      const c = s.client();
      // The previous version is restarted explicitly; a workers.dev route change is visible within a bound (DEC-0090).
      await waitFor(async () => ((await c.get("/api/ref/schema-version")).status === 200 ? true : undefined), { what: "the previous version answering again", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 });
      expect(c.expectStatus(await c.get("/api/ref/schema-version"), 200).json(), "the previous version answers").toEqual({ version: "v1" });
      expect(user.expectStatus(await user.get("/api/fixture/dump"), 200).json(), "the previous version's data is unchanged").toEqual(before);
      expect((await stageDatabases(s)).length, "databases after the failed deploy").toBe(1);
    }, 45 * 60_000);

    it(tag("PROV-AC-002", "with the declared secret removed by a test hook after the preflight, deploy fails at the health step and names the error code"), async () => {
      const s = await ready();
      const hooks = hooksFor(s.target);
      const attempt = async (fallbackMs: number): Promise<CommandResult> => {
        let deletion: Promise<void> | undefined;
        const del = (): void => {
          deletion ??= hooks.deleteSecret(s, "apiKey");
        };
        const timer = setTimeout(del, fallbackMs);
        const r = await s.deploy({ onOutput: (out) => (PAST_PREFLIGHT.test(out) ? del() : undefined) });
        clearTimeout(timer);
        await deletion;
        return r;
      };
      let r = await attempt(20_000);
      if (r.status !== 0 && /preflight|step 1\b/i.test(r.output) && !/health/i.test(r.output)) {
        // The hook was earlier than the preflight: set the secret again and retry once, later.
        const set = await s.setSecret("apiKey", secret);
        expect(set.status, set.output).toBe(0);
        r = await attempt(45_000);
      }
      expect(r.status, `deploy with the secret removed after the preflight must fail:\n${tail(r.output)}`).not.toBe(0);
      expect(r.output, "fails at the health step").toMatch(/health/i);
      expect(r.output, "names the error code").toContain("SEC.MISSING");
    }, 45 * 60_000);
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-002 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
