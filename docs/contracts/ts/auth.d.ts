/**
 * Current user (AUTH), server side. Behavior: docs/components/auth.md.
 * HTTP routes: contracts/http/framework.openapi.yaml. Browser helpers: client.d.ts.
 */
import type { MiddlewareHandler } from "hono";

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

/** Rejects anonymous requests with AUTH.UNAUTHENTICATED. */
export declare function requireUser(): MiddlewareHandler;
/** Rejects anonymous requests with AUTH.UNAUTHENTICATED and users with AUTH.FORBIDDEN. */
export declare function requireAdmin(): MiddlewareHandler;
