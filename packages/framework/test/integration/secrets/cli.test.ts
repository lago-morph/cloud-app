/**
 * SEC on the real local target, through the package binary (CLI-REQ-001): `secrets set` from
 * standard input only (SEC-AC-003, SEC-AC-004), `dev` reading the value from `.dev.vars`
 * (SEC-AC-001), and the local scan of the repository, build output, `.logs/` and error responses
 * (SEC-AC-002, local part). The steps share one fixture app and run in order.
 * Criteria: docs/components/secrets.md §4.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import {
  devFixtureFiles,
  errorResponseViolations,
  filesContaining,
  makeTempApp,
  REPO_ROOT,
  runCli,
  startDev,
  uniqueValue,
  type TempApp,
} from "../core/harness/harness.js";

const run = promisify(execFile);

/** SEC-REQ-003: the local location of secret `apiKey`. */
const LOCATION = "SECRET_API_KEY";
const SET = ["secrets", "set", "apiKey", "--target", "local", "--stage", "local"];

let app: TempApp;
const secret = uniqueValue("bt1clisecret");
const errorResponses: string[] = [];

async function devVars(): Promise<string> {
  try {
    return await app.read(".dev.vars");
  } catch {
    return "";
  }
}

/** Value of `NAME=value` in a dotenv file (optionally quoted), or undefined. */
function dotenvValue(text: string, name: string): string | undefined {
  const values = text
    .split(/\r?\n/)
    .map((l) => new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`).exec(l)?.[1])
    .filter((v): v is string => v !== undefined)
    .map((v) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v));
  if (values.length > 1) throw new Error(`${name} is set ${values.length} times`);
  return values[0];
}

beforeAll(async () => {
  app = await makeTempApp(devFixtureFiles({ name: "bt1secapp" }));
});

afterAll(async () => {
  await app?.remove();
});

describe("SEC on the local target", () => {
  it(tag("SEC-AC-004", "the CLI rejects a secret value supplied as a command-line argument"), async () => {
    const forms = [
      ["secrets", "set", "apiKey", secret, "--target", "local", "--stage", "local"],
      [...SET, secret],
      [...SET, "--value", secret],
      [...SET, `--value=${secret}`],
    ];
    for (const args of forms) {
      const res = await runCli(args, { cwd: app.dir, stdin: "" });
      expect(res.status, args.join(" ")).not.toBe(0);
      expect(res.status).not.toBeNull();
      expect(await devVars(), args.join(" ")).not.toContain(secret);
    }
    // The rejection is about the argument: the same command with the value on stdin succeeds.
    const other = uniqueValue("bt1stdin");
    const viaStdin = await runCli(SET, { cwd: app.dir, stdin: other });
    expect(viaStdin.status, viaStdin.output).toBe(0);
    expect(dotenvValue(await devVars(), LOCATION)).toBe(other);
  });

  it(tag("SEC-AC-003", "local: after a secret is set with the CLI it exists at SECRET_<NAME> in .dev.vars"), async () => {
    const res = await runCli(SET, { cwd: app.dir, stdin: secret });
    expect(res.status, res.output).toBe(0);
    expect(dotenvValue(await devVars(), LOCATION)).toBe(secret);
  });

  it(tag("SEC-AC-001", "local dev: a declared secret with a value is returned; undeclared fails SEC.UNDECLARED; no value fails SEC.MISSING"), async () => {
    const dev = await startDev(app.dir);
    try {
      const ok = await fetch(`${dev.baseUrl}/api/secret`);
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ value: secret });

      for (const [path, code] of [
        ["/api/secret/undeclared", "SEC.UNDECLARED"],
        ["/api/secret/missing", "SEC.MISSING"],
      ] as const) {
        const res = await fetch(`${dev.baseUrl}${path}`);
        const raw = await res.text();
        errorResponses.push(raw);
        expect(res.status, path).toBe(500);
        const body = JSON.parse(raw) as { error: { code: string } };
        expect(errorResponseViolations(body), path).toEqual([]);
        expect(body.error.code, path).toBe(code);
      }

      // For SEC-AC-002: an error that contains the secret value, while dev captures logs.
      const thrown = await fetch(`${dev.baseUrl}/api/throw/secret`);
      expect(thrown.status).toBe(500);
      errorResponses.push(`${[...thrown.headers].map(([k, v]) => `${k}: ${v}`).join("\n")}\n${await thrown.text()}`);
    } finally {
      await dev.stop();
    }
  }, 240_000);

  it(tag("SEC-AC-002", "local: the repository, build output, .logs/ and error responses contain no test secret value"), async () => {
    for (const args of [
      ["build", "--target", "local", "--stage", "local"],
      ["build", "--target", "cloudflare", "--stage", "test-bt1sec"],
    ]) {
      const res = await runCli(args, { cwd: app.dir });
      expect(res.status, res.output).toBe(0);
    }
    expect(errorResponses.length).toBe(3);
    for (const r of errorResponses) expect(r).not.toContain(secret);

    // The app directory apart from the secret store itself and the emulator's state: sources,
    // config, build output under .framework/, and .logs/.
    const hits = (await filesContaining(app.dir, secret))
      .map((f) => relative(app.dir, f))
      .filter((f) => f !== ".dev.vars" && !f.startsWith(".wrangler/"));
    expect(hits).toEqual([]);
    // .logs/ was written (dev captured the failure), so the scan covered stored entries.
    const errorEntries = (await filesContaining(join(app.dir, ".logs"), "\"error\"")).length;
    expect(errorEntries).toBeGreaterThan(0);

    // The repository working tree (tracked and untracked files) never contains it.
    const grep = await run("git", ["grep", "--untracked", "-F", "-l", secret], { cwd: REPO_ROOT }).then(
      (r) => r.stdout,
      (e: { code?: number; stdout?: string }) => (e.code === 1 ? "" : `git grep failed: ${String(e.stdout)}`),
    );
    expect(grep).toBe("");
    expect(await readFile(join(app.dir, ".dev.vars"), "utf8")).toContain(secret);
  });
});
