// Unit tests for matching the admin token's permission groups (scripts/live-pass/lib/groups.mjs).
// Written from the brief and the runbook: the owner makes the admin token in the dashboard, which
// shows "Edit" where the API says "Write"; a group the runner cannot do without stops it, and the
// Workers Observability group (server logs only) is recorded as missing without stopping it.
import { describe, expect, it } from "vitest";
import { ADMIN_GROUPS, OPTIONAL_ADMIN_GROUPS, groupKey, missingGroups } from "./lib/groups.mjs";

describe("groupKey", () => {
  it("matches API and dashboard names, case-insensitively", () => {
    expect(groupKey("Workers Scripts Write")).toBe(groupKey("Workers Scripts Edit"));
    expect(groupKey("workers observability edit")).toBe(groupKey("Workers Observability Write"));
    expect(groupKey("Account Settings Read")).not.toBe(groupKey("Account Settings Write"));
  });
});

describe("missingGroups", () => {
  it("is empty when the token holds all eight, in either spelling", () => {
    const held = ADMIN_GROUPS.map((g) => g.replace(/ Write$/, " Edit"));
    expect(missingGroups(held)).toEqual({ required: [], optional: [] });
  });

  it("names a missing required group, and a missing optional group separately", () => {
    const held = ADMIN_GROUPS.filter((g) => g !== "D1 Write" && !OPTIONAL_ADMIN_GROUPS.includes(g));
    expect(missingGroups(held)).toEqual({ required: ["D1 Write"], optional: OPTIONAL_ADMIN_GROUPS });
  });

  it("counts a Write group as holding its Read group", () => {
    const held = ADMIN_GROUPS.map((g) => (g === "Account Settings Read" ? "Account Settings Write" : g));
    expect(missingGroups(held).required).toEqual([]);
  });
});
