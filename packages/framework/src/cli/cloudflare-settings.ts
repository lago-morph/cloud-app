/**
 * Every Cloudflare command's settings (DEC-0795; earlier plan-setup-wizard §4.2 and §4.5, DEC-0572):
 * a command run with `--target cloudflare` gets the process environment merged with the secrets
 * file (`~/.secrets/cloudflare`, or `CLOUDFLARE_SECRETS_FILE`; `cloudflareEnvironment`, the
 * environment winning), so nobody exports the variables by hand. Before the command runs, its
 * notices (a setting that differs between the two sources, by name; a secrets file others can read;
 * an old `.env.cloudflare` or `CLOUDFLARE_BOOTSTRAP_TOKEN` that is no longer read) and the old
 * file's git warnings (not ignored, tracked) are printed to standard error, on every run. They never
 * fail the command. A command on another target reads no file. The retired bootstrap token never
 * reaches the command's tools' processes (SST).
 */
import { commandGitSafetyWarnings, inspectGitSafety } from "../provision/cloudflare/git-safety.js";
import { mergeCloudflareSettings, readCloudflareSettings } from "../provision/cloudflare/token-sources.js";
import type { CliIo, Command } from "./io.js";
import { targetArgument, type ProcessEnvironment } from "./commands/smoke-cloud.js";

const RULE = "=".repeat(78);

/** A warning set off so that it is not lost in a command's output. */
export function formatGitWarning(command: string, warning: string): string {
  return `${RULE}\n${command}: WARNING: ${warning}\n${RULE}\n`;
}

/** Prints the git warnings for an old `.env.cloudflare` in `dir` (none outside a repository). Never throws. */
export function printGitSafetyWarnings(command: string, dir: string, io: Pick<CliIo, "stderr">): void {
  for (const warning of commandGitSafetyWarnings(inspectGitSafety(dir))) io.stderr(formatGitWarning(command, warning));
}

/**
 * The environment a Cloudflare command runs with, after printing the sources' notices and the old
 * file's warnings to `io` (only when that file exists or is tracked, inside a repository).
 */
export function commandCloudflareEnvironment(command: string, env: ProcessEnvironment, io: Pick<CliIo, "cwd" | "stderr">): ProcessEnvironment {
  const settings = readCloudflareSettings(env, { projectDir: io.cwd });
  for (const notice of settings.notices) io.stderr(`${command}: note: ${notice}\n`);
  printGitSafetyWarnings(command, io.cwd, io);
  return mergeCloudflareSettings(env, settings);
}

/**
 * `load`'s command, built with the merged environment when the arguments name `--target cloudflare`
 * and with `env` unchanged otherwise.
 */
export function withCloudflareSettings(command: string, load: (env: ProcessEnvironment) => Command | Promise<Command>, env: ProcessEnvironment = process.env): Command {
  return async (args, io) => {
    const merged = targetArgument(args) === "cloudflare" ? commandCloudflareEnvironment(command, env, io) : env;
    return (await load(merged))(args, io);
  };
}
