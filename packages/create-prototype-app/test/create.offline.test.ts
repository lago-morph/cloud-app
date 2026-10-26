// End to end, offline: pack the framework and this starter as npm would publish them, run the
// packed starter into a temp folder against the framework tarball, install with
// `npm ci --offline` (from the npm cache the repository's `npm ci` filled), then build and verify
// the new app, after the local setup the starter runs once npm install has (plan-setup-wizard §3.1).
// Needs the framework built (`npm run build -w packages/framework`); the pack does
// not rebuild it, so it never rewrites dist/ under other suites running at the same time.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { appLockfile } from "./lockfile.js";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PKG_DIR, "..", "..");
const TIMEOUT = 15 * 60_000;
const root = mkdtempSync(join(tmpdir(), "create-offline-"));
// Removing the app's node_modules can take over the default 10 s hook limit on a loaded machine.
afterAll(() => rmSync(root, { recursive: true, force: true }), 120_000);

const npm = (args: string[], cwd: string): string =>
  execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, npm_config_update_notifier: "false" } });

function pack(dir: string, ignoreScripts: boolean): string {
  const out = npm(["pack", "--json", "--pack-destination", root, ...(ignoreScripts ? ["--ignore-scripts"] : [])], dir);
  const [packed] = JSON.parse(out) as { filename: string }[];
  return join(root, (packed as { filename: string }).filename);
}

describe("npm create, offline, against a packed framework", () => {
  it(
    "creates an app that installs offline, builds and passes verify",
    async () => {
      expect(existsSync(join(REPO, "packages", "framework", "dist", "index.js")), "build the framework first").toBe(true);
      const fw = pack(join(REPO, "packages", "framework"), true);
      const starter = pack(PKG_DIR, false); // prepack bundles the template and the skill
      const ext = join(root, "starter");
      mkdirSync(ext);
      execFileSync("tar", ["xzf", starter, "-C", ext]);

      const app = join(root, "my-app");
      execFileSync(process.execPath, [join(ext, "package", "bin", "create-prototype-app.js"), app, "--framework", `file:${fw}`, "--no-install"], {
        cwd: root,
        stdio: "pipe",
      });
      expect(existsSync(join(app, ".claude", "skills", "prototype-framework", "SKILL.md"))).toBe(true);
      expect(existsSync(join(app, ".gitignore"))).toBe(true);

      const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
      writeFileSync(join(app, "package-lock.json"), JSON.stringify(appLockfile(join(REPO, "package-lock.json"), "apps/template", pkg, fw), null, 2) + "\n");
      npm(["ci", "--offline", "--no-audit", "--no-fund"], app);

      // The local setup the starter runs after npm install, from the packed framework.
      const { loadLocalSetup } = (await import(pathToFileURL(join(ext, "package", "lib", "create.mjs")).href)) as {
        loadLocalSetup(dir: string): Promise<{ runLocalSetup(dir: string, deps: { npmInstall(dir: string): Promise<void> }): Promise<{ step: string; result: string }[]> } | undefined>;
      };
      // Offline: the dependencies are installed above, so an install attempt fails the test instead of going online.
      const offline = { npmInstall: () => Promise.reject(new Error("the local setup tried to run npm install")) };
      const setup = await loadLocalSetup(app);
      expect(setup, "the packed framework exports runLocalSetup from ./provision").toBeDefined();
      const outcomes = (await setup?.runLocalSetup(app, offline)) ?? [];
      expect(outcomes.slice(0, 2).map((o) => [o.step, o.result])).toEqual([
        ["dependencies", "already"],
        ["local-secrets", "applied"],
      ]);
      expect(readFileSync(join(app, ".dev.vars"), "utf8")).toMatch(/^SECRET_API_KEY=/m);
      expect((await setup?.runLocalSetup(app, offline))?.[1]?.result).toBe("already");

      const built = npm(["run", "build", "--", "--target", "local", "--stage", "local"], app);
      expect(built).toContain("built myapp for target local, stage local");
      const verified = npm(["run", "verify"], app);
      expect(verified).toContain("verify passed");
    },
    TIMEOUT,
  );
});
