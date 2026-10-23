/**
 * Build pipeline (framework-internal; no package subpath). The CLI (B-17) calls `buildApp`
 * for `build`, `dev` and `deploy`, and `loadApp` wherever it needs the app definition
 * (`generate-migration`, `secrets set`).
 */
export { buildApp, entrySource, localWranglerConfig, COMPATIBILITY_DATE, PACKAGE_NAME } from "./build.js";
export type { BuildOptions, BuildResult } from "./build.js";
export { loadApp, loadAppModule, APP_ENTRY, BUILD_DIR } from "./load.js";
export type { AnyDefinedApp, LoadedApp } from "./load.js";
