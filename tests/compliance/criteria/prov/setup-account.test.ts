/**
 * PROV-AC-004 (provisioning.md §4; milestone): "Running `setup-account` twice changes nothing
 * the second time, including in the state home, the account settings record and the email setup.
 * Deploying without it fails with a clear message. With a token lacking one email permission of
 * DEC-0515, `setup-account` names that permission and changes nothing; with a token lacking
 * 'Account API Tokens Write' while the account's R2 signing credential is absent, `setup-account`
 * names that permission and changes nothing. With a token lacking 'Email Sending Read', a
 * production stage's `deploy` names that permission and changes nothing (DEC-0553)."
 *
 * The shared resources `setup-account` creates on Cloudflare (PROV-REQ-004 as amended): the log
 * bucket and state home, the email setup, the backup bucket `prototype-backups` with its
 * lifecycle rule `framework-backups-retention` (PAR-311, DEC-0543), and the R2 signing
 * credential: the token `prototype-r2-signing` (allowed "Workers R2 Storage Bucket Item Write" on
 * the account, denied it on the 4 account buckets) and its record `framework/r2-signing.json`
 * (DEC-0550). Its `workers.dev` subdomain is `pf-<12 random>` and never derived from the account
 * ID (DEC-0552, PAR-320).
 *
 * Tests, in file order (they share the account):
 * 1. Fresh account only (deferred, below): deploying without `setup-account` fails clearly and
 *    creates nothing; then `setup-account` registers a subdomain `pf-<12 of a–z0–9>`.
 * 2. "Account API Tokens Write" clause: the credential is made to read as absent by replacing
 *    the record with one written before the backup bucket existed (same credentials, no
 *    `deniedBuckets`, DEC-0550 "Re-run of setup-account"), so running stages keep working; then
 *    `setup-account` with the setup token minus "Account API Tokens Write" (it keeps "… Read" to
 *    read its own policies; `COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_API_TOKENS_WRITE`, created by the
 *    driver) must exit non-zero, name the permission and change nothing (snapshot). The record is
 *    restored byte for byte afterwards.
 * 3. A re-run replaces an old record: after `setup-account`, the record is complete; it is
 *    replaced by its pre-batch form again, and the next `setup-account` exits 0 and writes a
 *    complete record for a new token: the old `prototype-r2-signing` token is gone, the new one
 *    has DEC-0550's policies. This replaces the account's credential: stages deployed before
 *    hold the old one until their next deploy (every deploy copies the record, step 5), so run
 *    this milestone pass with no other stage running (prodcheck is redeployed by every cloud run).
 *    The test checks this first and refuses (blocked, naming the deployed stages and the command
 *    for a pass of its own) while any Worker other than the mail sink, prodcheck and criterion
 *    production stages exists (DEC-0560).
 * 4. Idempotence: `setup-account` runs once, the account's shared state is snapshotted,
 *    `setup-account` runs again, and the snapshot must be identical. After the first run the
 *    backup bucket's retention rule, the signing record (every field, the 4 denied buckets, its
 *    access key ID = its token ID), the signing token's policies and the subdomain (not derived
 *    from the account ID) are as specified. The snapshot covers the shared log bucket, the state
 *    home and the backup bucket (existence, settings, CORS and lifecycle rules), every object of
 *    the state home (key, ETag, last-modified, size; the records included), every object of the
 *    log bucket that is not a log entry, the signing token's ID and policies, the workers.dev
 *    subdomain (by digest only, DEC-0086), and the email setup.
 * 5. Email permission clause: `setup-account` with the setup token lacking "Email Routing
 *    Addresses Write" (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_PERMISSION`) names it and
 *    changes nothing.
 * 6. DEC-0553 clause: a production stage's `deploy` with the everyday token lacking "Email
 *    Sending Read" (`COMPLIANCE_CLOUDFLARE_TOKEN_WITHOUT_EMAIL_SENDING_READ`) names that
 *    permission and changes nothing. The production stage is a new name in a scratch copy, with
 *    prodcheck's values copied as its committed values file; a deploy that wrongly gets past the
 *    preflight is removed again.
 *
 * "Deploying without it": needs an account on which `setup-account` has never run. The test
 * never deletes the shared resources (they hold other stages' state and retained log entries),
 * so it needs a second Cloudflare account. The owner deferred it (2026-10-25: "Defer the tests
 * that require another account"; DEC-0532): the driver records the clause `not-run` with
 * "deferred: needs a second Cloudflare account (owner, 2026-10-25)" (`harness/expected.ts`), and
 * the tests are defined only when the operator says the account is fresh
 * (`COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT=1`, with the email domain to record in
 * `COMPLIANCE_CLOUDFLARE_EMAIL_DOMAIN`), for when the deferral is lifted.
 *
 * Cloud usage (estimate, D-T.md): no D1 at all (setup-account creates R2 buckets only; the
 * stopped deploy creates nothing). ≈ 250 Cloudflare API requests (8 snapshots of ≈ 28 each,
 * the scoped R2 tokens of 4 record writes ≈ 16; the setup-account runs' own requests not
 * counted), plus the state-home and log-bucket listings through R2's S3 endpoint (one request
 * per 1,000 objects).
 */
