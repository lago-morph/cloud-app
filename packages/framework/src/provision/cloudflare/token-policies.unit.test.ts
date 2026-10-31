/** The token permission check (DEC-0515): scopes and deny policies. No network. Moved with the code from `email-permissions.unit.test.ts` (DEC-0687). */
import { describe, expect, it } from "vitest";
import { EMAIL_PERMISSIONS } from "./email-permissions.js";
import { missingPermissions, policyCovers } from "./token-policies.js";

const A = "acct";
const Z = "zone1";
const allow = (resources: unknown, ...names: string[]) => ({ effect: "allow", resources, permission_groups: names.map((name) => ({ name })) });

describe("policyCovers", () => {
  it("reads the account and zone resource forms Cloudflare uses", () => {
    expect(policyCovers({ [`com.cloudflare.api.account.${A}`]: "*" }, "account", A, Z)).toBe(true);
    expect(policyCovers({ "com.cloudflare.api.account.other": "*" }, "account", A, Z)).toBe(false);
    expect(policyCovers({ [`com.cloudflare.api.account.${A}`]: { "com.cloudflare.api.account.zone.*": "*" } }, "zone", A, Z)).toBe(true);
    expect(policyCovers({ [`com.cloudflare.api.account.${A}`]: { [`com.cloudflare.api.account.zone.${Z}`]: "*" } }, "zone", A, Z)).toBe(true);
    expect(policyCovers({ [`com.cloudflare.api.account.${A}`]: { "com.cloudflare.api.account.zone.zone2": "*" } }, "zone", A, Z)).toBe(false);
    expect(policyCovers({ [`com.cloudflare.api.account.zone.${Z}`]: "*" }, "zone", A, Z)).toBe(true);
    expect(policyCovers({ [`com.cloudflare.api.account.zone.${Z}`]: "*" }, "account", A, Z)).toBe(false);
  });
});

describe("missingPermissions", () => {
  const account = { [`com.cloudflare.api.account.${A}`]: "*" };
  const zones = { [`com.cloudflare.api.account.${A}`]: { "com.cloudflare.api.account.zone.*": "*" } };
  const full = [allow(account, "Email Sending Write", "Email Routing Addresses Write"), allow(zones, "Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read")];

  it("is empty for the live token's shape", () => {
    expect(missingPermissions(full, EMAIL_PERMISSIONS, A, Z)).toEqual([]);
  });

  it("a zone permission granted only on the account scope's other zone, or taken away by a deny policy, is missing", () => {
    const elsewhere = [full[0]!, allow({ "com.cloudflare.api.account.zone.zone2": "*" }, "Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read")];
    expect(missingPermissions(elsewhere, EMAIL_PERMISSIONS, A, Z).map((p) => p.name)).toEqual(["Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Read"]);
    const denied = [...full, { ...allow(zones, "DNS Write"), effect: "deny" }];
    expect(missingPermissions(denied, EMAIL_PERMISSIONS, A, Z).map((p) => p.name)).toEqual(["DNS Write"]);
  });

  it("Zone Write satisfies Zone Read", () => {
    const withWrite = [full[0]!, allow(zones, "Email Routing Rules Write", "DNS Write", "Zone Settings Write", "Zone Write")];
    expect(missingPermissions(withWrite, EMAIL_PERMISSIONS, A, Z)).toEqual([]);
  });
});
