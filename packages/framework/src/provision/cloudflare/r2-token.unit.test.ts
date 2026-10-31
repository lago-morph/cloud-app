import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CloudflareApi } from "./api.js";
import { ACCOUNT as FAKE_ACCOUNT, FakeCloud } from "./fake-cloud.test-support.js";
import {
  createAccountSigningCredential,
  readSigningPlacement,
  SIGNING_SECRET_NAMES,
  signingCredentialState,
  deleteSigningToken,
  findLegacySigningToken,
  ITEM_WRITE_PERMISSION,
  parseSigningRecord,
  readSigningCredentials,
  SIGNING_RECORD_KEY,
  SIGNING_TOKEN_NAME,
  signingTokenPolicies,
  tokenWriteProblems,
} from "./r2-token.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const stage = { app: "notes", stage: "test-abc" };
const TOKENS = `/accounts/${ACCOUNT}/tokens`;
const RECORD = `/accounts/${ACCOUNT}/r2/buckets/sst-state/objects/${encodeURIComponent(SIGNING_RECORD_KEY)}`;
const SECRET = createHash("sha256").update("token-value-xyz").digest("hex");

type Reply = { status: number; body: unknown };
const ok = (result: unknown, result_info?: unknown): Reply => ({ status: 200, body: { success: true, errors: [], messages: [], result, ...(result_info ? { result_info } : {}) } });
const err = (status: number, code: number, message: string): Reply => ({ status, body: { success: false, errors: [{ code, message }], messages: [], result: null } });

function stubApi(replies: Record<string, Reply>): CloudflareApi & { requests: string[] } {
  const requests: string[] = [];
  const api = async (method: string, path: string, body?: unknown) => {
    requests.push(`${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`);
    const reply = replies[`${method} ${path}`];
    if (!reply) throw new Error(`unexpected request ${method} ${path}`);
    return reply;
  };
  return Object.assign(api, { requests });
}

// Shapes recorded by spike A-07 (RESULT.md "How it works"); the group id is the one observed there.
const GROUPS = ok([
  { id: "6a018a9f2fc74eb6b293b0c548f38b39", name: "Workers R2 Storage Bucket Item Read", scopes: ["com.cloudflare.edge.r2.bucket"] },
  { id: "2efd5506f9c8494dacb1fa10a3e7d5b6", name: "Workers R2 Storage Bucket Item Write", scopes: ["com.cloudflare.edge.r2.bucket"] },
]);

