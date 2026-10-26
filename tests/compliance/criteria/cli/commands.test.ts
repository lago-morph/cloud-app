/**
 * CLI-AC-001 (local part): each command in the CLI-REQ-001 table runs from the template app via
 * `npx <package> <command>` and via its npm script; CLI-AC-004 (local part): the output of every
 * command run here contains no test secret value (docs/components/cli.md §4).
 *
 * Both forms run every command on a scratch copy of apps/template (a git repository of its own,
 * so `smoke` can record evidence from a clean tree). Commands that need a cloud (`deploy`,
 * `deploy --start`, `remove`, `stop`, `start`, `setup-account`, `check-login`; `stop`, `start`
 * and `--start` from DEC-0544) are run with `--target local`, so a local run never
 * creates cloud resources; for them "runs" means the package dispatches them as commands (not as
 * unknown ones) and both forms behave the same. Their cloud part is not-run in this phase
 * (CLI-AC-001's cloud rule in the driver). `check-login` replaces the retired `certify-auth`
 * in the CLI-REQ-001 table (DEC-0512, DEC-0513).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tag } from "../../harness/index.js";
import { delay, npmScript, npxCli, readDevVars, scratchCopy, startDev, type CommandResult, type ScratchApp } from "../core/support/processes.js";
import { isLocal, PACKAGE_NAME, TEMPLATE_DIR, uniqueValue } from "../core/support/repo.js";

type Form = "npx" | "npm";
const FORMS: readonly Form[] = ["npx", "npm"];

/** Commands that run fully locally: they must succeed. */
const LOCAL_COMMANDS = ["secrets", "build", "generate-migration", "verify", "reset-local", "dev", "smoke"] as const;
/** Commands that need a cloud: dispatched with `--target local` only. A label's first word is the command. */
const CLOUD_COMMANDS = ["deploy", "deploy --start", "remove", "stop", "start", "setup-account", "check-login"] as const;

const ARGS: Readonly<Record<string, readonly string[]>> = {
  secrets: ["set", "apiKey", "--target", "local", "--stage", "local"],
  build: ["--target", "local", "--stage", "local"],
  "generate-migration": [],
  verify: [],
  "reset-local": [],
  smoke: ["--target", "local", "--stage", "local"],
  deploy: ["--target", "local", "--stage", "local"],
  "deploy --start": ["--target", "local", "--stage", "local", "--start"],
  stop: ["--target", "local", "--stage", "local"],
  start: ["--target", "local", "--stage", "local"],
  remove: ["--target", "local", "--stage", "local"],
  "setup-account": ["--target", "local"],
  "check-login": ["--target", "local", "--stage", "local"],
};

/** The command of a table label (`deploy --start` → `deploy`). */
function commandOf(label: string): string {
  return label.split(" ")[0] ?? label;
}

function run(form: Form, command: string, args: readonly string[], cwd: string, stdin?: string): Promise<CommandResult> {
  const options = { cwd, timeoutMs: 15 * 60_000, ...(stdin === undefined ? {} : { stdin }) };
  return form === "npx" ? npxCli([command, ...args], options) : npmScript(command, args, options);
}