import { describe, expect, it } from "vitest";
import { newTestStage, prerequisiteMissing, tag, target } from "../../harness/index.js";
import { NO_API_TOKENS_WRITE_ENV, NO_EMAIL_PERMISSION_ENV, NO_EMAIL_SENDING_READ_ENV } from "../../harness/test-tokens.js";
import {
  ACCOUNT_BUCKETS,
  REPAIR_COMMAND,
  backupLifecycle,
  legacySigningRecordText,
  parseSigningRecord,
  permissionGroupNames,
  readSigningRecordText,
  retentionRuleProblems,
  signingPolicyProblems,
  signingRecordProblems,
  signingTokens,
  tokenDetail,
  writeSigningRecordText,
} from "../_cloud/account.js";
import { accountId, cfApi, cfOk } from "../_cloud/api.js";
import { BACKUP_BUCKET, LOG_BUCKET, listObjects, STATE_BUCKET } from "../_cloud/r2.js";
import { randomBytes } from "node:crypto";
import { accountWorkers, listStageResources, MAIL_SINK, sharedResources } from "../_cloud/stage-resources.js";
import { MARKER_PREFIX, stageOfMarkerKey } from "../../harness/criterion-stages.js";
import { deleteCriterionMarker, writeCriterionMarker } from "../_cloud/criterion-markers.js";
import { requireCloudD1 } from "../_cloud/d1.js";
import { listKeys } from "../_cloud/r2.js";
import { sinkAddress } from "../../../../packages/framework/src/provision/cloudflare/email.js";
import { sinkMail } from "../cli/support/admins.js";
import { createVerifiedAccount, expectAnswer, httpBrowser, signIn, testDisplayName, testIp, testPassword, type Account, type AuthBrowser } from "../pwd/support.js";
import { emailState, zoneOf } from "../_cloud/email.js";
import { emailDomain } from "../cli/support/admins.js";
import { scratchCopy } from "../core/support/processes.js";
import { isLocal, parameterNumber, REFERENCE_DIR } from "../core/support/repo.js";
import { deployOrigin, newProductionStage, runCli, tail } from "./support/stage.js";

