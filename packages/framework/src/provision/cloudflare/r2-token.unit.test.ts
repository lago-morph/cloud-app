import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CloudflareApi } from "./api.js";
import { createSigningToken, deleteSigningToken, findSigningToken, ITEM_WRITE_PERMISSION, tokenCreationProblems } from "./r2-token.js";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const stage = { app: "notes", stage: "test-abc" };
const TOKENS = `/accounts/${ACCOUNT}/tokens`;

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

describe("the stage's R2 signing token (DEC-0100)", () => {
  it("creates one account token with Item Write on the stage bucket only, and derives the S3 credentials from it", async () => {
    const api = stubApi({
      [`GET ${TOKENS}/permission_groups`]: GROUPS,
      [`POST ${TOKENS}`]: ok({ id: "tok123", name: "notes-test-abc-files-signing", status: "active", value: "token-value-xyz" }),
    });
    const credentials = await createSigningToken(api, ACCOUNT, stage);
    expect(ITEM_WRITE_PERMISSION).toBe("Workers R2 Storage Bucket Item Write");
    expect(api.requests[1]).toBe(
      `POST ${TOKENS} ${JSON.stringify({
        name: "notes-test-abc-files-signing",
        policies: [
          {
            effect: "allow",
            permission_groups: [{ id: "2efd5506f9c8494dacb1fa10a3e7d5b6" }],
            resources: { [`com.cloudflare.edge.r2.bucket.${ACCOUNT}_default_notes-test-abc-files`]: "*" },
          },
        ],
      })}`,
    );
    expect(credentials).toEqual({ id: "tok123", accessKeyId: "tok123", secretAccessKey: createHash("sha256").update("token-value-xyz").digest("hex") });
  });

  it("a failure never contains the token value; a missing permission group is named", async () => {
    const noGroup = stubApi({ [`GET ${TOKENS}/permission_groups`]: ok([]) });
    await expect(createSigningToken(noGroup, ACCOUNT, stage)).rejects.toThrow(/permission group "Workers R2 Storage Bucket Item Write" was not found/);
    const noValue = stubApi({ [`GET ${TOKENS}/permission_groups`]: GROUPS, [`POST ${TOKENS}`]: err(400, 1001, "bad") });
    await expect(createSigningToken(noValue, ACCOUNT, stage)).rejects.toThrow(/creating the R2 signing token notes-test-abc-files-signing failed: HTTP 400/);
  });

  it("finds the stage's token by its exact name across pages", async () => {
    const api = stubApi({
      [`GET ${TOKENS}?per_page=50&page=1`]: ok([{ id: "t1", name: "notes-test-abcd-files-signing" }], { page: 1, total_pages: 2 }),
      [`GET ${TOKENS}?per_page=50&page=2`]: ok([{ id: "t2", name: "notes-test-abc-files-signing" }], { page: 2, total_pages: 2 }),
    });
    expect(await findSigningToken(api, ACCOUNT, stage)).toEqual({ id: "t2" });
    const none = stubApi({ [`GET ${TOKENS}?per_page=50&page=1`]: ok([], { page: 1, total_pages: 1 }) });
    expect(await findSigningToken(none, ACCOUNT, stage)).toBeUndefined();
  });

  it("deletes the token by id; one already gone counts as deleted", async () => {
    const api = stubApi({ [`DELETE ${TOKENS}/t2`]: ok({ id: "t2" }) });
    await deleteSigningToken(api, ACCOUNT, "t2");
    await deleteSigningToken(stubApi({ [`DELETE ${TOKENS}/t2`]: err(404, 1003, "not found") }), ACCOUNT, "t2");
    await expect(deleteSigningToken(stubApi({ [`DELETE ${TOKENS}/t2`]: err(403, 9109, "Unauthorized") }), ACCOUNT, "t2")).rejects.toThrow(
      /deleting R2 API token t2 failed: HTTP 403/,
    );
  });

  it("[PROV-AC-002] preflight: a credential that cannot read token permission groups or tokens lacks the permission to create R2 API tokens, named as such; nothing is created", async () => {
    const allowed = stubApi({ [`GET ${TOKENS}/permission_groups`]: GROUPS, [`GET ${TOKENS}?per_page=50&page=1`]: ok([], { page: 1, total_pages: 1 }) });
    expect(await tokenCreationProblems(allowed, ACCOUNT)).toEqual([]);
    const refused = stubApi({ [`GET ${TOKENS}/permission_groups`]: err(403, 9109, "Unauthorized to access requested resource"), [`GET ${TOKENS}?per_page=50&page=1`]: err(403, 9109, "Unauthorized") });
    const problems = await tokenCreationProblems(refused, ACCOUNT);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/permission to create R2 API tokens \(Account API Tokens: Edit\).*HTTP 403/);
    expect(refused.requests.every((r) => r.startsWith("GET "))).toBe(true);
  });
});
