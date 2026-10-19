/**
 * CFG public names (contract: docs/contracts/ts/config.d.ts).
 * Stub written by B-01; implemented by B-09.
 */

export interface ConfigKey<T> {
  readonly $type: T;
}

export function configString(options?: { readonly default?: string }): ConfigKey<string> {
  throw new Error("not implemented: configString");
}

export function configInteger(options?: { readonly default?: number }): ConfigKey<number> {
  throw new Error("not implemented: configInteger");
}

export function configBoolean(options?: { readonly default?: boolean }): ConfigKey<boolean> {
  throw new Error("not implemented: configBoolean");
}

export function configStringList(options?: { readonly default?: readonly string[] }): ConfigKey<readonly string[]> {
  throw new Error("not implemented: configStringList");
}

/** App-declared keys: lowerCamelCase names mapped to key definitions. */
export type ConfigDeclaration = Record<string, ConfigKey<unknown>>;

export interface ConfigService<C extends ConfigDeclaration> {
  /** Value for this deployment. Values are fixed at deploy time. */
  get<K extends keyof C & string>(key: K): C[K]["$type"];
}
