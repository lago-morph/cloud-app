import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { levelFromAccount } from "./levels.js";
import { formatRoles, parseRoles, withRole, withoutRole } from "./roles.js";

const LOGIN = { id: "u_A", displayName: "A" } as const;

describe("access level from the account (DEC-0521, DEC-0522, DEC-0524)", () => {
  it(tag("AUTH-AC-003", "a verified account is user; admin exactly when its roles contain admin"), () => {
    expect(levelFromAccount(LOGIN, { verified: true, roles: [] })).toStrictEqual({ level: "user", id: "u_A", displayName: "A" });
    expect(levelFromAccount(LOGIN, { verified: true, roles: ["admin"] })).toStrictEqual({ level: "admin", id: "u_A", displayName: "A" });
    expect(levelFromAccount(LOGIN, { verified: true, roles: ["other", "admin"] }).level).toBe("admin");
  });

  it(tag("AUTH-AC-012", "an unverified or missing account is anonymous, never user or admin"), () => {
    expect(levelFromAccount(LOGIN, { verified: false, roles: [] })).toStrictEqual({ level: "anonymous" });
    expect(levelFromAccount(LOGIN, { verified: false, roles: ["admin"] })).toStrictEqual({ level: "anonymous" });
    expect(levelFromAccount(LOGIN, null)).toStrictEqual({ level: "anonymous" });
  });

  it("unknown role names, including a stray user, are ignored", () => {
    expect(levelFromAccount(LOGIN, { verified: true, roles: ["user", "ADMIN", " admin "] }).level).toBe("user");
  });
});

describe("the role list (PWD-REQ-008)", () => {
  it("is split on commas, trimmed, with empty names dropped; NULL is no roles", () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles("")).toEqual([]);
    expect(parseRoles(" admin , ,editor,")).toEqual(["admin", "editor"]);
  });

  it("is stored with unique names in order, and NULL (never user) when empty", () => {
    expect(formatRoles([])).toBeNull();
    expect(formatRoles(["editor", "admin", "editor"])).toBe("editor,admin");
    expect(formatRoles(withoutRole(["admin"], "admin"))).toBeNull();
    expect(withRole(["editor"], "admin")).toEqual(["editor", "admin"]);
    expect(withRole(["admin"], "admin")).toEqual(["admin"]);
    expect(withoutRole(["editor", "admin"], "admin")).toEqual(["editor"]);
  });
});
