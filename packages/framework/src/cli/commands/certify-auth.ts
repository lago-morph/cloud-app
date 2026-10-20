/**
 * `certify-auth --target <t> --stage <s>` (CLI-REQ-001; GOOGLE-REQ-005; google.md §2
 * "Certification procedure"; D-05). The procedure itself is GOOGLE's library (`certifyAuth`,
 * B-13): step 1 checks the login redirect automatically, steps 2–4 ask the owner to log in and
 * paste what `/api/auth/me` shows, and one evidence record is always written.
 *
 * This command supplies its inputs and I/O:
 * - only a production stage of a cloud target (test stages use the authentication mock, so they
 *   are refused before any request is sent);
 * - the base URL from the stage's recorded deploy output (`deploy`, DEC-0272), never a guess;
 * - the stage's `framework.google.clientId` from its committed values file;
 * - the owner's answers read line by line from standard input;
 * - the record through `src/evidence` into `validation/<target>/<runId>.json` of the repository
 *   holding the app, from a working tree matching HEAD, with the account's `workers.dev`
 *   subdomain redacted (DEC-0086).
 * In this phase no production stage exists (Google is mocked), so the command is exercised
 * offline only, with a stubbed `fetch`.
 */
import type { Target } from "../../core/identity.js";
import type { EvidencePaths, GitState, Redaction, WriteEvidenceInput } from "../../evidence/writer.js";
import { certifyAuth } from "../../google/certify.js";
import { describeFailure } from "../failure.js";
import { EXIT, type Command } from "../io.js";
import { checkedStage, parseCloudTargetStage, refuseUnreachableCloud, type ProcessEnvironment } from "./smoke-cloud.js";

export interface CertifyAuthDeps {
  readonly env: ProcessEnvironment;
  deployedOrigin(appDir: string, target: Target, stage: string): string | undefined;
  /** The stage's `framework.google.clientId`, if its values file has one. */
  googleClientId(appDir: string, target: Target, stage: string): Promise<string | undefined>;
  repo(appDir: string): { readonly root: string; readonly git: GitState };
  readonly fetch?: typeof fetch;
  writeEvidence(input: WriteEvidenceInput): EvidencePaths;
  newRunId(): string;
  now(): Date;
  versions(): Record<string, string>;
}

/** A reader of whole lines (without the line ending) from chunked input; "" at the end. */
export function readLines(input: AsyncIterable<string | Uint8Array>): () => Promise<string> {
  const iterator = input[Symbol.asyncIterator]();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  return async () => {
    for (;;) {
      const end = buffer.indexOf("\n");
      if (end !== -1) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        return line;
      }
      if (done) {
        const rest = buffer;
        buffer = "";
        return rest;
      }
      const next = await iterator.next();
      if (next.done === true) done = true;
      else buffer += typeof next.value === "string" ? next.value : decoder.decode(next.value, { stream: true });
    }
  };
}

/** DEC-0086: the account's `workers.dev` subdomain never goes into evidence. */
function subdomainRedactions(origin: string): Redaction[] {
  const match = /^https:\/\/[^./]+\.([^./]+)\.workers\.dev(?:[/:]|$)/.exec(origin);
  return match?.[1] === undefined ? [] : [{ value: match[1], replacement: "<account-subdomain>" }];
}

export function certifyAuthCommand(deps: CertifyAuthDeps): Command {
  return async (args, io) => {
    const { target, stage } = parseCloudTargetStage("certify-auth", args);
    checkedStage(stage);
    const fail = (text: string): number => {
      io.stderr(`certify-auth: ${text}\n`);
      return EXIT.failed;
    };
    if (stage.startsWith("test-")) {
      return fail(`certify-auth needs a production stage; ${stage} is a test stage, which uses the authentication mock instead of Google`);
    }
    const refused = refuseUnreachableCloud("certify-auth", deps.env, io);
    if (refused !== undefined) return refused;

    let repo: ReturnType<CertifyAuthDeps["repo"]>;
    let commit: string;
    try {
      repo = deps.repo(io.cwd);
      commit = repo.git.commit();
      const changed = repo.git.changedTrackedFiles();
      if (changed.length > 0) return fail(`the evidence record names a commit, but tracked files differ from it: ${changed.join(", ")}. Commit (or undo) these changes, then run certify-auth again`);
    } catch (error) {
      return fail(`the evidence record names a commit, so the app must be in a git repository with at least one commit (${describeFailure(error)})`);
    }

    const origin = deps.deployedOrigin(io.cwd, target, stage);
    if (origin === undefined) return fail(`no recorded deploy output for stage ${stage} on ${target}: deploy it first with \`npm run deploy -- --target ${target} --stage ${stage}\``);
    const clientId = await deps.googleClientId(io.cwd, target, stage);
    if (clientId === undefined) return fail(`stage ${stage} has no framework.google.clientId in its values file (config/${target}/${stage}.json); set it, deploy, then run certify-auth again`);

    const nextLine = readLines(io.stdin);
    const { root, git } = repo;
    const outcome = await certifyAuth(
      { target, stage, origin, clientId, commit, runId: deps.newRunId(), versions: deps.versions() },
      {
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
        print: (text) => io.stdout(`${text}\n`),
        ask: async (question) => {
          io.stdout(`${question}\n`);
          return nextLine();
        },
        writeEvidence: async (record) => deps.writeEvidence({ root, git, record, redactions: subdomainRedactions(origin) }).recordPath,
        now: () => deps.now(),
      },
    );
    return outcome.record.exitStatus === 0 ? EXIT.ok : EXIT.failed;
  };
}

/** `certify-auth` bound to the recorded deploy output, the stage's values file, git and the evidence writer. */
export async function certifyAuthBinding(env: ProcessEnvironment = process.env): Promise<Command> {
  const [{ loadApp }, { createDeployment }, { nodeFileReader, resolveStageConfig }, evidence, { readDeployedOrigin }, { execFileSync }, { readFileSync }] = await Promise.all([
    import("../../build/load.js"),
    import("../../core/identity.js"),
    import("../../config/files.js"),
    import("../../evidence/public.js"),
    import("./smoke.js"),
    import("node:child_process"),
    import("node:fs"),
  ]);
  const frameworkVersion = (): string | undefined => {
    try {
      return (JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as { version?: string }).version;
    } catch {
      return undefined;
    }
  };
  return certifyAuthCommand({
    env,
    deployedOrigin: readDeployedOrigin,
    googleClientId: async (appDir, target, stage) => {
      const { definition } = await loadApp(appDir);
      const deployment = createDeployment({ app: definition.name, stage, target });
      return resolveStageConfig(deployment, { config: definition.config, secrets: definition.secrets }, nodeFileReader(appDir)).google?.clientId;
    },
    repo: (appDir) => {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: appDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      return { root, git: evidence.gitState(root) };
    },
    writeEvidence: evidence.writeEvidence,
    newRunId: () => evidence.newRunId(),
    now: () => new Date(),
    versions: () => {
      const version = frameworkVersion();
      return { node: process.version, ...(version === undefined ? {} : { "@lago-morph/prototype-framework": version }) };
    },
  });
}