const FRESH_ENV = "COMPLIANCE_CLOUDFLARE_FRESH_ACCOUNT";
const FRESH_DOMAIN_ENV = "COMPLIANCE_CLOUDFLARE_EMAIL_DOMAIN";
/** Deferred by the owner (DEC-0532): defined only on an account the operator says is fresh. */
const itOnFreshAccount = process.env[FRESH_ENV] === "1" ? it : undefined;
/** DEC-0515's email permissions, as an output naming one of them may write it ("Write" or "Edit"). */
const EMAIL_PERMISSION = /Email Sending|Email Routing Addresses|Email Routing Rules|DNS (?:Write|Edit)|Zone Settings|Zone Read/i;
/** "Account API Tokens Write", as an output may write it ("Write" or the dashboard's "Edit"). */
const API_TOKENS_WRITE = /Account API Tokens:? (?:Write|Edit)/i;
/** "Email Sending Read" (DEC-0553). */
const EMAIL_SENDING_READ = /Email Sending:? Read/i;
/** A log entry's key (LOG-REQ-004): `<app>/<stage>/<yyyy>/<mm>/<dd>/<file>`. */
const LOG_ENTRY_KEY = /^[a-z0-9]+\/[a-z0-9-]+\/\d{4}\/\d{2}\/\d{2}\/[^/]+$/;

async function bucketSettings(bucket: string): Promise<unknown> {
  const base = `/accounts/${accountId()}/r2/buckets/${encodeURIComponent(bucket)}`;
  const out: Record<string, unknown> = {};
  for (const [name, path] of [["bucket", base], ["cors", `${base}/cors`], ["lifecycle", `${base}/lifecycle`]] as const) {
    const r = await cfApi("GET", path);
    out[name] = { status: r.status, result: r.body?.result ?? null };
  }
  return out;
}

/** The account's `workers.dev` subdomain (personal: compared, never printed). */
async function subdomain(): Promise<string> {
  const sub = await cfOk<{ subdomain?: string }>("reading the account's workers.dev subdomain", "GET", `/accounts/${accountId()}/workers/subdomain`);
  return sub.subdomain ?? "";
}

/** The `prototype-r2-signing` tokens with their policies. */
async function signingTokenState(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const t of await signingTokens()) out.push({ id: t.id, policies: (await tokenDetail(t.id)).policies });
  return out;
}

async function accountSnapshot(): Promise<unknown> {
  const domain = await emailDomain();
  return {
    email: await emailState(await zoneOf(domain), domain),
    shared: await sharedResources(),
    logBucket: await bucketSettings(LOG_BUCKET),
    stateHome: await bucketSettings(STATE_BUCKET),
    backupBucket: await bucketSettings(BACKUP_BUCKET),
    stateObjects: await listObjects(STATE_BUCKET, ""),
    logBucketNonEntries: (await listObjects(LOG_BUCKET, "")).filter((o) => !LOG_ENTRY_KEY.test(o.key)),
    signingTokens: await signingTokenState(),
  };
}

/** What the signing credential lacks after a successful `setup-account` (DEC-0550); empty when complete. */
async function signingCredentialProblems(): Promise<string[]> {
  const text = await readSigningRecordText();
  if (text === undefined) return ["the signing record framework/r2-signing.json does not exist"];
  const record = parseSigningRecord(text);
  const problems = signingRecordProblems(record);
  const tokens = await signingTokens();
  if (tokens.length !== 1 || tokens[0]?.id !== record.tokenId) problems.push(`the account has ${String(tokens.length)} token(s) named prototype-r2-signing, not exactly the record's`);
  for (const t of tokens) problems.push(...signingPolicyProblems((await tokenDetail(t.id)).policies, accountId(), await permissionGroupNames()).map((p) => `token ${t.id}: ${p}`));
  return problems;
}

/** The reference app's long-lived production stage's Worker (COMPL §2 "Production-check stage"). */
const PRODCHECK_WORKER = "reference-prodcheck";

/**
 * Clause 3 replaces the account's signing token, so it refuses (a missing prerequisite) while any
 * other stage is deployed (DEC-0560). Exempt are exactly the reference app's `prodcheck` (which the
 * clause redeploys with the new credential) and the reference app's criterion production stages
 * that carry a marker (`compliance/criterion-stages/<stage>.json`); the mail sink's Worker is an
 * account resource, not a stage. 1 Cloudflare API request and one state-home listing.
 */
