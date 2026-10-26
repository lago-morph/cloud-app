/**
 * The local commands bound to the framework's real components. Each binding imports its
 * components when the command runs, so one command never loads another's tooling (the build
 * does not load ESLint, `secrets set` does not load the migration checker).
 */
import { join } from "node:path";
import type { CloudflareSettingsOptions } from "./cloudflare-settings.js";
import type { ProcessEnvironment } from "./commands/smoke-cloud.js";
import type { Command } from "./io.js";

const lazy =
  (load: () => Promise<Command>): Command =>
  async (args, io) =>
    (await load())(args, io);

export const buildBinding: Command = lazy(async () => {
  const [{ buildCommand }, { buildApp }] = await Promise.all([import("./commands/build.js"), import("../build/build.js")]);
  return buildCommand({ buildApp });
});

export const generateMigrationBinding: Command = lazy(async () => {
  const [{ generateMigrationCommand }, { loadApp }, { generateAppMigrations }] = await Promise.all([
    import("./commands/generate-migration.js"),
    import("../build/load.js"),
    import("../mig/generate.js"),
  ]);
  return generateMigrationCommand({
    loadTables: async (appDir) => (await loadApp(appDir)).definition.tables,
    generate: async (appDir, tables, name) => {
      const result = await generateAppMigrations(appDir, tables, name);
      return result.status === "created" ? { status: "created", files: result.files.map((f) => join(appDir, "migrations", f)) } : result;
    },
  });
});

export const resetLocalBinding: Command = lazy(async () => (await import("./commands/reset-local.js")).resetLocalCommand());

/**
 * A command loaded when it runs whose Cloudflare form (`--target cloudflare`) is built with the
 * environment merged with `.env.cloudflare`, after the file's notices and git warnings are printed
 * (plan-setup-wizard §4.2 and §4.5; DEC-0570, DEC-0572). Every command that reaches Cloudflare is
 * bound through it.
 */
export const cloud =
  (name: string, load: (env: ProcessEnvironment) => Promise<Command>, options: CloudflareSettingsOptions = {}): Command =>
  async (args, io) =>
    // `{ withBootstrapToken: true }` opts out of DEC-0574 (the file's bootstrap token too): for `cloudflare-setup` only.
    (await import("./cloudflare-settings.js")).withCloudflareSettings(name, load, process.env, options)(args, io);

export const secretsBinding: Command = cloud("secrets set", async (env) => {
  const [{ secretsCommand }, { loadApp }, { setLocalSecret }, { cloudSecretsBinding }] = await Promise.all([
    import("./commands/secrets.js"),
    import("../build/load.js"),
    import("../secrets/local.js"),
    import("./commands/secrets-cloud.js"),
  ]);
  return secretsCommand({
    loadDeclaredSecrets: async (appDir) => (await loadApp(appDir)).definition.secrets,
    setLocalSecret,
    cloud: cloudSecretsBinding(env),
  });
});

export const verifyBinding: Command = lazy(async () => {
  const [{ verifyCommand }, check, { typeCheckApp }, { installedZodVersion, ZOD_VERSION }, { runAppTests }, git] = await Promise.all([
    import("./commands/verify.js"),
    import("../check/public.js"),
    import("./verify/type-check.js"),
    import("./verify/zod-version.js"),
    import("./verify/tests.js"),
    import("../provision/cloudflare/git-safety.js"),
  ]);
  return verifyCommand({
    typeCheck: typeCheckApp,
    portabilityRules: check.runPortabilityRules,
    migrationChecker: check.runMigrationChecker,
    zodVersion: async (appDir) => ({ expected: ZOD_VERSION, installed: installedZodVersion(appDir) }),
    runTests: runAppTests,
    gitSafetyWarnings: (appDir) => git.commandGitSafetyWarnings(git.inspectGitSafety(appDir)),
  });
});

export const devBinding: Command = lazy(async () => (await import("./commands/dev.js")).devBinding());

/** `mail last`: locally from `.mail/`, on Cloudflare from the account's mail sink. */
export const mailBinding: Command = cloud("mail", async (env) => {
  const { cloudflareSinkReader, mailCommand } = await import("./commands/mail.js");
  return mailCommand({ cloud: cloudflareSinkReader(env) });
});
