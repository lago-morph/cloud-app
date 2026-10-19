import { Hono } from "hono";
import { describe, expect, expectTypeOf, it } from "vitest";
import { tag } from "../../../../tests/support/tags.js";
import { coreErrorHandler } from "../core/error-handler.js";
import { requireAdmin, requireCurrentUser, requireUser, type CurrentUser, type LoggedInUser } from "./public.js";
import { mockUsers } from "./testing.js";

function appAs(user: CurrentUser) {
  const app = new Hono<{ Variables: { user: CurrentUser; requestId: string } }>();
  app.onError(coreErrorHandler);
  app.use(async (c, next) => {
    c.set("requestId", "req-1");
    c.set("user", user);
    await next();
  });
  app.get("/user", requireUser(), (c) => c.json({ id: c.var.user.id }));
  app.get("/admin", requireAdmin(), (c) => c.json({ id: c.var.user.id }));
  app.get("/current", (c) => c.json({ id: requireCurrentUser(c).id }));
  return app;
}

async function codeOf(res: Response): Promise<[number, string | undefined]> {
  const body = (await res.json()) as { error?: { code: string } };
  return [res.status, body.error?.code];
}

describe("route guards", () => {
  it(tag("AUTH-AC-004", "requireUser: anonymous 401 AUTH.UNAUTHENTICATED, user and admin pass"), async () => {
    expect(await codeOf(await appAs(mockUsers.anonymous).request("/user"))).toStrictEqual([401, "AUTH.UNAUTHENTICATED"]);
    expect(await (await appAs(mockUsers.user("u1")).request("/user")).json()).toStrictEqual({ id: "u1" });
    expect(await (await appAs(mockUsers.admin("a1")).request("/user")).json()).toStrictEqual({ id: "a1" });
  });

  it(tag("AUTH-AC-004", "requireAdmin: anonymous 401, user 403 AUTH.FORBIDDEN, admin passes"), async () => {
    expect(await codeOf(await appAs(mockUsers.anonymous).request("/admin"))).toStrictEqual([401, "AUTH.UNAUTHENTICATED"]);
    expect(await codeOf(await appAs(mockUsers.user("u1")).request("/admin"))).toStrictEqual([403, "AUTH.FORBIDDEN"]);
    expect(await (await appAs(mockUsers.admin("a1")).request("/admin")).json()).toStrictEqual({ id: "a1" });
  });

  it(tag("AUTH-AC-004", "requireCurrentUser returns the logged-in user or throws AUTH.UNAUTHENTICATED"), async () => {
    expect(await codeOf(await appAs(mockUsers.anonymous).request("/current"))).toStrictEqual([401, "AUTH.UNAUTHENTICATED"]);
    expect(await (await appAs(mockUsers.user("u2")).request("/current")).json()).toStrictEqual({ id: "u2" });
  });

  it(tag("AUTH-AC-001", "type inspection: requireCurrentUser returns LoggedInUser"), () => {
    expectTypeOf(requireCurrentUser).returns.toEqualTypeOf<LoggedInUser>();
  });
});

describe("mockUsers", () => {
  it("builds each level, with a fixed ID per level by default", () => {
    expect(mockUsers.anonymous).toStrictEqual({ level: "anonymous" });
    expect(mockUsers.user("x")).toStrictEqual({ level: "user", id: "x", displayName: null });
    expect(mockUsers.admin("y")).toStrictEqual({ level: "admin", id: "y", displayName: null });
    expect(mockUsers.user()).toStrictEqual(mockUsers.user());
    expect(mockUsers.user()).not.toStrictEqual(mockUsers.admin());
  });
});
