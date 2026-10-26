/**
 * PROV (`./provision` subpath) public names. No contract file declares app-facing names for this component;
 * the owning item adds them here.
 * Stub written by B-01; implemented by C-03, D-03, D-04.
 *
 * The local setup (plan-setup-wizard §3.1, DEC-0591): `npm create @lago-morph/prototype-app` loads it
 * from the new app's installed framework, so the starter and `cloudflare-setup` run the same steps.
 */
export { describeLocalSetup, runLocalSetup, type LocalSetupDeps, type LocalSetupOutcome, type LocalSetupStep } from "./core/local-setup.js";
/** The release's permission list and account setup versions (PAR-331, PAR-332): `upgrade` reads them from a fresh process. */
export { ACCOUNT_SETUP_VERSION, PERMISSIONS_VERSION } from "./cloudflare/permissions.js";
