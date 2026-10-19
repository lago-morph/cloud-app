/**
 * AUTH browser helpers (contract: docs/contracts/ts/client.d.ts: session helpers). Browser code:
 * Web APIs only. Errors are `ApiError`s from HTTP's `api` helper.
 */
import { api } from "../http/client.js";
import type { CurrentUser } from "./public.js";

/** The current user as the server sees it. `/api/auth/me`'s `unlistedId` is not passed on (AUTH-REQ-001). */
export async function getCurrentUser(): Promise<CurrentUser> {
  const user = await api<CurrentUser>("/auth/me");
  return user.level === "anonymous" ? { level: "anonymous" } : { level: user.level, id: user.id, displayName: user.displayName };
}

/** Navigates to login; returns to `returnTo` (a same-origin path, default: current page). */
export function login(returnTo?: string): void {
  const target = returnTo ?? `${location.pathname}${location.search}${location.hash}`;
  location.assign(`/api/auth/login?returnTo=${encodeURIComponent(target)}`);
}

/** Ends the session, then resolves. */
export async function logout(): Promise<void> {
  await api("/auth/logout", { method: "POST" });
}
