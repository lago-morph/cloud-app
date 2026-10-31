/**
 * `upgrade [<version>]` (`npm run upgrade`; plan-setup-wizard §4.8a; DEC-0595), run deliberately by
 * the owner or the agent:
 * 1. pins `@lago-morph/prototype-framework` at the version named (default: npm's `latest`), and
 *    the app's companion pins (hono, zod, typescript, vite, vitest) at the versions that release
 *    depends on, then runs `npm install`;
 * 2. replaces `.claude/skills/prototype-framework` with the installed framework's `skill/` copy;
 * 3. runs `npm run verify`;
 * 4. says whether Cloudflare setup needs re-running, comparing PERMISSIONS_VERSION and
 *    ACCOUNT_SETUP_VERSION of the framework the app had with the new one's (`./provision`
 *    exports, read in a child process; absent means unknown); when it does, it points to the
 *    bootstrap and then the admin app's pages (plan-v0.2.0 §8);
 * 5. prints the cloud environment's setup script at the new version (pinned; DEC-0593).
 * Exit status 0 when every step passed, 1 otherwise (the upgrade stays applied; the message says
 * how to go back), 2 on a usage mistake.
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { compareVersions, FRAMEWORK_PACKAGE, installedFrameworkDir, isExactVersion, setupScriptLines, SKILL_DIR } from "./versions.js";

/** The app pins that move with the framework: the versions its own package.json depends on (skill hard rule 5). */
export const COMPANION_PINS: readonly string[] = ["hono", "zod", "typescript", "vite", "vitest"];

/** What `npm view <framework>@<spec>` says about a release. */
export interface Release {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
}

/** The versions a release's Cloudflare setup expects (batch 1's `permissions.ts`, exported from `./provision`). */
export interface SetupVersions {
  readonly permissions?: number;
  readonly accountSetup?: number;
}

export interface UpgradeDeps {
  /** The release `spec` names (`latest`, `next` or an exact version). */
  view(spec: string): Promise<Release>;
  /** `npm install` in the app directory. */
  install(appDir: string): Promise<void>;
  /** `npm run verify` in the app directory; true when it passed. */
  verify(appDir: string): Promise<boolean>;
  /** The installed framework's setup versions; undefined when it is not installed or exports neither. */
  setupVersions(appDir: string): Promise<SetupVersions | undefined>;
}

interface AppPackage {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const SPEC = /^(latest|next|\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?)$/;

function parseArgs(args: readonly string[]): string {
  if (args.length > 1) throw new UsageError("upgrade takes at most one argument: the version (default: latest)");
  const spec = args[0] ?? "latest";
  if (!SPEC.test(spec)) throw new UsageError("the version must be latest, next or an exact version such as 0.2.0");
  return spec;
}

/** The app's package.json with the framework and its companions pinned at `release`; the names changed. */
export function repin(pkg: AppPackage, release: Release): { pkg: AppPackage; changed: string[] } {
  const next: AppPackage = { ...pkg, dependencies: { ...(pkg.dependencies ?? {}) }, ...(pkg.devDependencies === undefined ? {} : { devDependencies: { ...pkg.devDependencies } }) };
  const changed: string[] = [];
  const set = (name: string, version: string): void => {
    for (const group of [next.dependencies, next.devDependencies]) {
      if (group?.[name] !== undefined && group[name] !== version) {
        group[name] = version;
        changed.push(`${name} ${version}`);
      }
    }
  };
  set(FRAMEWORK_PACKAGE, release.version);
  for (const name of COMPANION_PINS) {
    const version = release.dependencies[name];
    if (version !== undefined && isExactVersion(version)) set(name, version);
  }
  return { pkg: next, changed };
}

/** Step 4's sentence. */
export function cloudflareVerdict(before: SetupVersions | undefined, after: SetupVersions | undefined): string {
  const unknown = "Cloudflare setup: unknown whether this release needs more; run `npm run cloudflare-setup` to check (it does only what is missing).";
  if (after?.permissions === undefined || after.accountSetup === undefined || before?.permissions === undefined || before.accountSetup === undefined) return unknown;
  const raised: string[] = [];
  if (after.permissions > before.permissions) raised.push(`token permissions ${before.permissions} → ${after.permissions}`);
  if (after.accountSetup > before.accountSetup) raised.push(`account setup ${before.accountSetup} → ${after.accountSetup}`);
  if (raised.length === 0) return "Cloudflare setup: nothing new is needed; no need to re-run it.";
  // Since v0.2.0 the bootstrap deploys only the admin app; the account setup and the everyday token are its pages (plan-v0.2.0 §5, §8; DEC-0736).
  return `Cloudflare setup needs re-running (${raised.join(", ")}): make a new bootstrap token with an expiry of 1 day or less and run \`npm run cloudflare-setup\`, which deploys the admin app. Then open the admin app it prints, sign in, and use its Account setup and Everyday token pages.`;
}

export function upgradeCommand(deps: UpgradeDeps): Command {
  return async (args, io) => {
    const spec = parseArgs(args);
    const pkgFile = join(io.cwd, "package.json");
    const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as AppPackage;
    if (pkg.dependencies?.[FRAMEWORK_PACKAGE] === undefined) {
      io.stderr(`upgrade: this app's package.json does not depend on ${FRAMEWORK_PACKAGE}\n`);
      return EXIT.failed;
    }
    const goBack = "To go back: `git checkout -- package.json package-lock.json .claude/skills/prototype-framework`, then `npm install`.";
    const before = await deps.setupVersions(io.cwd).catch(() => undefined);
    const release = await deps.view(spec);
    if (!isExactVersion(release.version)) throw new Error(`npm named an unexpected version for ${FRAMEWORK_PACKAGE}@${spec}`);
    const from = pkg.dependencies[FRAMEWORK_PACKAGE];
    if (isExactVersion(from) && compareVersions(release.version, from) < 0) {
      io.stdout(`note: ${release.version} is older than the app's ${from}; moving to it as asked.\n`);
    }

    // 1. Pins and install.
    const { pkg: next, changed } = repin(pkg, release);
    if (changed.length > 0) writeFileSync(pkgFile, `${JSON.stringify(next, null, 2)}\n`);
    io.stdout(changed.length === 0 ? `1. ${FRAMEWORK_PACKAGE} is already pinned at ${release.version}; running npm install\n` : `1. pinned ${changed.join(", ")}; running npm install\n`);
    try {
      await deps.install(io.cwd);
    } catch (error) {
      io.stderr(`upgrade: npm install failed: ${error instanceof Error ? error.message : String(error)}\n${goBack}\n`);
      return EXIT.failed;
    }

    // 2. The committed skill copy.
    let ok = true;
    const installed = installedFrameworkDir(io.cwd);
    const source = installed === undefined ? undefined : join(installed, "skill");
    const target = join(io.cwd, SKILL_DIR);
    if (source === undefined || !existsSync(join(source, "SKILL.md"))) {
      io.stdout(`2. WARNING: the installed framework has no skill/ copy, so ${SKILL_DIR} was left as it was\n`);
      ok = false;
    } else {
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true });
      io.stdout(`2. refreshed ${SKILL_DIR} from the installed framework\n`);
    }

