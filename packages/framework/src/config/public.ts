/**
 * CFG public names (contract: docs/contracts/ts/config.d.ts). Behavior: docs/components/config.md.
 * Framework-internal parts: `keys.ts` (key definitions), `schema.ts` (values-file validation),
 * `files.ts` (per-stage file selection), `resolve.ts` (build-time resolution), `embed.ts`
 * (generated module), `service.ts` (`ConfigService`), `secret-locations.ts`.
 */
import { declareKey } from "./keys.js";

export interface ConfigKey<T> {
  readonly $type: T;
}

export function configString(options?: { readonly default?: string }): ConfigKey<string> {
  return declareKey("string", options);
}

export function configInteger(options?: { readonly default?: number }): ConfigKey<number> {
  return declareKey("integer", options);
}

export function configBoolean(options?: { readonly default?: boolean }): ConfigKey<boolean> {
  return declareKey("boolean", options);
}

export function configStringList(options?: { readonly default?: readonly string[] }): ConfigKey<readonly string[]> {
  return declareKey("stringList", options);
}

/** App-declared keys: lowerCamelCase names mapped to key definitions. */
export type ConfigDeclaration = Record<string, ConfigKey<unknown>>;

export interface ConfigService<C extends ConfigDeclaration> {
  /** Value for this deployment. Values are fixed at deploy time. */
  get<K extends keyof C & string>(key: K): C[K]["$type"];
}
