/**
 * Secret names (secrets.md §2 "Names", "Framework-internal secrets"; DEC-0064).
 * Workers-compatible (no Node APIs).
 */
import { FrameworkError } from "../core/errors.js";
import type { LocalFrameworkSecretName } from "./local-names.js";

/** Reserved prefix of framework-internal secret names; app declarations cannot use it. */
export const FRAMEWORK_SECRET_PREFIX = "framework";

/**
 * Framework-internal secrets of every target, read only by framework code (never through the
 * app's service). The Google client secret's name is the one GOOGLE reads (DEC-0176).
 * This module is in every cloud bundle, so local-only names live in `local-names.ts`
 * (CORE-REQ-006, DEC-0194).
 */
export const FRAMEWORK_SECRETS = Object.freeze({
  /** AUTH's session signing key (PAR-253); generated per stage by the CLI when absent. */
  sessionKey: "frameworkSessionKey",
  /** GOOGLE's OAuth client secret; set by the owner with `secrets set`. */
  googleClientSecret: "frameworkGoogleClientSecret",
  /** FILES' stage-scoped R2 API token (S3 credentials), created by provisioning on Cloudflare. */
  r2AccessKeyId: "frameworkR2AccessKeyId",
  r2SecretAccessKey: "frameworkR2SecretAccessKey",
} as const);

/** Every framework-internal name, local-only ones included (a type only: no name in a bundle). */
export type FrameworkSecretName = (typeof FRAMEWORK_SECRETS)[keyof typeof FRAMEWORK_SECRETS] | LocalFrameworkSecretName;

/** True when `name` starts with the reserved `framework` prefix. */
export function isReservedSecretName(name: string): boolean {
  return name.startsWith(FRAMEWORK_SECRET_PREFIX);
}

/** Logical names are lowerCamelCase (secrets.md §2), the same rule as CFG keys. */
const SECRET_NAME = /^[a-z][a-zA-Z0-9]*$/;

/**
 * Build-time check of the app's declared secret names. Throws CORE.MISCONFIGURED listing every
 * problem, like CFG's build checks; never called at declaration time (defineApp never throws).
 */
export function checkSecretDeclarations(names: readonly string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      problems.push(`secret "${name}" is declared more than once`);
      continue;
    }
    seen.add(name);
    if (!SECRET_NAME.test(name)) problems.push(`secret "${name}" is not a lowerCamelCase name`);
    else if (isReservedSecretName(name)) problems.push(`secret "${name}" uses the reserved prefix "${FRAMEWORK_SECRET_PREFIX}"`);
  }
  if (problems.length > 0) {
    throw new FrameworkError("CORE.MISCONFIGURED", `the app's secret declarations are invalid:\n- ${problems.join("\n- ")}`);
  }
}
