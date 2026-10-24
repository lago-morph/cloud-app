/**
 * The cloud store of `secrets set <name> --target <cloud> --stage <s>` (SEC-REQ-003,
 * SEC-REQ-004; D-05). `secrets.ts` (B-17) parses the arguments, checks the name and reads the
 * value from standard input; this module checks the stage and the process first, then writes
 * the value with the target's `setSecret` (Cloudflare: the Worker secret `SECRET_<NAME>`, which
 * needs the stage's Worker, so a stage's first deploy comes first: PROV §2 "First Cloudflare
 * deploy"). Nothing here prints or returns the value (CLI-REQ-004).
 */
import { secretLocation } from "../../config/secret-locations.js";
import type { Target } from "../../core/identity.js";
import type { TargetOperations } from "../../provision/core/operations.js";
import { checkedStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

export interface CloudSecretsDeps {
  readonly env: ProcessEnvironment;
  appName(appDir: string): Promise<string>;
  operations(input: { readonly appDir: string; readonly target: Target }): TargetOperations;
}

/** What `secrets.ts` calls for a cloud target. */
export interface CloudSecrets {
  /**
   * Before standard input is read: throws a usage error for an invalid stage name; prints the
   * process problems and returns 1 when the cloud cannot be reached; otherwise undefined.
   */
  refuse(target: Target, stage: string, io: { stderr(text: string): void }): number | undefined;
  /** Writes the value; resolves to where it went, for the owner (never the value). */
  set(appDir: string, target: Target, stage: string, name: string, value: string): Promise<string>;
}

function refuse(env: ProcessEnvironment, stage: string, io: { stderr(text: string): void }): number | undefined {
  checkedStage(stage);
  return refuseUnreachableCloud("secrets set", env, io);
}

async function setWith(deps: Omit<CloudSecretsDeps, "env">, appDir: string, target: Target, stage: string, name: string, value: string): Promise<string> {
  const app = await deps.appName(appDir);
  await deps.operations({ appDir, target }).setSecret({ app, stage }, name, value);
  const location = secretLocation(target, name, { app, stage });
  return target === "aws" ? `${location} (an SSM SecureString parameter of stage ${stage})` : `${location} (a Worker secret of stage ${stage})`;
}

export function cloudSecrets(deps: CloudSecretsDeps): CloudSecrets {
  return {
    refuse: (_target, stage, io) => refuse(deps.env, stage, io),
    set: (...args) => setWith(deps, ...args),
  };
}

/**
 * The real cloud store: the app loader and the target's operations from the process
 * environment, loaded only when a cloud secret is set (a local `secrets set` loads none of it).
 */
export function cloudSecretsBinding(env: ProcessEnvironment = process.env): CloudSecrets {
  return {
    refuse: (_target, stage, io) => refuse(env, stage, io),
    async set(...args) {
      const [{ loadApp }, { cloudflareOperations }] = await Promise.all([import("../../build/load.js"), import("./deploy.js")]);
      return setWith({ appName: async (appDir) => (await loadApp(appDir)).definition.name, operations: cloudflareOperations({ env, requireCredentials: true }) }, ...args);
    },
  };
}