async function requireNoOtherStages(): Promise<void> {
  const marked = new Set((await listKeys(STATE_BUCKET, MARKER_PREFIX)).map(stageOfMarkerKey).filter((x): x is string => x !== undefined).map((stage) => `reference-${stage}`));
  const others = (await accountWorkers()).filter((w) => w !== MAIL_SINK && w !== PRODCHECK_WORKER && !marked.has(w)).sort();
  if (others.length > 0) {
    prerequisiteMissing(
      `the re-run clause replaces the account's R2 signing token, which every deployed stage holds until its next deploy, so it runs only with no other stage deployed; deployed now: ${others.join(", ")}. ` +
        "Remove them (or let the next cloud run clean its test stages), then run the milestone pass for PROV-AC-004 alone, with no run stage: npm run compliance -- --target cloudflare --milestone --only PROV-AC-004 --base-url https://unused.invalid",
    );
  }
}

/**
 * After the signing token was replaced: redeploys the reference app's `prodcheck` (when it
 * exists) from a scratch copy, so its Worker secrets hold the new credential (every deploy copies
 * the record, PROV-REQ-002 step 5), then shows a ticket round trip on it: a verified user (a
 * sink address under `t.<domain>`, as COMPL §2's prodcheck parts do; it is left with no role),
 * an upload through an upload ticket (R2 checks the ticket's signature) and the bytes read back
 * through a download ticket. The file is deleted afterwards.
 */
async function refreshProdcheck(t: string): Promise<void> {
  if (!(await accountWorkers()).includes(PRODCHECK_WORKER)) return;
  const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004-prodcheck");
  try {
    const r = await runCli(["deploy", "--target", t, "--stage", "prodcheck"], { cwd: copy.dir, timeoutMs: 20 * 60_000 });
    expect(r.status, `redeploy of prodcheck with the new signing credential:\n${tail(r.output)}`).toBe(0);
    const origin = deployOrigin(r.output);
    expect(origin, "the prodcheck deploy printed its origin").toBeDefined();
    const domain = await emailDomain();
    const a: Account = { email: sinkAddress(domain, `prov-ac-004-${randomBytes(6).toString("hex")}`), password: testPassword(), displayName: testDisplayName("PROV 004") };
    const b: AuthBrowser = { ...httpBrowser({ baseUrl: origin ?? "" }), mail: sinkMail() };
    await createVerifiedAccount(b, a, testIp());
    expectAnswer(await signIn(b, a.email, a.password, { ip: testIp() }), 200);
    const name = `dt1/prov004-${randomBytes(6).toString("hex")}.txt`;
    const bytes = new TextEncoder().encode(`prov-ac-004 ${name}`);
    const cookie = Object.entries(b.cookies()).map(([k, v]) => `${k}=${v}`).join("; ");
    try {
      const up = expectAnswer(await b.post("/api/files/upload-ticket", { name, contentType: "text/plain" }), 200).json<{ ticket: { url: string } }>().ticket;
      const put = await fetch(new URL(up.url, b.publicOrigin), { method: "PUT", headers: { "content-type": "text/plain" }, body: bytes, signal: AbortSignal.timeout(30_000) });
      expect(put.status >= 200 && put.status < 300, `the upload through prodcheck's ticket (signed with the new credential): HTTP ${String(put.status)}`).toBe(true);
      const down = expectAnswer(await b.post("/api/files/download-ticket", { name }), 200).json<{ ticket: { url: string } }>().ticket;
      const got = await fetch(new URL(down.url, b.publicOrigin), { signal: AbortSignal.timeout(30_000) });
      expect(got.status, "the download through prodcheck's ticket").toBe(200);
      expect(new Uint8Array(await got.arrayBuffer()), "the downloaded bytes").toEqual(bytes);
    } finally {
      await fetch(new URL(`/api/files/content?name=${encodeURIComponent(name)}`, b.publicOrigin), { method: "DELETE", headers: { cookie, origin: b.publicOrigin }, signal: AbortSignal.timeout(30_000) });
    }
  } finally {
    await copy.remove();
  }
}

