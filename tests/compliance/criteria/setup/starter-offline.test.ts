/**
 * The offline integration run of plan-setup-wizard §6: "run the starter offline, then
 * `cloudflare-setup` with no tokens, and check the exact printed links and template" — SETUP-AC-001
 * end to end, on an app made by the packaged starter against the packed framework, with no network.
 * It also shows, on that app, SETUP-AC-009's "the command runs the local setup first" (the starter
 * ran with `--no-install`, so no local secret was set before `cloudflare-setup`) and SKILL-AC-008's
 * "an app made with the starter has the same `.claude/settings.json`".
 *
 * Follows packages/create-prototype-app/test/create.offline.test.ts: the framework packed as npm
 * would publish it (`npm pack`, its build already made), the app installed with
 * `npm ci --offline` from the npm cache the repository's `npm ci` filled, through a lockfile cut
 * from the repository's (`appLockfile`). One difference: the starter is not packed in its own
 * folder, whose `prepack` and `postpack` write and remove the bundle there (the other offline test
 * does that, possibly at the same time); its package files are staged in a temporary folder with
 * the bundle its `prepack` makes (`bundle(<dir>)`), then packed from there.
 *
 * `cloudflare-setup` runs through the app's npm script with none of the four Cloudflare settings in
 * its environment (the operator's are removed, compliance.md §2, DEC-0604), with every outgoing
 * request of its processes logged (criteria/cli/support/record-requests.mjs): none may go to
 * Cloudflare. The expected text is plan §3.2's (setup.md SETUP-REQ-003); the links are the
 * framework's `deepLink` of the same source tree the tarball was packed from.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { appLockfile } from "../../../../packages/create-prototype-app/test/lockfile.js";
import { isLocal, REPO_ROOT } from "../core/support/repo.js";
import { BOOT_LINK, EVERYDAY_LINK, linesEqual, NEXT_PROMPT_PHRASE, TEMPLATE_LINES } from "./support/setup-runs.js";

const STARTER_DIR = join(REPO_ROOT, "packages", "create-prototype-app");
const FRAMEWORK = join(REPO_ROOT, "packages", "framework");
const RECORDER = join(REPO_ROOT, "tests", "compliance", "criteria", "cli", "support", "record-requests.mjs");
const TIMEOUT = 20 * 60_000;
const SETTINGS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_BOOTSTRAP_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_EMAIL_DOMAIN"] as const;

/** The process environment without any Cloudflare setting, npm quiet, git with an identity. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false", GIT_AUTHOR_NAME: "setup-ac", GIT_AUTHOR_EMAIL: "setup-ac@example.invalid", GIT_COMMITTER_NAME: "setup-ac", GIT_COMMITTER_EMAIL: "setup-ac@example.invalid", ...extra };
  for (const name of SETTINGS) delete env[name];
  return env;
}

if (isLocal()) {
  describe("SETUP: the starter offline, then cloudflare-setup with no tokens", () => {
    const root = mkdtempSync(join(tmpdir(), "setup-offline-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }), 120_000);

    const npm = (args: string[], cwd: string): string => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: childEnv() });

    it(
      tag(["SETUP-AC-001", "SETUP-AC-009", "SKILL-AC-008"], "an app made by the packed starter, installed offline: cloudflare-setup with no tokens runs the local setup first, prints exactly both links and the four template lines, writes the template, sends no Cloudflare request and exits 1; the app has the template's .claude/settings.json"),
      async () => {
        expect(existsSync(join(FRAMEWORK, "dist", "index.js")), "build the framework first").toBe(true);
        const [packed] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", root], FRAMEWORK)) as { filename: string }[];
        const fw = join(root, packed?.filename ?? "");

        // The starter's package, staged with the bundle its prepack makes, then packed and unpacked.
        const stage = join(root, "starter-src");
        mkdirSync(stage);
        for (const part of ["package.json", "bin", "lib", "README.md", "LICENSE"]) if (existsSync(join(STARTER_DIR, part))) cpSync(join(STARTER_DIR, part), join(stage, part), { recursive: true });
        const { bundle } = (await import(pathToFileURL(join(STARTER_DIR, "scripts", "bundle.mjs")).href)) as { bundle(out: string): { template: string; skill: string } };
        bundle(stage);
        const [starterPacked] = JSON.parse(npm(["pack", "--json", "--ignore-scripts", "--pack-destination", root], stage)) as { filename: string }[];
        const ext = join(root, "starter");
        mkdirSync(ext);
        execFileSync("tar", ["xzf", join(root, starterPacked?.filename ?? ""), "-C", ext]);

        const app = join(root, "my-app");
        execFileSync(process.execPath, [join(ext, "package", "bin", "create-prototype-app.js"), app, "--framework", `file:${fw}`, "--no-install"], { cwd: root, stdio: "pipe", env: childEnv() });
        const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8")) as Parameters<typeof appLockfile>[2];
        writeFileSync(join(app, "package-lock.json"), JSON.stringify(appLockfile(join(REPO_ROOT, "package-lock.json"), "apps/template", pkg, fw), null, 2) + "\n");
        npm(["ci", "--offline", "--no-audit", "--no-fund"], app);
        expect(existsSync(join(app, ".dev.vars")), "no local secret yet (the starter ran with --no-install)").toBe(false);
        expect(existsSync(join(app, ".env.cloudflare"))).toBe(false);

        const log = join(root, "requests.log");
        const run = spawnSync("npm", ["run", "--silent", "cloudflare-setup"], {
          cwd: app,
          encoding: "utf8",
          env: childEnv({ COMPLIANCE_REQUEST_LOG: log, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(RECORDER).href}`.trim() }),
          timeout: 5 * 60_000,
        });
        const out = run.stdout;
        const all = `${run.stdout}\n${run.stderr}`;
        expect(run.status, all).toBe(1);

        // The exact links, each on a line of its own, and the template's four lines in order.
        expect(linesEqual(out, BOOT_LINK), `the bootstrap link:\n${out}`).toBe(1);
        expect(linesEqual(out, EVERYDAY_LINK), "the everyday link").toBe(1);
        const lines = out.split("\n");
        const at = lines.indexOf(TEMPLATE_LINES[0]);
        expect(lines.slice(at, at + TEMPLATE_LINES.length), "the template").toEqual([...TEMPLATE_LINES]);
        expect(out).toMatch(/Cloudflare DNS/);
        expect(out).toMatch(/Environment variables/);
        expect(out).toMatch(/new session/i);
        expect(out).toContain(NEXT_PROMPT_PHRASE);

        // The template is written (owner read and write only, PAR-341), and listed in .gitignore.
        expect(readFileSync(join(app, ".env.cloudflare"), "utf8").split("\n").filter((l) => l !== "")).toEqual([...TEMPLATE_LINES]);
        if (process.platform !== "win32") expect((statSync(join(app, ".env.cloudflare")).mode & 0o777).toString(8)).toBe("600");
        expect(spawnSync("git", ["check-ignore", "-q", ".env.cloudflare"], { cwd: app }).status, "git ignores .env.cloudflare").toBe(0);

        // The local setup ran first: the app's declared secret has a local value now.
        expect(readFileSync(join(app, ".dev.vars"), "utf8")).toMatch(/^SECRET_API_KEY=\S+/m);

        // No request to Cloudflare from any process of the run.
        const requests = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter((l) => l !== "") : [];
        expect(requests[0], "the request recorder ran").toBe("started");
        expect(requests.filter((l) => /cloudflare/i.test(l)), "requests to Cloudflare").toEqual([]);

        // SKILL-AC-008: the starter's app has the template's settings file.
        expect(readFileSync(join(app, ".claude", "settings.json"), "utf8")).toBe(readFileSync(join(REPO_ROOT, "apps", "template", ".claude", "settings.json"), "utf8"));
      },
      TIMEOUT,
    );
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("SETUP: the starter offline (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}