    // 3. verify.
    io.stdout("3. running npm run verify\n");
    const verified = await deps.verify(io.cwd).catch(() => false);
    if (!verified) {
      io.stdout(`   verify failed: the upgrade is applied; fix what verify reports, or go back. ${goBack}\n`);
      ok = false;
    } else io.stdout("   verify passed\n");

    // 4. Cloudflare.
    const after = await deps.setupVersions(io.cwd).catch(() => undefined);
    io.stdout(`4. ${cloudflareVerdict(before, after)}\n`);

    // 5. The setup script.
    io.stdout(`5. ${setupScriptLines(release.version)}`);
    io.stdout(ok ? `upgraded to ${release.version}\n` : `upgrade to ${release.version} finished with problems (above)\n`);
    return ok ? EXIT.ok : EXIT.failed;
  };
}

/** Runs `command args` in `cwd`, output shown; resolves to its exit status. */
function run(command: string, args: readonly string[], cwd: string, capture = false): Promise<{ status: number; out: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", shell: process.platform === "win32" });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString("utf8")));
    child.on("error", fail);
    child.on("exit", (code) => done({ status: code ?? 1, out }));
  });
}

/** Reads the setup versions in a fresh Node process, so the newly installed files are the ones read. */
const READ_SETUP_VERSIONS = `import(${JSON.stringify(`${FRAMEWORK_PACKAGE}/provision`)}).then((m) => process.stdout.write(JSON.stringify({ permissions: m.PERMISSIONS_VERSION, accountSetup: m.ACCOUNT_SETUP_VERSION })), () => process.stdout.write("{}"));`;

export function upgradeBinding(): Command {
  return upgradeCommand({
    view: async (spec) => {
      const r = await run("npm", ["view", `${FRAMEWORK_PACKAGE}@${spec}`, "version", "dependencies", "--json"], process.cwd(), true);
      if (r.status !== 0) throw new Error(`npm view ${FRAMEWORK_PACKAGE}@${spec} failed (status ${r.status}); check the version and the network`);
      const parsed = JSON.parse(r.out) as { version?: unknown; dependencies?: unknown } | readonly unknown[];
      const one = (Array.isArray(parsed) ? parsed.at(-1) : parsed) as { version?: unknown; dependencies?: unknown } | undefined;
      if (typeof one?.version !== "string") throw new Error(`npm view ${FRAMEWORK_PACKAGE}@${spec} named no version`);
      return { version: one.version, dependencies: (one.dependencies ?? {}) as Record<string, string> };
    },
    install: async (appDir) => {
      const r = await run("npm", ["install", "--no-audit", "--no-fund"], appDir);
      if (r.status !== 0) throw new Error(`exit status ${r.status}`);
    },
    verify: async (appDir) => (await run("npm", ["run", "verify"], appDir)).status === 0,
    setupVersions: async (appDir) => {
      if (installedFrameworkDir(appDir) === undefined) return undefined;
      const r = await run(process.execPath, ["--input-type=module", "-e", READ_SETUP_VERSIONS], appDir, true);
      const v = JSON.parse(r.out === "" ? "{}" : r.out) as { permissions?: unknown; accountSetup?: unknown };
      const n = (x: unknown): number | undefined => (typeof x === "number" ? x : undefined);
      const permissions = n(v.permissions);
      const accountSetup = n(v.accountSetup);
      return permissions === undefined && accountSetup === undefined ? undefined : { ...(permissions === undefined ? {} : { permissions }), ...(accountSetup === undefined ? {} : { accountSetup }) };
    },
  });
}
