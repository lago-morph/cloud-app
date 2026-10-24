/**
 * Secret locations per target, by SEC's naming convention (SEC-REQ-003, secrets.md §2 "Names").
 * CFG records them in the resolved configuration (CFG-REQ-004); SEC (B-10) reads secrets from
 * the same locations and may import `secretLocation` from here.
 *
 * - local: `SECRET_<NAME>` in `.dev.vars`;
 * - cloudflare: the Worker secret `SECRET_<NAME>`;
 * - aws: the SSM SecureString parameter `/<app>/<stage>/secrets/<name>`, with the logical name
 *   unchanged, so the location depends on the stage.
 */
import type { Target } from "../core/identity.js";

/** The targets whose secrets are environment bindings named `SECRET_<NAME>`. */
export type EnvSecretTarget = Exclude<Target, "aws">;

/** The deployment a per-stage secret location belongs to (AWS). */
export interface SecretScope {
  readonly app: string;
  readonly stage: string;
}

/** lowerCamelCase → UPPER_SNAKE_CASE: an underscore before each capital letter. */
export function upperSnake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase();
}

/** Where secret `name` is stored on `target`. An AWS location is per stage, so it needs `scope`. */
export function secretLocation(target: EnvSecretTarget, name: string, scope?: SecretScope): string;
export function secretLocation(target: Target, name: string, scope: SecretScope): string;
export function secretLocation(target: Target, name: string, scope?: SecretScope): string {
  if (target === "aws") {
    if (scope === undefined) throw new Error(`the AWS location of secret ${name} needs the app and stage`);
    return `/${scope.app}/${scope.stage}/secrets/${name}`;
  }
  return `SECRET_${upperSnake(name)}`;
}