function token(env: string, what: string): string {
  const value = process.env[env];
  if (value === undefined || value === "") prerequisiteMissing(`needs a Cloudflare API token ${what} in ${env} (the compliance driver creates one for a run that selects PROV-AC-004)`);
  return value;
}

if (!isLocal()) {
  describe("PROV-AC-004 setup-account (cloud, milestone, no D1)", () => {
    itOnFreshAccount?.(tag("PROV-AC-004", "deploying on an account without setup-account fails with a clear message and creates nothing"), async () => {
      if ((await sharedResources()).logBucket) prerequisiteMissing(`${FRESH_ENV}=1 is set, but the shared log bucket ${LOG_BUCKET} exists: the account is not fresh`);
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004");
      const stage = newTestStage();
      try {
        const r = await runCli(["deploy", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(r.status, `deploy without setup-account must fail:\n${tail(r.output)}`).not.toBe(0);
        expect(r.output, "the message tells the owner to run setup-account").toContain("setup-account");
        expect(r.output, "the message names the missing shared resource").toContain(LOG_BUCKET);
        expect(await listStageResources({ target: t, app: "reference", stage }), "resources the stopped deploy created").toEqual([]);
      } finally {
        await copy.remove();
      }
    }, 15 * 60_000);

    itOnFreshAccount?.(tag("PROV-AC-004", "on an account without a workers.dev subdomain, setup-account registers pf-<random>, never derived from the account ID (DEC-0552, PAR-320)"), async () => {
      const domain = process.env[FRESH_DOMAIN_ENV] ?? "";
      if (domain === "") prerequisiteMissing(`${FRESH_ENV}=1 needs the email domain to record in ${FRESH_DOMAIN_ENV}`);
      const before = await cfApi<{ subdomain?: string }>("GET", `/accounts/${accountId()}/workers/subdomain`);
      if (before.status === 200 && (before.body?.result.subdomain ?? "") !== "") prerequisiteMissing("the fresh account already has a workers.dev subdomain");
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004");
      try {
        const r = await runCli(["setup-account", "--target", t, "--email-domain", domain], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(r.status, `setup-account on the fresh account:\n${tail(r.output)}`).toBe(0);
        const sub = await subdomain();
        const random = parameterNumber("PAR-320");
        expect(new RegExp(`^pf-[a-z0-9]{${String(random)}}$`).test(sub), `the registered subdomain is pf- and ${String(random)} letters and digits`).toBe(true);
        expect(sub.includes(accountId().slice(0, 12)), "the subdomain is not derived from the account ID").toBe(false);
      } finally {
        await copy.remove();
      }
    }, 15 * 60_000);

    it(tag("PROV-AC-004", "with a token lacking Account API Tokens Write while the account's R2 signing credential is absent, setup-account names that permission and changes nothing"), async () => {
      const restricted = token(NO_API_TOKENS_WRITE_ENV, 'with the setup set but without "Account API Tokens Write"');
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004-tok");
      const original = await readSigningRecordText();
      try {
        // A record without `deniedBuckets` counts as absent; the credentials stay the same.
        if (original !== undefined) await writeSigningRecordText(legacySigningRecordText(original));
        const before = await accountSnapshot();
        const r = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000, env: { CLOUDFLARE_API_TOKEN: restricted } });
        expect(r.status, `setup-account without Account API Tokens Write must fail while the credential is absent:\n${tail(r.output)}`).not.toBe(0);
        expect(r.output, "setup-account names Account API Tokens Write").toMatch(API_TOKENS_WRITE);
        expect(r.output.includes(restricted), "the output does not print the token").toBe(false);
        expect(await accountSnapshot(), "the account after the refused setup-account").toEqual(before);
      } finally {
        await copy.remove();
        const problems: string[] = [];
        try {
          if (original !== undefined) await writeSigningRecordText(original);
          if ((await readSigningRecordText()) !== original) problems.push("the signing record read back differs from the original");
        } catch (error) {
          problems.push(`restoring the signing record: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (problems.length > 0) {
          const message = `PROV-AC-004: RESTORING THE ACCOUNT FAILED (${problems.join("; ")}). Every deploy on this account now stops at its preflight. Repair it now with: ${REPAIR_COMMAND}`;
          process.stderr.write(`\n[d-t1] ${message}\n\n`);
          throw new Error(message);
        }
      }
    }, 30 * 60_000);

    it(tag("PROV-AC-004", "a re-run of setup-account replaces a signing record written before the backup bucket existed: a new token with every account bucket denied, the old token deleted; prodcheck, redeployed, signs working tickets with it"), async () => {
      const t = target().target;
      if ((await accountWorkers()).includes(PRODCHECK_WORKER)) requireCloudD1(t);
      await requireNoOtherStages();
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004-rerun");
      let old: string | undefined;
      let oldTokenId: unknown;
      try {
        const first = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(first.status, `setup-account:\n${tail(first.output)}`).toBe(0);
        expect(await signingCredentialProblems(), "the signing credential after setup-account").toEqual([]);
        old = await readSigningRecordText();
        oldTokenId = parseSigningRecord(old ?? "{}").tokenId;

        await writeSigningRecordText(legacySigningRecordText(old ?? "{}"));
        const rerun = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(rerun.status, `setup-account over the old record:\n${tail(rerun.output)}`).toBe(0);
        expect(await signingCredentialProblems(), "the signing credential after the re-run").toEqual([]);
        const fresh = parseSigningRecord((await readSigningRecordText()) ?? "{}");
        expect(fresh.tokenId, "the re-run created a new token").not.toBe(oldTokenId);
        expect([...((fresh.deniedBuckets as unknown[] | undefined) ?? [])].sort(), "the new record's denied buckets").toEqual(expect.arrayContaining([...ACCOUNT_BUCKETS].sort()));
        expect((await signingTokens()).map((x) => x.id), "the old prototype-r2-signing token was deleted").not.toContain(oldTokenId);

        // Stages deployed before hold the old credential: prodcheck picks up the new one by a deploy.
        await refreshProdcheck(t);
      } finally {
        await copy.remove();
        // Never leave the account without a working credential: restore the old record while its
        // token still exists, or fail loudly with the repair command.
        let problems: string[];
        try {
          problems = await signingCredentialProblems();
          if (problems.length > 0 && old !== undefined && (await signingTokens()).some((x) => x.id === oldTokenId)) {
            await writeSigningRecordText(old);
            problems = await signingCredentialProblems();
          }
        } catch (error) {
          problems = [`checking the signing credential: ${error instanceof Error ? error.message : String(error)}`];
        }
        if (problems.length > 0) {
          const message = `PROV-AC-004: THE ACCOUNT'S R2 SIGNING CREDENTIAL IS BROKEN (${problems.join("; ")}). Every deploy on this account now stops at its preflight. Repair it now with: ${REPAIR_COMMAND}`;
          process.stderr.write(`\n[d-t1] ${message}\n\n`);
          throw new Error(message);
        }
      }
    }, 60 * 60_000);

    it(tag("PROV-AC-004", "running setup-account twice changes nothing the second time, including in the state home, the account settings record, the email setup, the backup bucket and the R2 signing credential"), async () => {
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "d-t1-prov004");
      try {
        const first = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(first.status, `first setup-account:\n${tail(first.output)}`).toBe(0);
        const before = await accountSnapshot();
        expect((before as { shared: Record<string, unknown> }).shared, "shared resources after the first run").toMatchObject({ logBucket: true, stateHome: true, backupBucket: true });
        expect(retentionRuleProblems(await backupLifecycle(), parameterNumber("PAR-311")), "the backup bucket's lifecycle rule (PAR-311)").toEqual([]);
        expect(await signingCredentialProblems(), "the account's R2 signing credential (DEC-0550)").toEqual([]);
        const sub = await subdomain();
        expect(sub, "the account has a workers.dev subdomain").not.toBe("");
        expect(sub.includes(accountId().slice(0, 12)), "the workers.dev subdomain is not derived from the account ID (DEC-0552)").toBe(false);

        const second = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000 });
        expect(second.status, `second setup-account:\n${tail(second.output)}`).toBe(0);
        expect(await accountSnapshot(), "the account's shared state after the second run").toEqual(before);
      } finally {
        await copy.remove();
      }
    }, 30 * 60_000);

    it(tag("PROV-AC-004", "with a token lacking one email permission of DEC-0515, setup-account names that permission and changes nothing"), async () => {
      const restricted = token(NO_EMAIL_PERMISSION_ENV, "lacking exactly one email permission of DEC-0515");
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "t2-prov004-perm");
      try {
        const before = await accountSnapshot();
        const setup = await runCli(["setup-account", "--target", t], { cwd: copy.dir, timeoutMs: 10 * 60_000, env: { CLOUDFLARE_API_TOKEN: restricted } });
        expect(setup.status, `setup-account with the restricted token must fail:\n${tail(setup.output)}`).not.toBe(0);
        expect(setup.output, "setup-account names the missing email permission").toMatch(EMAIL_PERMISSION);
        expect(setup.output.includes(restricted), "the output does not print the token").toBe(false);
        expect(await accountSnapshot(), "the account after the refused setup-account").toEqual(before);
      } finally {
        await copy.remove();
      }
    }, 30 * 60_000);

    it(tag("PROV-AC-004", "with a token lacking Email Sending Read, a production stage's deploy names that permission and changes nothing (DEC-0553)"), async () => {
      const restricted = token(NO_EMAIL_SENDING_READ_ENV, 'with the everyday set but without "Email Sending Read"');
      const t = target().target;
      const copy = await scratchCopy(REFERENCE_DIR, "t2-prov004-send");
      // A production stage: any name not starting with test- (PROV-REQ-005), with a committed values file of its own.
      const stage = newProductionStage("p004");
      // DEC-0560: marked before the deploy, so a later run's sweep removes it if this process dies.
      await writeCriterionMarker(stage);
      let cleaned = false;
      try {
        const before = await accountSnapshot();
        await copy.write(`config/${t}/${stage}.json`, await copy.read(`config/${t}/prodcheck.json`));
        const deploy = await runCli(["deploy", "--target", t, "--stage", stage], { cwd: copy.dir, timeoutMs: 10 * 60_000, env: { CLOUDFLARE_API_TOKEN: restricted } });
        const left = await listStageResources({ target: t, app: "reference", stage, production: true });
        if (left.length > 0) await runCli(["remove", "--target", t, "--stage", stage, "--confirm-production", stage], { cwd: copy.dir, timeoutMs: 20 * 60_000 });
        cleaned = (await listStageResources({ target: t, app: "reference", stage, production: true })).length === 0;
        expect(deploy.status, `deploy of the production stage with the restricted token must fail:\n${tail(deploy.output)}`).not.toBe(0);
        expect(deploy.output, "deploy names Email Sending Read").toMatch(EMAIL_SENDING_READ);
        expect(deploy.output.includes(restricted), "the output does not print the token").toBe(false);
        expect(left, "resources the refused deploy created").toEqual([]);
        expect(await accountSnapshot(), "the account after the refused deploy").toEqual(before);
      } finally {
        await copy.remove();
        // The marker goes once nothing of the stage is left; otherwise a later run's sweep removes the stage.
        if (cleaned) await deleteCriterionMarker(stage);
      }
    }, 45 * 60_000);
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on local runs.
  describe("PROV-AC-004 (cloud only)", () => {
    it("has nothing to run on local", () => undefined);
  });
}