async function runDev(form: Form, cwd: string): Promise<CommandResult> {
  const command = form === "npx" ? { file: "npx", args: ["--no", PACKAGE_NAME, "dev"] } : { file: "npm", args: ["run", "--silent", "dev"] };
  try {
    const dev = await startDev(cwd, command);
    const page = await fetch(`${dev.baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
    const output = dev.output();
    // "Runs" for dev: it serves the client on its printed origin. The exit status after Ctrl-C
    // is the wrapper's (npm, npx) as much as the command's, so it is only reported.
    const stopped = await dev.stop();
    return { command: `${form} dev`, status: page.status === 200 ? 0 : -1, output: `${output}\n[c-t1] exit status after Ctrl-C: ${String(stopped)}\n` };
  } catch (error) {
    return { command: `${form} dev`, status: -2, output: error instanceof Error ? error.message : String(error) };
  }
}

async function runSmoke(form: Form, cwd: string): Promise<CommandResult> {
  let dev;
  try {
    dev = await startDev(cwd);
  } catch (error) {
    return { command: `${form} smoke`, status: -2, output: `dev for smoke failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    return await run(form, "smoke", ARGS.smoke ?? [], cwd);
  } finally {
    const devOutput = dev.output();
    await dev.stop();
    smokeDevOutputs.push(devOutput);
  }
}

const smokeDevOutputs: string[] = [];

if (isLocal()) {
  describe("CLI: commands from the template app", () => {
    const secret = uniqueValue("cliAc004");
    const results = new Map<string, CommandResult>();
    let unknown: CommandResult | undefined;
    let copy: ScratchApp | undefined;

    beforeAll(async () => {
      copy = await scratchCopy(TEMPLATE_DIR, "cli-ac-001", { git: true });
      unknown = await npxCli(["definitely-not-a-command"], { cwd: copy.dir, timeoutMs: 120_000 });
      for (const form of FORMS) {
        for (const command of [...LOCAL_COMMANDS, ...CLOUD_COMMANDS]) {
          let r: CommandResult;
          if (command === "dev") r = await runDev(form, copy.dir);
          else if (command === "smoke") r = await runSmoke(form, copy.dir);
          else r = await run(form, commandOf(command), ARGS[command] ?? [], copy.dir, command === "secrets" ? `${secret}\n` : undefined);
          results.set(`${form} ${command}`, r);
          await delay(100);
        }
      }
    }, 60 * 60_000);

    afterAll(async () => {
      await copy?.remove();
    });

    it(tag("CLI-AC-001", "every local command of the table runs successfully via npx <package> <command> and via its npm script"), () => {
      const failed: string[] = [];
      for (const form of FORMS) {
        for (const command of LOCAL_COMMANDS) {
          const r = results.get(`${form} ${command}`);
          if (r?.status !== 0) failed.push(`${form} ${command}: status ${String(r?.status)}\n${(r?.output ?? "").slice(-1500)}`);
        }
      }
      expect(failed, "commands that did not succeed").toEqual([]);
    });

    it(tag("CLI-AC-001", "the cloud commands of the table (deploy, deploy --start, remove, stop, start, setup-account, check-login) are dispatched by the package in both forms, with the same result"), () => {
      const unknownLine = (unknown?.output ?? "").trim().split("\n")[0] ?? "";
      expect(unknown?.status, "an unknown command is refused").not.toBe(0);
      const problems: string[] = [];
      for (const command of CLOUD_COMMANDS) {
        const npx = results.get(`npx ${command}`);
        const npm = results.get(`npm ${command}`);
        for (const r of [npx, npm]) {
          if (r === undefined || r.status === null || r.status === 127) problems.push(`${r?.command ?? command}: did not run (status ${String(r?.status)})`);
          else if (unknownLine !== "" && r.output.includes(unknownLine.replace("definitely-not-a-command", commandOf(command)))) problems.push(`${r.command}: answered as an unknown command`);
          else if (command === "deploy --start" && /unknown option/i.test(r.output)) problems.push(`${r.command}: --start answered as an unknown option`);
        }
        if (npx?.status !== npm?.status) problems.push(`${command}: npx status ${String(npx?.status)} differs from npm script status ${String(npm?.status)}`);
      }
      expect(problems).toEqual([]);
    });

    it(tag("CLI-AC-004", "no output of any command run here (both forms, dev and smoke included) contains a test secret value"), () => {
      if (copy === undefined) throw new Error("the template copy was not created");
      const vars = readDevVars(copy.dir);
      const needles: Record<string, string> = { "test secret apiKey": secret };
      for (const [name, value] of vars) if (value.length >= 8) needles[name] = value;
      expect(Object.keys(needles).length, "the framework's generated development secrets are scanned too").toBeGreaterThan(1);
      const outputs = [...[...results.values()].map((r) => ({ label: r.command, text: r.output })), ...smokeDevOutputs.map((text, i) => ({ label: `dev during smoke ${String(i + 1)}`, text })), { label: "unknown command", text: unknown?.output ?? "" }];
      const hits = outputs.flatMap((o) => Object.entries(needles).filter(([, v]) => o.text.includes(v)).map(([label]) => `${o.label.replace(/\S*prototype-framework\.js/, "prototype-framework")}: ${label}`));
      expect(hits, "outputs containing a secret value").toEqual([]);
    });
  });
} else {
  // Untagged, so never selected as evidence: keeps the file a valid suite on cloud runs.
  describe("CLI: commands from the template app (local only)", () => {
    it("has nothing to run on a cloud", () => undefined);
  });
}
