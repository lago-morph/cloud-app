/**
 * The admin pages, in the order the home page lists them (v0.2.0 plan §5.2). Each page's scopes
 * are PAR-447 (scopes.ts).
 *
 * `bundle.ts` compiles in the auth app's Worker module and the framework version (DEC-0720). Outside
 * the bundle (unit tests) they are absent, and account setup refuses to run.
 */
import type { AdminPage } from "./app.js";
import { everydayPage } from "./everyday-page.js";
import { createSetupPage } from "./setup-page.js";
import { statusPage } from "./status-page.js";

declare const __PF_AUTH_APP_SOURCE__: string | undefined;
declare const __PF_FRAMEWORK_VERSION__: string | undefined;

const setupPage = createSetupPage({
  authAppSource: () => {
    if (typeof __PF_AUTH_APP_SOURCE__ !== "string") throw new Error("this admin app was built without the auth app; deploy it again with npm run cloudflare-setup");
    return __PF_AUTH_APP_SOURCE__;
  },
  frameworkVersion: typeof __PF_FRAMEWORK_VERSION__ === "string" ? __PF_FRAMEWORK_VERSION__ : "unknown",
});

export const ADMIN_PAGES: readonly AdminPage[] = Object.freeze([setupPage, everydayPage, statusPage]);
