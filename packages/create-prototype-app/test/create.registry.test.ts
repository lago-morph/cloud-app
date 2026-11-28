// End to end, against the live npm registry (needs the network; a release-time check, run by
// `vitest.registry.config.ts` in .github/workflows/release.yml, never by the unit or integration layers).
// The packed starter makes an app against the packed framework and runs its own `npm install` with no
// lockfile, exactly as a new user's `npm create @lago-morph/prototype-app` does, so the npm that
// ships with the pinned Node resolves every dependency from the registry as it is today. The offline
// test (create.offline.test.ts) installs from a lockfile cut from the repository's, so it cannot see
// a registry change that breaks a fresh install: npm 10.9.4 crashed with "Cannot read properties of
// null (reading 'edgesOut')" once vitest 5.1.0 was published (DEC-0803; root cause
// ai/implementation/root-causes/2026-11-27-starter-npm-install-edgesout.md).
// Needs the framework built (`npm run build -w packages/framework`).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(PKG_DIR, "..", "..");
const TIMEOUT = 20 * 60_000;
const FRAMEWORK = "@lago-morph/prototype-framework";
const root = mkdtempSync(join(tmpdir(), "create-registry-"));
afterAll(() => rmSync(root, { recursive: true, force: true }), 120_000);

const env = { ...process.env, npm_config_update_notifier: "false" };
const npm = (args: string[], cwd: string): string => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });

function pack(dir: string, ignoreScripts: boolean): string {
  const out = npm(["pack", "--json", "--pack-destination", root, ...(ignoreScripts ? ["--ignore-scripts"] : [])], dir);
  const [packed] = JSON.parse(out) as { filename: string }[];
  return join(root, (packed as { filename: string }).filename);
}

describe("npm create, against the live npm registry", () => {
  it(
    "makes an app whose own npm install, with no lockfile, succeeds, and whose verify passes",
    () => {
      expect(existsSync(join(REPO, "packages", "framework", "dist", "index.js")), "build the framework first").toBe(true);
      const fw = pack(join(REPO, "packages", "framework"), true);
      const starter = pack(PKG_DIR, false); // prepack bundles the template and the skill
      const ext = join(root, "starter");
      mkdirSync(ext);
      execFileSync("tar", ["xzf", starter, "-C", ext]);

      const app = join(root, "my-app");
      // The starter runs `npm install --no-audit --no-fund` itself, then the local setup.
      const r = spawnSync(process.execPath, [join(ext, "package", "bin", "create-prototype-app.js"), app, "--framework", `file:${fw}`], { cwd: root, encoding: "utf8", env });
      expect(r.stderr, `npm ${npm(["--version"], root).trim()}`).not.toContain("npm install failed");
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(app, "package-lock.json"))).toBe(true);
      expect(existsSync(join(app, "node_modules", "vitest", "package.json"))).toBe(true);

      expect(npm(["run", "verify"], app)).toContain("verify passed");
    },
    TIMEOUT,
  );

  // Without the template: a project that depends on the framework alone. npm 10.9.4 resolves
  // vitest's optional peer @vitest/browser-playwright to its newest release and crashes unless the
  // framework itself depends on it at its vitest version (DEC-0803).
  it(
    "a project that depends only on the packed framework installs with no lockfile",
    () => {
      expect(existsSync(join(REPO, "packages", "framework", "dist", "index.js")), "build the framework first").toBe(true);
      const fw = pack(join(REPO, "packages", "framework"), true);
      const project = join(root, "framework-only");
      mkdirSync(project);
      writeFileSync(join(project, "package.json"), `${JSON.stringify({ name: "framework-only", private: true, type: "module", dependencies: { [FRAMEWORK]: `file:${fw}` } }, null, 2)}\n`);
      const r = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: project, encoding: "utf8", env });
      expect(r.stderr, `npm ${npm(["--version"], root).trim()}`).not.toContain("edgesOut");
      expect(r.status, r.stderr).toBe(0);
      const version = (name: string): string => (JSON.parse(readFileSync(join(project, "node_modules", name, "package.json"), "utf8")) as { version: string }).version;
      expect(version("@vitest/browser-playwright")).toBe(version("vitest"));
    },
    TIMEOUT,
  );
});
