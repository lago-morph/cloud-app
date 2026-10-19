/**
 * AUTH public names, server side (contract: docs/contracts/ts/auth.d.ts).
 * Stub written by B-01; implemented by B-12.
 */
import type { Context, MiddlewareHandler } from "hono";

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

/** Rejects anonymous requests with AUTH.UNAUTHENTICATED; narrows `c.var.user` to LoggedInUser. */
export function requireUser(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }> {
  throw new Error("not implemented: requireUser");
}

/** Rejects anonymous requests with AUTH.UNAUTHENTICATED and users with AUTH.FORBIDDEN. */
export function requireAdmin(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }> {
  throw new Error("not implemented: requireAdmin");
}

/** Returns the logged-in user, or throws AUTH.UNAUTHENTICATED for an anonymous request. */
export function requireCurrentUser(c: Context): LoggedInUser {
  throw new Error("not implemented: requireCurrentUser");
}
