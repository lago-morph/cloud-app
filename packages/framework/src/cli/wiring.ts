/**
 * The local commands bound to the framework's real components. Each binding imports its
 * components when the command runs, so one command never loads another's tooling (the build
 * does not load ESLint, `secrets set` does not load the migration checker).
 */
import { join } from "node:path";
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

export const secretsBinding: Command = lazy(async () => {
  const [{ secretsCommand }, { loadApp }, { setLocalSecret }, { cloudSecretsBinding }] = await Promise.all([
    import("./commands/secrets.js"),
    import("../build/load.js"),
    import("../secrets/local.js"),
    import("./commands/secrets-cloud.js"),
  ]);
  return secretsCommand({
    loadDeclaredSecrets: async (appDir) => (await loadApp(appDir)).definition.secrets,
    setLocalSecret,
    cloud: cloudSecretsBinding(),
  });
});

export const verifyBinding: Command = lazy(async () => {
  const [{ verifyCommand }, check, { typeCheckApp }, { installedZodVersion, ZOD_VERSION }, { runAppTests }] = await Promise.all([
    import("./commands/verify.js"),
    import("../check/public.js"),
    import("./verify/type-check.js"),
    import("./verify/zod-version.js"),
    import("./verify/tests.js"),
  ]);
  return verifyCommand({
    typeCheck: typeCheckApp,
    portabilityRules: check.runPortabilityRules,
    migrationChecker: check.runMigrationChecker,
    zodVersion: async (appDir) => ({ expected: ZOD_VERSION, installed: installedZodVersion(appDir) }),
    runTests: runAppTests,
  });
});

export const devBinding: Command = lazy(async () => (await import("./commands/dev.js")).devBinding());
