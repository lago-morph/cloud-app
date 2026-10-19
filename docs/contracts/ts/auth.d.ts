/**
 * Current user (AUTH), server side. Behavior: docs/components/auth.md.
 * HTTP routes: contracts/http/framework.openapi.yaml. Browser helpers: client.d.ts.
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
export declare function requireUser(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }>;
/** Rejects anonymous requests with AUTH.UNAUTHENTICATED and users with AUTH.FORBIDDEN; narrows `c.var.user` to LoggedInUser. */
export declare function requireAdmin(): MiddlewareHandler<{ Variables: { user: LoggedInUser } }>;
/**
 * Returns the logged-in user, or throws AUTH.UNAUTHENTICATED for an anonymous request.
 * For handlers whose protection comes from middleware registered with `use()`, which does not narrow types.
 */
export declare function requireCurrentUser(c: Context): LoggedInUser;
