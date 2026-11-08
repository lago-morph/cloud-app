// Unit tests for the owner token's permission groups (scripts/live-pass/lib/groups.mjs). Written
// from the brief and DEC-0793: the owner makes one token, live-pass-owner, in the test Cloudflare
// account's dashboard from a pre-filled link; it must let the runner do everything that needs no human
// login (snapshots, logs, R2, cleanup, its probe tokens, rolling the everyday token, inviting the
// tester and changing the tester's role). The dashboard shows "Edit" where the API says "Write"; a
// group the runner cannot do without stops it, and Workers Observability (server logs only) is
// recorded as missing without stopping it.
import { describe, expect, it } from "vitest";
import { groupKey, missingGroups, OPTIONAL_OWNER_GROUPS, OWNER_GROUP_IDS, OWNER_GROUPS, ownerTokenLink } from "./lib/groups.mjs";

describe("groupKey", () => {
  it("matches API and dashboard names, case-insensitively", () => {
    expect(groupKey("Workers Scripts Write")).toBe(groupKey("Workers Scripts Edit"));
    expect(groupKey("workers observability edit")).toBe(groupKey("Workers Observability Write"));
    expect(groupKey("Account Settings Read")).not.toBe(groupKey("Account Settings Write"));
  });
});

describe("the owner token's groups", () => {
  it("are the eight the runner uses, with Account Settings Write for the invitation and the role change", () => {
    expect([...OWNER_GROUPS].sort()).toEqual([
      "Account API Tokens Write",
      "Account Settings Write",
      "D1 Write",
      "OAuth Client Write",
      "Secrets Store Write",
      "Workers Observability Write",
      "Workers R2 Storage Write",
      "Workers Scripts Write",
    ]);
  });

  it("each has Cloudflare's permission group ID (read from the API on 2026-11-08)", () => {
    for (const g of OWNER_GROUPS) expect(OWNER_GROUP_IDS[g], g).toMatch(/^[0-9a-f]{32}$/);
    expect(OWNER_GROUP_IDS["Account Settings Write"]).toBe("1af1fa2adc104452b74a9a3364202f20");
    expect(OWNER_GROUP_IDS["Workers Observability Write"]).toBe("82c075da3f4647a2a03becd0fe240f8a");
  });
});

describe("missingGroups", () => {
  it("is empty when the token holds all eight, in either spelling", () => {
    const held = OWNER_GROUPS.map((g) => g.replace(/ Write$/, " Edit"));
    expect(missingGroups(held)).toEqual({ required: [], optional: [] });
  });

  it("names a missing required group, and a missing optional group separately", () => {
    const held = OWNER_GROUPS.filter((g) => g !== "D1 Write" && !OPTIONAL_OWNER_GROUPS.includes(g));
    expect(missingGroups(held)).toEqual({ required: ["D1 Write"], optional: OPTIONAL_OWNER_GROUPS });
  });

  it("does not count Account Settings Read as Account Settings Write (an invitation needs Write)", () => {
    const held = OWNER_GROUPS.map((g) => (g === "Account Settings Write" ? "Account Settings Read" : g));
    expect(missingGroups(held).required).toEqual(["Account Settings Write"]);
  });
});

describe("ownerTokenLink", () => {
  it("is the dashboard's account token template, pre-filled with all eight groups by ID and the name live-pass-owner", () => {
    const url = new URL(ownerTokenLink());
    expect(`${url.origin}${url.pathname}`).toBe("https://dash.cloudflare.com/");
    expect(url.searchParams.get("to")).toBe("/:account/api-tokens");
    expect(url.searchParams.get("name")).toBe("live-pass-owner");
    const keys = JSON.parse(url.searchParams.get("permissionGroupKeys") ?? "[]");
    expect(keys.map((k: { key: string }) => k.key).sort()).toEqual(OWNER_GROUPS.map((g) => OWNER_GROUP_IDS[g]).sort());
    for (const k of keys) expect(k.type).toBe("edit");
  });
});
