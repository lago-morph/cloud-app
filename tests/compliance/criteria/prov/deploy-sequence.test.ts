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
 * 2. "On Cloudflare, deploy needs no permission on API tokens: with a credential that has no
 *    'Account API Tokens' permission at all, the preflight passes and the deploy succeeds"
 *    (DEC-0550, DEC-0551): a further stage is deployed, and its secret set, with DEC-0551's
 *    everyday token (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_R2_TOKEN_PERMISSION`, created by the
 *    driver, `harness/test-tokens.ts`; otherwise a missing prerequisite). The deploy exits 0, the
 *    health check answers 204, the stage has no per-stage R2 API token, and the account lists no
 *    API token the deploy created. Needs D1.
 *    The same stage, with the same token, checks PROV-REQ-002's DEC-0544 amendment: after
 *    `stop` the stage stops answering and its stage record `framework/<app>/<stage>/stage.json`
 *    in `sst-state` holds `{ "stopped": true }`; a `deploy` without `--start` exits 0, says the
 *    stage is stopped and how to start it, and leaves it not answering; `deploy --start` exits 0,
 *    deletes the record, and the stage answers its health check again.
 * 2b. "Without the account's R2 signing credential, deploy names it and `setup-account` and stops
 *    before creating anything" (DEC-0550), and the preflight names every absent shared resource
 *    in one message (PROV-REQ-002 step 1): under the further-stage lock (no other stage deploys
 *    meanwhile), the signing record is replaced by one written before the backup bucket existed
 *    (same credentials, no `deniedBuckets`: it counts as absent, PROV §2 "Signing record") and
 *    the backup bucket's lifecycle rule `framework-backups-retention` is removed; a deploy of a
 *    never-deployed stage then exits non-zero with one line `the account's shared resources are
 *    missing (…); run setup-account --target cloudflare first` naming both, and creates nothing.
 *    Both are restored byte for byte afterwards, also on failure, and read back. Running stages
 *    keep working meanwhile (their Worker secrets hold the same credentials). Needs no D1.
 * 3. "A clean deploy passes the health check": the first deploy of a shared stage exits 0
 *    (after setting the declared secret when the first deploy asks for it), and the stage's
 *    health endpoint answers 204.
 * 4. "A failing migration stops the deploy with failure status, the previous version answers
 *    again afterwards, and the output names the failed step, the migration file, the stage's
 *    state ('previous version restarted'), and the next action": with the data fixture loaded,
 *    a deploy of the `unique-fail` overlay (ROUTES.md) exits non-zero; its output names the
 *    migrate step, `0001_unique_label`, "previous version restarted" and a next action; the
 *    stage answers `schema-version` v1 again with the fixture unchanged and one database. The
 *    deploy copied the database first, and says which copy ran (DEC-0545): `copied database
 *    <old> into <new>: D1 native export/import`, or `…: row-by-row copy (<reason>)`.
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
 * Cloud usage (estimate, D-T.md): clauses 1 and 2b create nothing (≈ 25 Cloudflare API requests
 * for the probes, the lifecycle read and writes and the scoped R2 tokens). Clause 2: 4 deploys,
 * stop, and one remove of one stage, ≈ 50 D1 rows written; ≈ 15 API requests by the hooks and
 * probes. Clauses 3–5: 4 deploys and one remove of one stage; D1 ≈ 50 rows written by the
 * first deploy, 8 fixture rows (+ index entries ≈ 16), ≈ 60 rows written into the migration
 * copy that is then dropped; ≈ 150 rows written, ≈ 200 read in all; ≈ 15 API requests by the
 * hooks and probes.
 */
import { afterAll, describe, expect, it } from "vitest";
import { CLOUD_WAITS, newTestStage, tag, target, waitFor, type ComplianceClient } from "../../harness/index.js";
import { TEST_TOKEN_PREFIX } from "../../harness/test-tokens.js";
import { accountTokens, backupLifecycle, BACKUP_RULE_ID, legacySigningRecordText, putBackupLifecycle, readSigningRecordText, writeSigningRecordText, type LifecycleRule } from "../_cloud/account.js";
import { cloudHooks as hooksFor } from "../_cloud/index.js";
import { readObjectIfExists, STATE_BUCKET } from "../_cloud/r2.js";
import { listStageResources, stageDatabases, stageRecordKey, stageResourceDetails } from "../_cloud/stage-resources.js";
import { requireDatabaseRoom } from "../_cloud/d1.js";
import { acquireLock, scratchCopy } from "../core/support/processes.js";
import { isLocal, REFERENCE_DIR, uniqueValue } from "../core/support/repo.js";
import { restrictedToken } from "./support/restricted-token.js";
import { healthStatus, restoreCommitted, runCli, sharedStage, tail, withCloudStage, type CloudStage, type CommandResult } from "./support/stage.js";

/** Output showing the deploy is past step 1 (any later step, or the provisioning tool running). */
const PAST_PREFLIGHT = /\bstep\s*[2-6]\b|find the databases|long-lived infrastructure|\bsst\b|pulumi|\bdeploying\b|\bupdating\b/i;

/** Token names the hooks and the driver create meanwhile (`_cloud/r2.ts`, `harness/test-tokens.ts`): not the deploy's. */
const HARNESS_TOKEN = (name: string): boolean => name.startsWith("compliance-r2read-") || name.startsWith("compliance-r2scoped-") || name.startsWith(TEST_TOKEN_PREFIX);

/** Whether the app answers its own route with 200 (a stopped stage does not). */
async function answers(c: ComplianceClient): Promise<boolean> {
  try {
    return (await c.get("/api/ref/deployment")).status === 200;
  } catch {
    return false;
  }
}

/**
 * Deploys a never-deployed stage of a scratch copy with an environment change; removes anything
 * it created. `around` runs under the further-stage lock: its `before` just before the deploy,
 * its `after` right after it (also when the deploy or `before` failed).
 */
async function deployNewStage(
  env: { readonly unset?: readonly string[]; readonly env?: Readonly<Record<string, string>> },
  around?: { readonly before: () => Promise<void>; readonly after: () => Promise<void> },
): Promise<{ result: CommandResult; left: string[]; stage: string }> {
  const t = target().target;
  // A correct deploy creates nothing here; a defective one could create a database, so the
  // further-stage lock and the database cap apply as for any further stage.
  const release = await acquireLock("further-stage", 60 * 60_000);
  const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov002");
  const stage = newTestStage();
  try {
    await requireDatabaseRoom(1, "PROV-AC-002 (stopped deploy)");
    let result: CommandResult;
    try {
      await around?.before();
      result = await runCli(["deploy", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 10 * 60_000, ...env });
    } finally {
      await around?.after();
    }
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

    it(tag("PROV-AC-002", "Cloudflare: without the account's R2 signing credential, deploy names it and setup-account in one message with every absent shared resource, and stops before creating anything"), async () => {
      let record: string | undefined;
      let rules: LifecycleRule[] | undefined;
      const { result, left } = await deployNewStage({}, {
        async before() {
          record = await readSigningRecordText();
          rules = await backupLifecycle();
          // A record written before the backup bucket existed counts as absent (PROV §2 "Signing record").
          if (record !== undefined) await writeSigningRecordText(legacySigningRecordText(record));
          if (rules !== undefined) await putBackupLifecycle(rules.filter((r) => r.id !== BACKUP_RULE_ID));
        },
        async after() {
          const problems: string[] = [];
          try {
            if (record !== undefined) await writeSigningRecordText(record);
          } finally {
            if (rules !== undefined) await putBackupLifecycle(rules);
          }
          if ((await readSigningRecordText()) !== record) problems.push("the signing record");
          if (JSON.stringify(await backupLifecycle()) !== JSON.stringify(rules)) problems.push("the backup bucket's lifecycle rules");
          if (problems.length > 0) throw new Error(`PROV-AC-002: restoring ${problems.join(" and ")} failed; run setup-account --target cloudflare (with the setup token) to repair the account`);
        },
      });
      expect(result.status, `deploy without the signing credential must fail:\n${tail(result.output)}`).not.toBe(0);
      const line = result.output.split("\n").find((l) => l.includes("the account's shared resources are missing (")) ?? "";
      expect(line, `one message names the absent shared resources:\n${tail(result.output)}`).not.toBe("");
      expect(line, "the message names the R2 signing credential").toContain("R2 signing credential prototype-r2-signing");
      expect(line, "the message names the backup bucket's lifecycle rule").toContain("lifecycle rule of R2 bucket prototype-backups (PAR-311)");
      expect(line, "the message points to setup-account").toContain("run setup-account --target cloudflare first");
      expect(left, "resources the stopped deploy created").toEqual([]);
    }, 15 * 60_000);
  });

  describe("PROV-AC-002 everyday token: deploy needs no permission on API tokens; stop and deploy --start (cloud, D1)", () => {
    it(tag("PROV-AC-002", "Cloudflare: with DEC-0551's everyday token (no Account API Tokens permission at all) the preflight passes and the deploy succeeds; deploy creates no API token"), async () => {
      const token = restrictedToken();
      const t = target().target;
      const tokensBefore = new Set((await accountTokens()).map((x) => x.id));
      await withCloudStage({ appDir: REFERENCE_DIR, app: "reference", secrets: { apiKey: uniqueValue("dt1prov002e") }, databases: 1, env: { CLOUDFLARE_API_TOKEN: token } }, async (s) => {
        const r = await s.deployReady();
        expect(r.status, "the deploy with the everyday token exits 0 (its preflight and health step passed)").toBe(0);
        expect(r.output.includes(token), "the output does not print the token").toBe(false);
        expect(await healthStatus(s.client()), "the stage's health check").toBe(204);
        expect((await stageResourceDetails(s)).tokens, "per-stage R2 API tokens (DEC-0550: deploy creates none)").toEqual([]);
        const created = (await accountTokens()).filter((x) => !tokensBefore.has(x.id) && !HARNESS_TOKEN(x.name));
        expect(created.map((x) => x.name), "API tokens the deploy created").toEqual([]);

        // DEC-0544: a stopped stage stays stopped through a deploy unless --start.
        const c = s.client();
        const record = stageRecordKey(s);
        const stop = await s.cli(["stop", "--target", t, "--stage", s.stage]);
        expect(stop.status, `stop:\n${tail(stop.output)}`).toBe(0);
        await waitFor(async () => ((await answers(c)) ? undefined : true), { what: "the stopped stage to stop answering", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 });
        expect(JSON.parse((await readObjectIfExists(STATE_BUCKET, record)) ?? "null"), "the stage record after stop").toEqual({ stopped: true });

        const kept = await s.deploy();
        expect(kept.status, `deploy of the stopped stage without --start:\n${tail(kept.output)}`).toBe(0);
        expect(kept.output, "the deploy says the stage is stopped").toMatch(/\bstopped\b/i);
        expect(kept.output, "the deploy says how to start it").toMatch(/--start|\bstart\b/);
        // The code deploy may turn the route on for a few seconds before step 6 turns it off again.
        await waitFor(async () => ((await answers(c)) ? undefined : true), { what: "the stage to stay stopped after the deploy", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 });
        for (let i = 0; i < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          expect(await answers(c), `the stopped stage answers after a deploy without --start (sample ${String(i + 1)})`).toBe(false);
        }
        expect(await readObjectIfExists(STATE_BUCKET, record), "the stage record after a deploy without --start").toBeDefined();

        const started = await s.cli(["deploy", "--target", t, "--stage", s.stage, "--start"]);
        expect(started.status, `deploy --start:\n${tail(started.output)}`).toBe(0);
        expect(await readObjectIfExists(STATE_BUCKET, record), "the stage record after deploy --start").toBeUndefined();
        let streak = 0;
        await waitFor(
          async () => {
            streak = (await healthStatus(c)) === 204 ? streak + 1 : 0;
            return streak >= 3 ? true : undefined;
          },
          { what: "the started stage answering its health check (three 204s in a row)", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 },
        );
      });
    }, 60 * 60_000);
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
      // DEC-0545: a deploy that copies the database says which copy ran.
      expect(failed.output, "names which database copy ran").toMatch(/copied database \S+-db-\d+ into \S+-db-\d+: (?:D1 native export\/import|row-by-row copy \([^)]+\))/);

      const c = s.client();
      // The previous version is restarted explicitly; a workers.dev route change is visible within a bound (DEC-0090).
      // While the turn-on propagates, the edge answers 200 and 404 (`error code: 1042`) alternately
      // (run k9cc5zjcbm5mrkc: 404, 404, 404, 200, 404), so the wait ends on three 200s in a row.
      let streak = 0;
      await waitFor(
        async () => {
          streak = (await c.get("/api/ref/schema-version")).status === 200 ? streak + 1 : 0;
          return streak >= 3 ? true : undefined;
        },
        { what: "the previous version answering again (three 200s in a row)", timeoutMs: CLOUD_WAITS.routeToggleMs, intervalMs: 1_000 },
      );
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
