/** Membership choice and role mapping (plan §4.1 step 3.4–3.5, §4.4, PAR-413; §7 "role mapping"). */
import { describe, expect, it } from "vitest";
import { ADMIN_ROLE_NAMES } from "./params.js";
import { mapRole, pickMembership } from "./roles.js";

describe("mapRole (PAR-413)", () => {
  it("maps the verified Super Administrator string to admin", () => {
    expect(mapRole(["Super Administrator - All Privileges"])).toBe("admin");
  });

  it("maps the plain \"Administrator\" role to admin", () => {
    expect(mapRole(["Administrator"])).toBe("admin");
  });

  it("maps any other role, or none, to user", () => {
    expect(mapRole(["HTTP Applications Read"])).toBe("user");
    expect(mapRole([])).toBe("user");
  });

  it("is admin when any one of several roles is an admin role", () => {
    expect(mapRole(["HTTP Applications Read", "Administrator"])).toBe("admin");
  });

  it("matches whole names only: no prefix, suffix, case or whitespace variants", () => {
    for (const name of ["Administrator Read Only", "administrator", "ADMINISTRATOR", " Administrator", "Administrator ", "Super Administrator", "Super Administrator - All Privileges (custom)"]) {
      expect(mapRole([name]), name).toBe("user");
    }
  });

  it("takes the admin names from the parameter, so they can change", () => {
    expect(ADMIN_ROLE_NAMES).toEqual(["Super Administrator - All Privileges", "Administrator"]);
    expect(mapRole(["Owner"], ["Owner"])).toBe("admin");
    expect(mapRole(["Administrator"], ["Owner"])).toBe("user");
  });
});

describe("pickMembership", () => {
  const m = (account: string, status: string, roles: string[] = ["Administrator"]) => ({ account: { id: account }, status, roles });

  it("picks the accepted membership of this account", () => {
    expect(pickMembership([m("other", "accepted"), m("acct", "accepted", ["HTTP Applications Read"])], "acct")).toEqual({ roles: ["HTTP Applications Read"] });
  });

  it("refuses a pending or rejected membership of this account", () => {
    expect(pickMembership([m("acct", "pending")], "acct")).toBeNull();
    expect(pickMembership([m("acct", "rejected")], "acct")).toBeNull();
  });

  it("refuses when there is no membership in this account (plan §4.4)", () => {
    expect(pickMembership([m("other", "accepted")], "acct")).toBeNull();
    expect(pickMembership([], "acct")).toBeNull();
  });

  it("ignores malformed entries and non-string roles", () => {
    const list: unknown[] = [null, 3, { account: null }, { account: { id: "acct" }, status: "accepted", roles: ["Administrator", 7, null] }];
    expect(pickMembership(list, "acct")).toEqual({ roles: ["Administrator"] });
  });

  it("picks the accepted entry when a pending one for the same account comes first", () => {
    expect(pickMembership([m("acct", "pending", ["Administrator"]), m("acct", "accepted", ["HTTP Applications Read"])], "acct")).toEqual({ roles: ["HTTP Applications Read"] });
  });

  it("treats a roles value that is a string, not a list, as no roles (user)", () => {
    const picked = pickMembership([{ account: { id: "acct" }, status: "accepted", roles: "Administrator" }], "acct");
    expect(picked).toEqual({ roles: [] });
    expect(mapRole(picked!.roles)).toBe("user");
  });

  it("maps Unicode look-alikes and decomposed forms of an admin name to user", () => {
    for (const name of ["Adminіstrator" /* Cyrillic і */, "Administrator​", "Super Administrator – All Privileges", "Super Administrator - All Privileges".normalize("NFD") + "́"]) {
      expect(mapRole([name]), JSON.stringify(name)).toBe("user");
    }
  });

  it("never takes an admin role from another account's membership", () => {
    const picked = pickMembership([m("other", "accepted", ["Super Administrator - All Privileges"]), m("acct", "accepted", ["HTTP Applications Read"])], "acct");
    expect(mapRole(picked!.roles)).toBe("user");
  });

  it("treats a missing roles list as no roles", () => {
    expect(pickMembership([{ account: { id: "acct" }, status: "accepted" }], "acct")).toEqual({ roles: [] });
  });
});
