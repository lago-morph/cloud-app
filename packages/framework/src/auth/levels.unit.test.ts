import { describe, expect, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { evaluateLogin } from "./levels.js";

describe("access level of a validated login", () => {
  it(tag("AUTH-AC-003", "admin exactly when the ID is in framework.admins"), () => {
    expect(evaluateLogin({ id: "u_A", displayName: "A" }, { admins: ["u_A"] })).toStrictEqual({
      user: { level: "admin", id: "u_A", displayName: "A" },
    });
    expect(evaluateLogin({ id: "u_B", displayName: null }, { admins: ["u_A"] })).toStrictEqual({
      user: { level: "user", id: "u_B", displayName: null },
    });
  });

  it(tag("AUTH-AC-012", "with framework.users: listed is user, admins-only is admin, anyone else anonymous with unlistedId"), () => {
    const lists = { admins: ["u_ADM"], users: ["u_USR"] };
    expect(evaluateLogin({ id: "u_USR", displayName: null }, lists).user.level).toBe("user");
    expect(evaluateLogin({ id: "u_ADM", displayName: null }, lists).user.level).toBe("admin");
    expect(evaluateLogin({ id: "u_OTH", displayName: "O" }, lists)).toStrictEqual({ user: { level: "anonymous" }, unlistedId: "u_OTH" });
  });

  it(tag("AUTH-AC-012", "without framework.users every validated login is at least user"), () => {
    expect(evaluateLogin({ id: "u_ANY", displayName: null }, { admins: [] }).user.level).toBe("user");
    // An empty users list is present: nobody but admins.
    expect(evaluateLogin({ id: "u_ANY", displayName: null }, { admins: [], users: [] }).user.level).toBe("anonymous");
  });
});
