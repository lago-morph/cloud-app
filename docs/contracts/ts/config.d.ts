/**
 * Configuration (CFG). Behavior: docs/components/config.md.
 * Per-stage values file format: contracts/schemas/stage-config.schema.json.
 */

export interface ConfigKey<T> {
  readonly $type: T;
}

export declare function configString(options?: { readonly default?: string }): ConfigKey<string>;
export declare function configInteger(options?: { readonly default?: number }): ConfigKey<number>;
export declare function configBoolean(options?: { readonly default?: boolean }): ConfigKey<boolean>;
export declare function configStringList(options?: { readonly default?: readonly string[] }): ConfigKey<readonly string[]>;

/** App-declared keys: lowerCamelCase names mapped to key definitions. */
export type ConfigDeclaration = Record<string, ConfigKey<unknown>>;

export interface ConfigService<C extends ConfigDeclaration> {
  /** Value for this deployment. Values are fixed at deploy time. */
  get<K extends keyof C & string>(key: K): C[K]["$type"];
}
