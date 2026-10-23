/**
 * AUTH public names, server side (contract: docs/contracts/ts/auth.d.ts). Behavior:
 * docs/components/auth.md. Framework-internal parts: `runtime.ts` (current-user middleware,
 * forgery check, `/api/auth/*` routes), `mock.ts` (authentication mock), `stub-provider.ts`
 * (test-only stub login provider), `login-provider.ts` (internal provider interface).
 */
import type { Context, MiddlewareHandler } from "hono";
import { FrameworkError } from "../core/errors.js";

export type AccessLevel = "anonymous" | "user" | "admin";

/** The only identity information app code receives. */
export type CurrentUser =
  | { readonly level: "anonymous" }
  | {
      readonly level: "user" | "admin";
      /** Stable, opaque user ID. */
      readonly id: string;
      readonly displayName: string | null;
    };

/** A logged-in user: level `user` or `admin`. */
export type LoggedInUser = Extract<CurrentUser, { level: "user" | "admin" }>;

function currentUserOf(c: Context): CurrentUser {
  const user = c.get("user") as CurrentUser | undefined;
  return user ?? { level: "anonymous" };
}

function loggedIn(c: Context): LoggedInUser {
  const user = currentUserOf(c);
  if (user.level === "anonymous") throw new FrameworkError("AUTH.UNAUTHENTICATED", "this route requires a logged-in user");
  return user;
}

/** Rejects anonymous requests with AUTH.UNAUTHENTICATED; narrows `c.var.user` to LoggedInUser. */
export function requireUser(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }> {
  return async (c, next) => {
    loggedIn(c);
    await next();
  };
}

/** Rejects anonymous requests with AUTH.UNAUTHENTICATED and users with AUTH.FORBIDDEN. */
export function requireAdmin(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }> {
  return async (c, next) => {
    if (loggedIn(c).level !== "admin") throw new FrameworkError("AUTH.FORBIDDEN", "this route requires an admin");
    await next();
  };
}

/** Returns the logged-in user, or throws AUTH.UNAUTHENTICATED for an anonymous request. */
export function requireCurrentUser(c: Context): LoggedInUser {
  return loggedIn(c);
}
