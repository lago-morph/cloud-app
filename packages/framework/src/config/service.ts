/**
 * The runtime `ConfigService` (CFG-REQ-001, CFG-REQ-003): reads the values embedded by the
 * build. Read-only; values change only with a new build and deploy. Workers-compatible (no
 * Node APIs), so target runtimes can bundle it.
 */
import { FrameworkError } from "../core/errors.js";
import { freezeValue, type ConfigValue } from "./keys.js";
import type { ConfigDeclaration, ConfigService } from "./public.js";
import type { ResolvedConfig } from "./resolve.js";

/** Builds the service over the resolved (embedded) values. Throws CFG.UNDECLARED_KEY for any other key. */
export function createConfigService<C extends ConfigDeclaration>(resolved: Pick<ResolvedConfig, "values">): ConfigService<C> {
  const values = new Map<string, ConfigValue>(Object.entries(resolved.values).map(([key, value]) => [key, freezeValue(value)]));
  return Object.freeze({
    get<K extends keyof C & string>(key: K): C[K]["$type"] {
      if (!values.has(key)) {
        throw new FrameworkError("CFG.UNDECLARED_KEY", `configuration key ${JSON.stringify(key)} is not declared by the app`);
      }
      return values.get(key) as C[K]["$type"];
    },
  });
}
