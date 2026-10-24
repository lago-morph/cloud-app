/**
 * Build-time resolution (config.md §2 "Resolution", CFG-REQ-002, CFG-REQ-004, CFG-REQ-005).
 * Combines the validated values file, the app's declared keys and defaults, the deployment
 * identity, and the declared secrets' locations into the value the build embeds (DEC-0063).
 * Values known only after provisioning reach the runtime through the target's deployment-time
 * settings and are read by framework adapters, not recorded here.
 */
import { FrameworkError } from "../core/errors.js";
import type { Deployment } from "../core/identity.js";
import { freezeValue, keyDefinition, type ConfigValue, type KeyKind } from "./keys.js";
import type { ConfigDeclaration } from "./public.js";
import type { StageConfigFile } from "./schema.js";
import { secretLocation } from "./secret-locations.js";

export interface ResolvedSecret {
  /** Logical name, as declared by the app. */
  readonly name: string;
  /** Location on the deployment's target (SEC-REQ-003). */
  readonly location: string;
}

/** The resolved configuration of one deployment. Contains no secret values. */
export interface ResolvedConfig {
  readonly deployment: Deployment;
  /** Every declared key with its value for this deployment. */
  readonly values: Readonly<Record<string, ConfigValue>>;
  readonly admins: readonly string[];
  /** Present exactly when `framework.users` is in the values file. */
  readonly users?: readonly string[];
  readonly google?: { readonly clientId: string };
  readonly secrets: readonly ResolvedSecret[];
}

export interface ResolveInput {
  readonly deployment: Deployment;
  readonly declaration: ConfigDeclaration;
  /** Logical names of the secrets the app declares. */
  readonly secrets: readonly string[];
  /** Path of the values file, for messages. */
  readonly file: string;
  readonly config: StageConfigFile;
}

const KEY_NAME = /^[a-z][a-zA-Z0-9]*$/;

const EXPECTED: Record<KeyKind, string> = {
  string: "a string",
  integer: "an integer",
  boolean: "a boolean",
  stringList: "a list of strings",
};

/** Throws CORE.MISCONFIGURED naming the file and every key with a problem. */
export function resolveConfig(input: ResolveInput): ResolvedConfig {
  const problems: string[] = [];
  const values: Record<string, ConfigValue> = {};
  for (const [name, key] of Object.entries(input.declaration)) {
    if (!KEY_NAME.test(name)) {
      problems.push(`key "${name}" is not a lowerCamelCase name`);
      continue;
    }
    const { kind, hasDefault, default: fallback } = keyDefinition(key);
    if (hasDefault && !hasKind(fallback, kind)) {
      problems.push(`key "${name}": the declared default must be ${EXPECTED[kind]}`);
      continue;
    }
    const committed = Object.hasOwn(input.config.values, name) ? input.config.values[name] : undefined;
    if (committed === undefined) {
      if (hasDefault) values[name] = fallback as ConfigValue;
      else problems.push(`key "${name}" is missing: it has no default, so the values file must set it`);
    } else if (!hasKind(committed, kind)) {
      problems.push(`key "${name}" must be ${EXPECTED[kind]}`);
    } else {
      values[name] = freezeValue(committed);
    }
  }
  for (const name of Object.keys(input.config.values)) {
    if (!Object.hasOwn(input.declaration, name)) problems.push(`key "${name}" is not declared by the app`);
  }
  if (problems.length > 0) {
    throw new FrameworkError("CORE.MISCONFIGURED", `configuration for stage "${input.deployment.stage}" from ${input.file} is invalid:\n- ${problems.join("\n- ")}`);
  }
  const { admins, users, google } = input.config.framework;
  return Object.freeze({
    deployment: input.deployment,
    values: Object.freeze(values),
    admins: Object.freeze([...admins]),
    ...(users === undefined ? {} : { users: Object.freeze([...users]) }),
    ...(google === undefined ? {} : { google: Object.freeze({ clientId: google.clientId }) }),
    secrets: Object.freeze(
      input.secrets.map((name) => Object.freeze({ name, location: secretLocation(input.deployment.target, name, input.deployment) })),
    ),
  });
}

function hasKind(value: unknown, kind: KeyKind): boolean {
  switch (kind) {
    case "string":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "stringList":
      return Array.isArray(value) && value.every((item) => typeof item === "string");
  }
}
