/**
 * Every Cloudflare command's settings (plan-setup-wizard §4.2 and §4.5; DEC-0570, DEC-0572): a
 * command run with `--target cloudflare` gets the process environment merged with the project's
 * `.env.cloudflare` (`cloudflareEnvironment`, the environment winning), so nobody exports the
 * variables by hand. Before the command runs, its notices (a setting that differs between the two
 * sources, by name) and the file's git warnings (not ignored, tracked) are printed to standard
 * error, on every run. They never fail the command. A command on another target reads no file.
 * The file's bootstrap token is left out (DEC-0574): these commands work with the everyday token,
 * and a token they do not use does not reach their tools' processes (SST).
 */

export interface CloudflareSettingsOptions {
  /** Opt out of DEC-0574: also pass the file's `CLOUDFLARE_BOOTSTRAP_TOKEN` (`cloudflare-setup` only). */
  readonly withBootstrapToken?: boolean;
}
import { commandGitSafetyWarnings, inspectGitSafety } from "../provision/cloudflare/git-safety.js";
import { mergeCloudflareSettings, readCloudflareSettings } from "../provision/cloudflare/token-sources.js";
import type { CliIo, Command } from "./io.js";
import { targetArgument, type ProcessEnvironment } from "./commands/smoke-cloud.js";

const RULE = "=".repeat(78);

/** A warning set off so that it is not lost in a command's output. */
export function formatGitWarning(command: string, warning: string): string {
  return `${RULE}\n${command}: WARNING: ${warning}\n${RULE}\n`;
}

/** Prints the git warnings for `.env.cloudflare` in `dir` (none outside a repository). Never throws. */
export function printGitSafetyWarnings(command: string, dir: string, io: Pick<CliIo, "stderr">): void {
  for (const warning of commandGitSafetyWarnings(inspectGitSafety(dir))) io.stderr(formatGitWarning(command, warning));
}

/**
 * The environment a Cloudflare command runs with, after printing the sources' notices and the
 * file's warnings to `io` (only when the file exists or is tracked, inside a repository).
 */
export function commandCloudflareEnvironment(command: string, env: ProcessEnvironment, io: Pick<CliIo, "cwd" | "stderr">, options: CloudflareSettingsOptions = {}): ProcessEnvironment {
  const settings = readCloudflareSettings(io.cwd, env);
  for (const notice of settings.notices) io.stderr(`${command}: note: ${notice}\n`);
  printGitSafetyWarnings(command, io.cwd, io);
  if (options.withBootstrapToken === true) return mergeCloudflareSettings(env, settings);
  const everyday = Object.fromEntries(Object.entries(settings.values).filter(([name]) => name !== "CLOUDFLARE_BOOTSTRAP_TOKEN"));
  return mergeCloudflareSettings(env, { ...settings, values: everyday });
}

/**
 * `load`'s command, built with the merged environment when the arguments name `--target cloudflare`
 * and with `env` unchanged otherwise.
 */
export function withCloudflareSettings(
  command: string,
  load: (env: ProcessEnvironment) => Command | Promise<Command>,
  env: ProcessEnvironment = process.env,
  options: CloudflareSettingsOptions = {},
): Command {
  return async (args, io) => {
    const merged = targetArgument(args) === "cloudflare" ? commandCloudflareEnvironment(command, env, io, options) : env;
    return (await load(merged))(args, io);
  };
}
