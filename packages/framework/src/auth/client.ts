/**
 * AUTH browser helpers (contract: docs/contracts/ts/client.d.ts: session helpers).
 * Stub written by B-01; implemented by B-12.
 */
import type { CurrentUser } from "./public.js";

/** The current user as the server sees it. */
export function getCurrentUser(): Promise<CurrentUser> {
  throw new Error("not implemented: getCurrentUser");
}

/** Navigates to login; returns to `returnTo` (a same-origin path, default: current page). */
export function login(returnTo?: string): void {
  throw new Error("not implemented: login");
}

/** Ends the session, then resolves. */
export function logout(): Promise<void> {
  throw new Error("not implemented: logout");
}
