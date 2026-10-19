/**
 * The local target's cookie settings (LOCAL-REQ-004, auth.md §2 "Session cookie"): named
 * `session_local` / `login_local` and not Secure, because `dev` serves plain HTTP. Imported only
 * by the local target runtime and `createTestApp`, so no cloud bundle carries these names
 * (CORE-REQ-006, DEC-PENDING-B-16a-2); AUTH refuses them on any cloud target (cookies.ts).
 */
import type { CookieSettings } from "./cookies.js";

export const LOCAL_COOKIES: CookieSettings = Object.freeze({ session: "session_local", login: "login_local", secure: false });