describe("the account's R2 signing credential (DEC-0550)", () => {
  it("allows Item Write on every bucket of the account and denies it on the account buckets, the backup bucket included (the shape verified live)", () => {
    const account = `com.cloudflare.api.account.${ACCOUNT}`;
    const bucket = (b: string) => `com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_${b}`;
    expect(signingTokenPolicies("g1", ACCOUNT)).toEqual([
      { effect: "allow", permission_groups: [{ id: "g1" }], resources: { [account]: "*" } },
      { effect: "deny", permission_groups: [{ id: "g1" }], resources: { [account]: { [bucket("prototype-logs")]: "*", [bucket("sst-state")]: "*", [bucket("prototype-mailsink")]: "*", [bucket("prototype-backups")]: "*" } } },
    ]);
  });

  it("setup-account creates one token named prototype-r2-signing and records its S3 credentials in the state home; a same-named token without a record is replaced", async () => {
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: "old", name: SIGNING_TOKEN_NAME }, { id: "other", name: "notes-test-abc-files-signing" }], { page: 1, total_pages: 1 }),
      [`DELETE ${TOKENS}/old`]: ok({ id: "old" }),
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: ok({ id: "tok123", name: SIGNING_TOKEN_NAME, status: "active", value: "token-value-xyz" }),
      [`PUT ${RECORD}`]: ok({ key: SIGNING_RECORD_KEY }),
    });
    expect(await createAccountSigningCredential(api, ACCOUNT)).toEqual({ replaced: ["old"] });
    expect(ITEM_WRITE_PERMISSION).toBe("Workers R2 Storage Bucket Item Write");
    expect(api.requests).toEqual([
      `GET ${TOKENS}?per_page=50&page=1`,
      `GET ${TOKENS}/permission_groups`,
      `POST ${TOKENS} ${JSON.stringify({ name: SIGNING_TOKEN_NAME, policies: signingTokenPolicies("2efd5506f9c8494dacb1fa10a3e7d5b6", ACCOUNT) })}`,
      `PUT ${RECORD} ${JSON.stringify({ tokenId: "tok123", accessKeyId: "tok123", secretAccessKey: SECRET, deniedBuckets: ["prototype-logs", "sst-state", "prototype-mailsink", "prototype-backups"] })}`,
      `DELETE ${TOKENS}/old`,
    ]);
  });

  it("the old signing token is deleted only after the new token and its record exist, so a failure leaves the deployed stages' key working", async () => {
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: "old", name: SIGNING_TOKEN_NAME }], { page: 1, total_pages: 1 }),
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: err(500, 1000, "internal error"),
    });
    await expect(createAccountSigningCredential(api, ACCOUNT)).rejects.toThrow();
    expect(api.requests.some((r) => r.startsWith(`DELETE ${TOKENS}/old`))).toBe(false);

    const recordFails = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: "old", name: SIGNING_TOKEN_NAME }], { page: 1, total_pages: 1 }),
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: ok({ id: "tok123", name: SIGNING_TOKEN_NAME, status: "active", value: "token-value-xyz" }),
      [`PUT ${RECORD}`]: err(403, 10002, "Unauthorized"),
      [`DELETE ${TOKENS}/tok123`]: ok({ id: "tok123" }),
    });
    await expect(createAccountSigningCredential(recordFails, ACCOUNT)).rejects.toThrow(/writing the record/);
    expect(recordFails.requests.some((r) => r.startsWith(`DELETE ${TOKENS}/old`))).toBe(false);
  });

  it("a record that cannot be written deletes the new token again; failures never contain the token value", async () => {
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([], { page: 1, total_pages: 1 }),
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: ok({ id: "tok123", name: SIGNING_TOKEN_NAME, status: "active", value: "token-value-xyz" }),
      [`PUT ${RECORD}`]: err(403, 10002, "Unauthorized"),
      [`DELETE ${TOKENS}/tok123`]: ok({ id: "tok123" }),
    });
    const failure = await createAccountSigningCredential(api, ACCOUNT).then(() => undefined, (e: unknown) => String(e));
    expect(failure).toMatch(/writing the record framework\/r2-signing\.json in R2 bucket sst-state failed: HTTP 403/);
    expect(failure).not.toContain("token-value-xyz");
    expect(failure).not.toContain(SECRET);
    expect(api.requests.at(-1)).toBe(`DELETE ${TOKENS}/tok123`);
    const noGroup = stubApi({ [`GET ${TOKENS}?per_page=50&page=1`]: ok([], { page: 1, total_pages: 1 }), [`GET ${TOKENS}/permission_groups`]: ok([]) });
    await expect(createAccountSigningCredential(noGroup, ACCOUNT)).rejects.toThrow(/permission group "Workers R2 Storage Bucket Item Write" was not found/);
  });

  it("reads the record: absent → undefined; a malformed one is named without its values", async () => {
    expect(await readSigningCredentials(stubApi({ [`GET ${RECORD}`]: err(404, 10007, "The specified key does not exist.") }), ACCOUNT)).toBeUndefined();
    const record = { tokenId: "tok123", accessKeyId: "tok123", secretAccessKey: SECRET };
    expect(await readSigningCredentials(stubApi({ [`GET ${RECORD}`]: { status: 200, body: record } }), ACCOUNT)).toEqual({ id: "tok123", accessKeyId: "tok123", secretAccessKey: SECRET });
    expect(() => parseSigningRecord({ ...record, secretAccessKey: "short" })).toThrow(/not a valid signing record; run setup-account/);
    await expect(readSigningCredentials(stubApi({ [`GET ${RECORD}`]: err(403, 10002, "Unauthorized") }), ACCOUNT)).rejects.toThrow(/reading the record .* failed: HTTP 403/);
  });

  it("[PROV-AC-004] unit part: setup-account names Account API Tokens Write when the credential lacks it; reads only", async () => {
    const policies = (names: string[]) => ({
      [`GET ${TOKENS}/verify`]: ok({ id: "self", status: "active" }),
      [`GET ${TOKENS}/self`]: ok({ id: "self", policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.${ACCOUNT}`]: "*" }, permission_groups: names.map((name) => ({ name })) }] }),
    });
    expect(await tokenWriteProblems(stubApi(policies(["Account API Tokens Write"])), ACCOUNT)).toEqual([]);
    const readOnly = stubApi(policies(["Account API Tokens Read", "Workers Scripts Write"]));
    expect((await tokenWriteProblems(readOnly, ACCOUNT))[0]).toMatch(/lacks the permission "Account API Tokens Write".*setup token/);
    expect(readOnly.requests.every((r) => r.startsWith("GET "))).toBe(true);
    const unreadable = stubApi({ [`GET ${TOKENS}/verify`]: ok({ id: "self", status: "active" }), [`GET ${TOKENS}/self`]: err(403, 9109, "Unauthorized") });
    expect((await tokenWriteProblems(unreadable, ACCOUNT))[0]).toMatch(/cannot read its own permissions.*Account API Tokens Write/);
  });
});

describe("a stage's legacy signing token (DEC-0100, superseded by DEC-0550)", () => {
  it("finds it by its exact name across pages", async () => {
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: "t1", name: "notes-test-abcd-files-signing" }], { page: 1, total_pages: 2 }),
      [`GET ${TOKENS}?per_page=50&page=2`]: ok([{ id: "t2", name: "notes-test-abc-files-signing" }], { page: 2, total_pages: 2 }),
    });
    expect(await findLegacySigningToken(api, ACCOUNT, stage)).toEqual({ id: "t2" });
    const none = stubApi({ [`GET ${TOKENS}?per_page=50&page=1`]: ok([], { page: 1, total_pages: 1 }) });
    expect(await findLegacySigningToken(none, ACCOUNT, stage)).toBeUndefined();
  });

  it("a credential that may not list tokens (the everyday token, DEC-0551) finds none, so remove works without the token permission", async () => {
    const refused = stubApi({ [`GET ${TOKENS}?per_page=50&page=1`]: err(403, 9109, "Unauthorized to access requested resource") });
    expect(await findLegacySigningToken(refused, ACCOUNT, stage)).toBeUndefined();
    const broken = stubApi({ [`GET ${TOKENS}?per_page=50&page=1`]: err(500, 10000, "internal") });
    await expect(findLegacySigningToken(broken, ACCOUNT, stage)).rejects.toThrow(/listing the account's API tokens failed: HTTP 500/);
  });

  it("deletes a token by id; one already gone counts as deleted", async () => {
    const api = stubApi({ [`DELETE ${TOKENS}/t2`]: ok({ id: "t2" }) });
    await deleteSigningToken(api, ACCOUNT, "t2");
    await deleteSigningToken(stubApi({ [`DELETE ${TOKENS}/t2`]: err(404, 1003, "not found") }), ACCOUNT, "t2");
    const failure = await deleteSigningToken(stubApi({ [`DELETE ${TOKENS}/t2`]: err(403, 9109, "Unauthorized") }), ACCOUNT, "t2", "notes-test-abc-files-signing").then(() => "", (e: unknown) => String(e));
    // Named by its name only: a token ID is not printed (SETUP-REQ-007).
    expect(failure).toMatch(/deleting the R2 API token notes-test-abc-files-signing failed: HTTP 403/);
    expect(failure).not.toContain("t2");
  });

  it("a failed delete of an old signing token after a replacement names the token by its name, never its ID", async () => {
    const OLD = "0ld0000000000000000000000000000a";
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: OLD, name: SIGNING_TOKEN_NAME }], { page: 1, total_pages: 1 }),
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: ok({ id: "tok123", value: "token-value-xyz" }),
      [`PUT ${RECORD}`]: ok({}),
      [`DELETE ${TOKENS}/${OLD}`]: err(403, 9109, "Unauthorized"),
    });
    const failure = await createAccountSigningCredential(api, ACCOUNT).then(() => "", (e: unknown) => String(e));
    expect(failure).toMatch(new RegExp(`the new .* and its record are in place, but deleting the R2 API token ${SIGNING_TOKEN_NAME} failed: HTTP 403`));
    expect(failure).toContain(`delete the older token named ${SIGNING_TOKEN_NAME}`);
    expect(failure).not.toContain(OLD);
    expect(failure).not.toContain("tok123");
  });
});

describe("the signing credential in Secrets Store (plan-v0.2.0 §5.2 page 1, D7, §10; DEC-0729)", () => {
  const RECORD_KEY = "sst-state/framework/r2-signing.json";
  const hex = (value: string) => createHash("sha256").update(value).digest("hex");
  const store = (cloud: FakeCloud) => cloud.secretStores.get("store1")!.secrets;

  it("puts both S3 credentials into the account's store under PAR-455's names, tagged with the token; the record names the store and holds no secret", async () => {
    const cloud = FakeCloud.withSharedResources();
    expect(await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true })).toEqual({ replaced: ["tok0"], where: "secrets-store" });
    const token = [...cloud.tokens.keys()].find((id) => id !== "tok0")!;
    expect(SIGNING_SECRET_NAMES).toEqual({ accessKeyId: "PROTOTYPE_R2_ACCESS_KEY_ID", secretAccessKey: "PROTOTYPE_R2_SECRET_ACCESS_KEY" });
    expect(store(cloud).get("PROTOTYPE_R2_ACCESS_KEY_ID")).toMatchObject({ value: token, comment: token, scopes: ["workers"] });
    expect(store(cloud).get("PROTOTYPE_R2_SECRET_ACCESS_KEY")).toMatchObject({ value: hex(`value-of-${token}`), comment: token });
    const record = cloud.objectBodies.get(RECORD_KEY) as Record<string, unknown>;
    expect(record).toEqual({ tokenId: token, accessKeyId: token, deniedBuckets: ["prototype-logs", "sst-state", "prototype-mailsink", "prototype-backups"], secretsStore: { storeId: "store1" } });
    expect(JSON.stringify(record)).not.toContain(hex(`value-of-${token}`));
    expect(await readSigningPlacement(cloud.api, FAKE_ACCOUNT)).toEqual({ kind: "secrets-store", tokenId: token, storeId: "store1" });
    expect(await signingCredentialState(cloud.api, FAKE_ACCOUNT)).toBe("owned");

    // A second run replaces the values in place (the store refuses a second secret of a name).
    expect((await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true })).where).toBe("secrets-store");
    const next = (cloud.objectBodies.get(RECORD_KEY) as { tokenId: string }).tokenId;
    expect(next).not.toBe(token);
    expect(store(cloud).get("PROTOTYPE_R2_ACCESS_KEY_ID")).toMatchObject({ value: next, comment: next });
  });

  it("with Secrets Store unavailable it falls back to the record holding the credentials, as before (Worker secrets at deploy)", async () => {
    const cloud = FakeCloud.withSharedResources();
    cloud.override.set(`GET /accounts/${FAKE_ACCOUNT}/secrets_store/stores?per_page=50`, err(403, 10000, "Authentication error"));
    const result = await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true });
    expect(result).toMatchObject({ where: "record", reason: expect.stringMatching(/HTTP 403/) as unknown });
    const record = cloud.objectBodies.get(RECORD_KEY) as { tokenId: string; secretAccessKey?: string; secretsStore?: unknown };
    expect(record.secretAccessKey).toBe(hex(`value-of-${record.tokenId}`));
    expect(record.secretsStore).toBeUndefined();
    expect(await readSigningPlacement(cloud.api, FAKE_ACCOUNT)).toEqual({ kind: "worker-secrets", credentials: { id: record.tokenId, accessKeyId: record.tokenId, secretAccessKey: record.secretAccessKey } });
  });

  const tokenNames = (cloud: FakeCloud) => [...cloud.tokens.keys()].sort();
  const fail500 = { status: 500, body: { success: false, errors: [{ code: 10001, message: "internal" }], result: null } };

  it("any other store failure before a write throws instead of falling back: the new token is deleted again, the old one and its record stay (review M2)", async () => {
    const cloud = FakeCloud.withSharedResources();
    const before = structuredClone(cloud.objectBodies.get(RECORD_KEY));
    cloud.override.set(`GET /accounts/${FAKE_ACCOUNT}/secrets_store/stores?per_page=50`, fail500);
    await expect(createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true })).rejects.toThrow(/Secrets Store.*HTTP 500/);
    expect(tokenNames(cloud)).toEqual(["tok0"]);
    expect(cloud.objectBodies.get(RECORD_KEY)).toEqual(before);
  });

  it("once a put may have reached the store, a failure throws and keeps the new token and every old one, so stages bound to the store keep a live key; a re-run repairs it (review M1, M2)", async () => {
    // The second secret's PATCH fails on a re-run, after the first secret already holds the new token's key ID.
    const cloud = FakeCloud.withSharedResources();
    await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true });
    const first = tokenNames(cloud);
    const secretId = store(cloud).get("PROTOTYPE_R2_SECRET_ACCESS_KEY")!.id;
    cloud.override.set(`PATCH /accounts/${FAKE_ACCOUNT}/secrets_store/stores/store1/secrets/${secretId}`, fail500);
    const failure = await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true }).then(() => "", (e: unknown) => String(e));
    expect(failure).toMatch(/Secrets Store may hold part of the new R2 signing credential .*run account setup again/);
    expect(failure).toContain("stages bound to the store cannot sign R2 transfers until then");
    expect(failure).not.toMatch(/[0-9a-f]{64}/);
    expect(tokenNames(cloud)).toHaveLength(first.length + 1);
    expect(tokenNames(cloud)).toEqual(expect.arrayContaining(first));

    // A record that cannot be written after both puts: the store already holds the new token's key, so the token stays.
    const again = FakeCloud.withSharedResources();
    again.override.set(`PUT /accounts/${FAKE_ACCOUNT}/r2/buckets/sst-state/objects/${encodeURIComponent(SIGNING_RECORD_KEY)}`, fail500);
    await expect(createAccountSigningCredential(again.api, FAKE_ACCOUNT, { secretsStore: true })).rejects.toThrow(/run account setup again/);
    expect(tokenNames(again)).toHaveLength(2);
    expect(store(again).get("PROTOTYPE_R2_ACCESS_KEY_ID")?.value).toBe(tokenNames(again).find((t) => t !== "tok0"));
  });

  it("checking a store-held credential names Secrets Store Read when the store cannot be listed; a store-form record without its key ID is invalid", async () => {
    const cloud = FakeCloud.withSharedResources();
    await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true });
    cloud.override.set(`GET /accounts/${FAKE_ACCOUNT}/secrets_store/stores/store1/secrets?per_page=100`, err(403, 10000, "Authentication error"));
    await expect(signingCredentialState(cloud.api, FAKE_ACCOUNT)).rejects.toThrow(/needs "Secrets Store Read".*HTTP 403/);
    cloud.override.set(`GET /accounts/${FAKE_ACCOUNT}/secrets_store/stores/store1/secrets?per_page=100`, err(500, 10001, "internal"));
    const other = await signingCredentialState(cloud.api, FAKE_ACCOUNT).then(() => "", (e: unknown) => String(e));
    expect(other).toMatch(/HTTP 500/);
    expect(other).not.toContain("Secrets Store Read");
    const { accessKeyId: _id, ...noKeyId } = cloud.objectBodies.get(RECORD_KEY) as Record<string, unknown>;
    cloud.objectBodies.set(RECORD_KEY, noKeyId);
    await expect(readSigningPlacement(cloud.api, FAKE_ACCOUNT)).rejects.toThrow(/not a valid signing record/);
  });

  it("a store-held credential is absent (setup runs again) when either secret is missing or tagged with another token", async () => {
    for (const spoil of [(c: FakeCloud) => store(c).delete("PROTOTYPE_R2_SECRET_ACCESS_KEY"), (c: FakeCloud) => (store(c).get("PROTOTYPE_R2_ACCESS_KEY_ID")!.comment = "tok-other")]) {
      const cloud = FakeCloud.withSharedResources();
      await createAccountSigningCredential(cloud.api, FAKE_ACCOUNT, { secretsStore: true });
      spoil(cloud);
      expect(await signingCredentialState(cloud.api, FAKE_ACCOUNT)).toBe("absent");
    }
  });
});
