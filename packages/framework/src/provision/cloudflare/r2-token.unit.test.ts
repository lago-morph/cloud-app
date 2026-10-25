import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CloudflareApi } from "./api.js";
import {
  createAccountSigningCredential,
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
  it("allows Item Write on every bucket of the account and denies it on the account buckets (the shape verified live)", () => {
    const account = `com.cloudflare.api.account.${ACCOUNT}`;
    const bucket = (b: string) => `com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_${b}`;
    expect(signingTokenPolicies("g1", ACCOUNT)).toEqual([
      { effect: "allow", permission_groups: [{ id: "g1" }], resources: { [account]: "*" } },
      { effect: "deny", permission_groups: [{ id: "g1" }], resources: { [account]: { [bucket("prototype-logs")]: "*", [bucket("sst-state")]: "*", [bucket("prototype-mailsink")]: "*" } } },
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
    await createAccountSigningCredential(api, ACCOUNT);
    expect(ITEM_WRITE_PERMISSION).toBe("Workers R2 Storage Bucket Item Write");
    expect(api.requests).toEqual([
      `GET ${TOKENS}?per_page=50&page=1`,
      `DELETE ${TOKENS}/old`,
      `GET ${TOKENS}/permission_groups`,
      `POST ${TOKENS} ${JSON.stringify({ name: SIGNING_TOKEN_NAME, policies: signingTokenPolicies("2efd5506f9c8494dacb1fa10a3e7d5b6", ACCOUNT) })}`,
      `PUT ${RECORD} ${JSON.stringify({ tokenId: "tok123", accessKeyId: "tok123", secretAccessKey: SECRET })}`,
    ]);
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
    await expect(deleteSigningToken(stubApi({ [`DELETE ${TOKENS}/t2`]: err(403, 9109, "Unauthorized") }), ACCOUNT, "t2")).rejects.toThrow(/deleting R2 API token t2 failed: HTTP 403/);
  });
});
