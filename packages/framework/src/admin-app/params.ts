/**
 * The admin app's parameters (PAR-445, PAR-446; v0.2.0 plan §3 "Its own session is short", §5.2).
 * Each is a PAR in the register (integrated by I2).
 */

/** PAR-445: how long an admin-app session lasts after sign-in, in ms (plan §3: short). Never renewed. */
export const ADMIN_SESSION_MS = 900_000;

/** PAR-446: how long a started grant (sign-in or a page's action, up to `/callback`) stays valid, in ms. */
export const ADMIN_GRANT_MS = 600_000;

/** The session cookie and the grant cookie (one grant at a time per browser). */
export const SESSION_COOKIE = "__Host-admin-session";
export const GRANT_COOKIE = "__Host-admin-grant";
