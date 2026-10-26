/**
 * Git-ignore safety of `.env.cloudflare` (plan-setup-wizard §4.3 step 1 and §4.5; DEC-0572).
 * The file holds the Cloudflare tokens, so it must never reach a commit. These checks never block
 * and never fail a command (owner, 2026-10-26: some users have no remote, or a private one, and
 * accept the risk); they produce prominent warnings that the CLI prints on every run:
 * - the file exists but git does not ignore it (`git check-ignore -q`);
 * - the file is tracked (`git ls-files --error-unmatch`): its tokens are then in the history, and
 *   the warning says how to replace them;
 * - the project is not a git repository (setup's warning; the other commands leave it out).
 *
 * `ensureEnvCloudflareIgnored` adds the file to the project's `.gitignore`, unless the user has
 * opted out with the marker line `# keep-env-cloudflare-tracked` (PAR-343). No function here
 * throws: a missing `git` reads as "not a git repository".
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_CLOUDFLARE_FILE } from "./token-sources.js";

/** The `.gitignore` line by which the user keeps `.env.cloudflare` out of the ignore list on purpose (PAR-343). */
export const KEEP_TRACKED_MARKER = "# keep-env-cloudflare-tracked";

export interface GitSafety {
  /** The project directory is inside a git work tree. */
  readonly isRepo: boolean;
  /** `.env.cloudflare` exists in the project directory. */
  readonly fileExists: boolean;
  /** Git ignores `.env.cloudflare` (false when it is tracked, as git ignores no tracked file). */
  readonly ignored: boolean;
  /** `.env.cloudflare` is in git's index. */
  readonly tracked: boolean;
  /** The project's `.gitignore` has the `KEEP_TRACKED_MARKER` line. */
  readonly keepTrackedMarker: boolean;
}

/** Runs git quietly in `cwd`; true on exit status 0, false on any other status or when git cannot run. */
function gitSucceeds(cwd: string, args: readonly string[]): boolean {
  try {
    execFileSync("git", args, { cwd, stdio: "ignore", timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function gitignoreLines(projectDir: string): string[] {
  try {
    const path = join(projectDir, ".gitignore");
    return existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()) : [];
  } catch {
    return [];
  }
}

/** The git state of `.env.cloudflare` in `projectDir`. Never throws. */
export function inspectGitSafety(projectDir: string): GitSafety {
  let fileExists = false;
  try {
    fileExists = existsSync(join(projectDir, ENV_CLOUDFLARE_FILE));
  } catch {
    fileExists = false;
  }
  const keepTrackedMarker = gitignoreLines(projectDir).includes(KEEP_TRACKED_MARKER);
  const isRepo = gitSucceeds(projectDir, ["rev-parse", "--is-inside-work-tree"]);
  if (!isRepo) return { isRepo, fileExists, ignored: false, tracked: false, keepTrackedMarker };
  const tracked = gitSucceeds(projectDir, ["ls-files", "--error-unmatch", "--", ENV_CLOUDFLARE_FILE]);
  const ignored = !tracked && gitSucceeds(projectDir, ["check-ignore", "-q", "--", ENV_CLOUDFLARE_FILE]);
  return { isRepo, fileExists, ignored, tracked, keepTrackedMarker };
}

const REPLACE_TOKENS =
  "Treat the tokens in it as leaked: delete them in the Cloudflare dashboard (Manage account > Account API tokens), " +
  "stop tracking the file with `git rm --cached .env.cloudflare` and commit that, make sure `.env.cloudflare` is in .gitignore, " +
  "then run the Cloudflare setup again (npm run cloudflare-setup) to make new tokens.";

/**
 * The warnings for `safety`, each one self-contained text that names what to do; empty when there
 * is nothing to warn about. Never a failure: the caller prints them and carries on. The
 * not-a-repository warning is setup's (plan §4.3 step 1); other commands print only the others.
 */
export function gitSafetyWarnings(safety: GitSafety): string[] {
  if (!safety.isRepo) {
    return [
      "This project is not a git repository, so nothing records or protects its history. " +
        "If you make it one later, check that .env.cloudflare is listed in .gitignore before the first commit, because it holds your Cloudflare tokens.",
    ];
  }
  const warnings: string[] = [];
  if (safety.tracked) {
    warnings.push(`.env.cloudflare is tracked by git, so the Cloudflare tokens in it are in the repository's history (and on any remote it was pushed to). ${REPLACE_TOKENS}`);
  } else if (safety.fileExists && !safety.ignored) {
    const marker = safety.keepTrackedMarker ? ` Your .gitignore has the line "${KEEP_TRACKED_MARKER}", so setup will not add it for you.` : "";
    warnings.push(
      `.env.cloudflare holds your Cloudflare tokens and git does not ignore it: a \`git add .\` or \`git commit -a\` would put the tokens in the history. Add the line ".env.cloudflare" to .gitignore.${marker}`,
    );
  }
  return warnings;
}

/** The warnings a command other than setup prints: the file's warnings only, nothing outside a repository. */
export function commandGitSafetyWarnings(safety: GitSafety): string[] {
  return safety.isRepo ? gitSafetyWarnings(safety) : [];
}

/**
 * Adds `.env.cloudflare` to the project's `.gitignore` unless git already ignores it, the
 * `.gitignore` already lists it, or the user opted out with `KEEP_TRACKED_MARKER`. Adding the line
 * never untracks a tracked file; the tracked warning says how. Never throws for git's state; a
 * `.gitignore` that cannot be written throws its file-system error.
 */
export function ensureEnvCloudflareIgnored(projectDir: string): "added" | "already" | "kept-tracked-marker" | "not-a-repo" {
  if (!gitSucceeds(projectDir, ["rev-parse", "--is-inside-work-tree"])) return "not-a-repo";
  if (gitSucceeds(projectDir, ["check-ignore", "-q", "--no-index", "--", ENV_CLOUDFLARE_FILE])) return "already";
  const lines = gitignoreLines(projectDir);
  if (lines.includes(ENV_CLOUDFLARE_FILE) || lines.includes(`/${ENV_CLOUDFLARE_FILE}`)) return "already";
  if (lines.includes(KEEP_TRACKED_MARKER)) return "kept-tracked-marker";
  const path = join(projectDir, ".gitignore");
  let prefix = "";
  try {
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    prefix = text === "" || text.endsWith("\n") ? "" : "\n";
  } catch {
    prefix = "";
  }
  appendFileSync(path, `${prefix}# Cloudflare tokens (never commit)\n${ENV_CLOUDFLARE_FILE}\n`, "utf8");
  return "added";
}
