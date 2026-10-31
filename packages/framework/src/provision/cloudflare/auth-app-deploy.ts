/**
 * The auth app's account resources (v0.2.0 plan §3, §5.2 page 1): the Worker `prototype-auth`
 * (`APP_SCRIPTS.signin`, PAR-438) and its D1 database. Page 1 (account setup) creates them; the
 * status page reads them. Runs in the admin app's Worker, so it imports nothing from Node.
 */

/** PAR-450: the auth app's D1 database (tables `users`, `codes`, `registry`, `sign_ins`; auth-app/store.ts). */
export const AUTH_APP_DATABASE = "prototype-auth";
