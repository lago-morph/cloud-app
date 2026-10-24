/**
 * Build pipeline (framework-internal; no package subpath). The CLI (B-17) calls `buildApp`
 * for `build`, `dev` and `deploy`, and `loadApp` wherever it needs the app definition
 * (`generate-migration`, `secrets set`).
 */
export { buildApp, entrySource, localWranglerConfig, AWS_LAMBDA_CODE, COMPATIBILITY_DATE, PACKAGE_NAME } from "./build.js";
export { inspectBundle, environmentSecretValues, AWS_BUNDLE_MAX_BYTES, AWS_BUNDLE_RULES, CLI_ONLY_AWS_CLIENTS } from "./inspect.js";
export type { BundleUnderInspection, ForbiddenRule } from "./inspect.js";
export type { BuildOptions, BuildResult, LambdaCode } from "./build.js";
export { loadApp, loadAppModule, APP_ENTRY, BUILD_DIR } from "./load.js";
export type { AnyDefinedApp, LoadedApp } from "./load.js";
