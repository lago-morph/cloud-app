/**
 * SEC on the real local target, through the package binary (CLI-REQ-001): `secrets set` from
 * standard input only (SEC-AC-003, SEC-AC-004), `dev` reading the value from `.dev.vars`
 * (SEC-AC-001), and the local scan of the repository, build output, `.logs/` and error responses
 * (SEC-AC-002, local part). Each test provisions the state it reads, so it passes alone, under any
 * `-t` selection and in any order: SEC-AC-003 and SEC-AC-004 each use a fresh app; SEC-AC-001 and
 * SEC-AC-002 share one memoised fixture (`exercised()`) that whichever runs first provisions.
 * Criteria: docs/components/secrets.md §4.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
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

const secret = uniqueValue("bt1clisecret");

async function devVars(app: TempApp): Promise<string> {
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

/** A fresh fixture app for one test, removed afterwards whatever the outcome. */
async function withFreshApp(name: string, body: (app: TempApp) => Promise<void>): Promise<void> {
  const app = await makeTempApp(devFixtureFiles({ name }));
  try {
    await body(app);
  } finally {
    await app.remove();
  }
}

interface Recorded {
  status: number;
  headers: string;
  body: string;
}

interface Exercised {
  app: TempApp;
  ok: Recorded;
  undeclared: Recorded;
  missing: Recorded;
  thrown: Recorded;
}

let sharedApp: TempApp | undefined;
let exercisedOnce: Promise<Exercised> | undefined;

async function record(res: Response): Promise<Recorded> {
  return {
    status: res.status,
    headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n"),
    body: await res.text(),
  };
}

/**
 * The state SEC-AC-001 and SEC-AC-002 read, provisioned once by whichever of them runs first: a
 * fresh app, `secrets set apiKey` with the value on stdin, then `dev` started, the four responses
 * recorded (the thrown one while dev captures logs into .logs/), and dev stopped. Nothing is
 * caught: a failure rejects the memoised promise, so every test awaiting it fails.
 */
function exercised(): Promise<Exercised> {
  exercisedOnce ??= (async () => {
    const app = await makeTempApp(devFixtureFiles({ name: "bt1secapp" }));
    sharedApp = app;
    const set = await runCli(SET, { cwd: app.dir, stdin: secret });
    if (set.status !== 0) throw new Error(`secrets set failed (${String(set.status)}): ${set.output}`);
    const dev = await startDev(app.dir);
    try {
      return {
        app,
        ok: await record(await fetch(`${dev.baseUrl}/api/secret`)),
        undeclared: await record(await fetch(`${dev.baseUrl}/api/secret/undeclared`)),
        missing: await record(await fetch(`${dev.baseUrl}/api/secret/missing`)),
        // For SEC-AC-002: an error that contains the secret value, while dev captures logs.
        thrown: await record(await fetch(`${dev.baseUrl}/api/throw/secret`)),
      };
    } finally {
      await dev.stop();
    }
  })();
  return exercisedOnce;
}

afterAll(async () => {
  await sharedApp?.remove();
});

describe("SEC on the local target", () => {
  it(tag("SEC-AC-004", "the CLI rejects a secret value supplied as a command-line argument"), async () => {
    await withFreshApp("bt1secapp004", async (app) => {
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
        expect(await devVars(app), args.join(" ")).not.toContain(secret);
      }
      // The rejection is about the argument: the same command with the value on stdin succeeds,
      // writing to the same .dev.vars the checks above read.
      const other = uniqueValue("bt1stdin");
      const viaStdin = await runCli(SET, { cwd: app.dir, stdin: other });
      expect(viaStdin.status, viaStdin.output).toBe(0);
      expect(dotenvValue(await devVars(app), LOCATION)).toBe(other);
    });
  });

  it(tag("SEC-AC-003", "local: after a secret is set with the CLI it exists at SECRET_<NAME> in .dev.vars"), async () => {
    await withFreshApp("bt1secapp003", async (app) => {
      const res = await runCli(SET, { cwd: app.dir, stdin: secret });
      expect(res.status, res.output).toBe(0);
      expect(dotenvValue(await devVars(app), LOCATION)).toBe(secret);
    });
  });

  it(tag("SEC-AC-001", "local dev: a declared secret with a value is returned; undeclared fails SEC.UNDECLARED; no value fails SEC.MISSING"), async () => {
    const { ok, undeclared, missing, thrown } = await exercised();
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toEqual({ value: secret });

    for (const [path, res, code] of [
      ["/api/secret/undeclared", undeclared, "SEC.UNDECLARED"],
      ["/api/secret/missing", missing, "SEC.MISSING"],
    ] as const) {
      expect(res.status, path).toBe(500);
      const body = JSON.parse(res.body) as { error: { code: string } };
      expect(errorResponseViolations(body), path).toEqual([]);
      expect(body.error.code, path).toBe(code);
    }
    expect(thrown.status).toBe(500);
  }, 240_000);

  it(tag("SEC-AC-002", "local: the repository, build output, .logs/ and error responses contain no test secret value"), async () => {
    const { app, undeclared, missing, thrown } = await exercised();
    for (const args of [
      ["build", "--target", "local", "--stage", "local"],
      ["build", "--target", "cloudflare", "--stage", "test-bt1sec"],
    ]) {
      const res = await runCli(args, { cwd: app.dir });
      expect(res.status, res.output).toBe(0);
    }
    const errorResponses = [undeclared, missing, thrown]
      .filter((r) => r.status >= 400)
      .map((r) => `${r.headers}\n${r.body}`);
    expect(errorResponses.length).toBe(3);
    for (const r of errorResponses) expect(r).not.toContain(secret);

    // The app directory apart from the secret store itself and the emulator's state: sources,
    // config, build output under .framework/, and .logs/. The same scan must find the value in
    // .dev.vars (positive control), so an empty list of other hits means something.
    const all = (await filesContaining(app.dir, secret)).map((f) => relative(app.dir, f));
    expect(all).toContain(".dev.vars");
    const hits = all.filter((f) => f !== ".dev.vars" && !f.startsWith(".wrangler/"));
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
  }, 300_000);
});
