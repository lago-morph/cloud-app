/**
 * GOOGLE names for the framework (never app-facing; no hub re-exports this file).
 * The build pipeline (B-16) installs the provider on production stages; the CLI's
 * `certify-auth` (B-17/D-05) calls the certification library.
 */
export { createGoogleLoginProvider, GOOGLE_CLIENT_ID_KEY, GOOGLE_CLIENT_SECRET_NAME } from "./provider.js";
export type { GoogleProviderOptions } from "./provider.js";
export { certifyAuth, checkLoginRedirect } from "./certify.js";
export type { CertifyIo, CertifyOptions, CertifyOutcome, EvidenceRecord, EvidenceResult, LoginRedirectCheck } from "./certify.js";
