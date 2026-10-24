/**
 * Runtime form of a declared configuration key (CFG-REQ-001). App code sees only the opaque
 * `ConfigKey<T>`; the framework reads the type and default through `keyDefinition`.
 */
import type { ConfigKey } from "./public.js";

export type KeyKind = "string" | "integer" | "boolean" | "stringList";

/** A configuration value: string, integer, boolean, or string list. */
export type ConfigValue = string | number | boolean | readonly string[];

export interface KeyDefinition {
  readonly kind: KeyKind;
  readonly hasDefault: boolean;
  readonly default?: ConfigValue;
}

const DEFINITION = Symbol("config key definition");

interface DeclaredKey<T> extends ConfigKey<T> {
  readonly [DEFINITION]: KeyDefinition;
}

/** Builds the opaque key object for one declaration. `$type` is a type-level marker only. */
export function declareKey<T>(kind: KeyKind, options: { readonly default?: ConfigValue } | undefined): ConfigKey<T> {
  const value = options?.default;
  const definition: KeyDefinition = Object.freeze(
    value === undefined ? { kind, hasDefault: false } : { kind, hasDefault: true, default: freezeValue(value) },
  );
  const key = { $type: undefined as T, [DEFINITION]: definition } satisfies DeclaredKey<T>;
  return Object.freeze(key);
}

export function keyDefinition(key: ConfigKey<unknown>): KeyDefinition {
  const definition = (key as Partial<DeclaredKey<unknown>>)[DEFINITION];
  if (definition === undefined) {
    throw new TypeError("not a configuration key: declare keys with configString, configInteger, configBoolean, or configStringList");
  }
  return definition;
}

/** A frozen copy of a list value; other values are returned as they are. */
export function freezeValue(value: ConfigValue): ConfigValue {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
}
