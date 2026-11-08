#!/usr/bin/env node
// The v0.2.0 live-pass runner. The agent in one Claude cloud session runs it; it runs every command
// itself, does by API everything that needs no human Cloudflare login, and asks the owner only for
// the browser steps: one link, what to do there, one short reply (DEC-0793). It records everything
// in an R2 bucket in the test Cloudflare account. The owner's runbook: ai/implementation/live-pass-v0.2.0.md.
// The analyst's guide: ai/implementation/live-pass-analysis.md.
//
// Its values live in a secrets directory outside the repository (default ~/.live-pass-secrets, mode
// 700, one mode-600 file per value; lib/secrets.mjs): CLOUDFLARE_ACCOUNT_ID (the test Cloudflare
// account's ID) and LIVE_PASS_OWNER_TOKEN (the owner's token live-pass-owner), saved by the agent from
// the owner's first message; the starter tokens the owner pastes later; the everyday token's value,
// which the runner rolls itself. No CLOUDFLARE_* variable of the runner's own environment is read or
// passed on: in a cloud sandbox those can belong to the primary Cloudflare account.
//
// Usage: node scripts/live-pass/live-pass.mjs <command> [options]
//   start --primary-login <email> [--version <v>] [--app <name>] [--new]
//                                                  create the run, then go on as `next`; <email> is the
//                                                  primary account login's, which the runner invites into
//                                                  the test Cloudflare account
//   next                                           run steps until the owner is needed or the time budget is used
//   answer "<owner's reply>"                       record the owner's reply to the waiting prompt and go on
//                                                  (`answer saved` once a pasted value is saved as the prompt says)
//   resume                                         in a new container (or a new session): continue the run
//   retry                                          run a blocked step again
//   skip <step> "<reason>"                         record a step as skipped (only when the owner decides)
//   note "<text>"                                  add a note to the run's event log
//   status                                         print where the run is
//   download [--run <id>] [--to <dir>]             the analyst: fetch every record of a run (read-only)
// Options for every command: --secrets <dir> (LIVE_PASS_SECRETS_DIR; default ~/.live-pass-secrets),
//   --bucket <name> (LIVE_PASS_BUCKET; default live-pass-records), --workdir <dir> (LIVE_PASS_WORKDIR;
//   default ~/live-pass), --budget <seconds> (default 180: no new step starts after it), --run <id>.
// Exit codes: 0 run done; 10 waiting for the owner; 11 time budget used, run `next` again;
//   1 blocked (retry or skip); 2 usage; 3 the secrets directory is not as the runbook says.
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The framework and Node's fetch honour HTTPS_PROXY only with NODE_USE_ENV_PROXY=1 (cloud sessions).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const { LATEST_KEY, loadState, newRun, nextSeq, saveState, withFacts } = await import("./lib/checkpoint.mjs");
const { createApi, ensureBucket, r2Store, verifyToken } = await import("./lib/cloudflare.mjs");
const { afterStepFactory, contextFactory } = await import("./lib/context.mjs");
const { createEngine } = await import("./lib/engine.mjs");
const { createRecorder } = await import("./lib/records.mjs");
const { createScrubber } = await import("./lib/scrub.mjs");
const { STEPS } = await import("./lib/steps.mjs");
const { DEFAULT_SECRETS_DIR, loadSecrets, SECRET, saveSecret, secretsProblems, TOKEN_NAMES } = await import("./lib/secrets.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DEFAULT_VERSION = "0.2.0-rc01";
const EXIT = { "session-done": 0, finished: 0, owner: 10, more: 11, blocked: 1 };

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new") opts.new = true;
    else if (["--version", "--app", "--bucket", "--workdir", "--budget", "--run", "--to", "--primary-login", "--secrets"].includes(a)) opts[a.slice(2)] = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts._.push(a);
  }
  return opts;
}

const say = (t) => process.stdout.write(`${t}\n`);
const fail = (code, t) => {
  process.stderr.write(`live-pass: ${t}\n`);
  process.exit(code);
};

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  fail(2, e.message);
}
const command = opts._[0];
if (!["start", "next", "answer", "resume", "retry", "skip", "note", "status", "download"].includes(command ?? "")) fail(2, "usage: live-pass.mjs start|next|answer|resume|retry|skip|note|status|download (see the file's header)");

const env = { ...process.env };
const bucket = opts.bucket ?? env.LIVE_PASS_BUCKET ?? "live-pass-records";
const workdir = resolve(opts.workdir ?? env.LIVE_PASS_WORKDIR ?? join(homedir(), "live-pass"));
const budgetMs = Number(opts.budget ?? 180) * 1000;
const secretsDir = resolve(opts.secrets ?? env.LIVE_PASS_SECRETS_DIR ?? DEFAULT_SECRETS_DIR);

// The secrets directory: every token in it is known to the scrubber, also one the agent saves later.
const scrubber = createScrubber([]);
const vault = {
  dir: secretsDir,
  values: {},
  reload() {
    this.values = loadSecrets(secretsDir).values;
    for (const name of TOKEN_NAMES) if (this.values[name]) scrubber.add(name, this.values[name]);
  },
  save(name, value) {
    saveSecret(secretsDir, name, value);
    this.reload();
  },
};
{
  const loaded = loadSecrets(secretsDir);
  const stop = secretsProblems(loaded, { dir: secretsDir, primaryAccountId: env.CLOUDFLARE_ACCOUNT_ID });
  if (stop.length > 0) fail(3, `the secrets directory is not as the runbook says ("For the agent in the session", step 1):\n  - ${stop.join("\n  - ")}`);
  vault.reload();
}
const accountId = vault.values[SECRET.account];
const ownerToken = vault.values[SECRET.owner];
// The sandbox's own Cloudflare values (the primary Cloudflare account's) are never used, and never printed.
scrubber.add("sandbox CLOUDFLARE_API_TOKEN", env.CLOUDFLARE_API_TOKEN);

const pendingCalls = [];
let recorder = null;
const onCall = (c) => (recorder ? recorder.append("api-calls.jsonl", c) : pendingCalls.push(c));
const api = createApi({ token: ownerToken, accountId, onCall });
const store = r2Store(api, bucket);

if (command === "download") {
  // Read-only: every object under runs/<id>/, written below --to with the same relative paths.
  const latest = opts.run ? null : await store.get(LATEST_KEY).catch((e) => fail(3, e.message));
  const runId = opts.run ?? (latest ? JSON.parse(latest).runId : undefined);
  if (!runId) fail(2, `no run in the R2 bucket ${bucket}; give --run <id>`);
  const prefix = `runs/${runId}/`;
  const to = resolve(opts.to ?? join(workdir, "download", runId));
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const objects = await r2Store(api, bucket).list(prefix).catch((e) => fail(3, e.message));
  for (const o of objects) {
    const body = await store.get(o.key);
    const file = join(to, o.key.slice(prefix.length));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body ?? "");
  }
  say(`${objects.length} record files of run ${runId} (r2://${bucket}/${prefix}) written to ${to}`);
  process.exit(objects.length > 0 ? 0 : 1);
}

const runnerSha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
})();

const holder = { state: null };

if (command === "start") {
  const primaryLogin = opts["primary-login"];
  if (!primaryLogin || !/^[^@\s]+@[^@\s]+$/.test(primaryLogin)) fail(2, "start needs --primary-login <email>: the email of the primary account login, which the runner invites into the test Cloudflare account as the tester");
  let made;
  try {
    made = await ensureBucket(api, bucket);
  } catch (e) {
    fail(3, e.message);
  }
  const existing = await loadState(store).catch((e) => fail(3, e.message));
  if (existing && existing.phase !== "finished" && !opts.new) {
    fail(2, `run ${existing.runId} is at phase ${existing.phase}. Use "resume" to continue it, or "start --new" to begin another run.`);
  }
  const owner = await verifyToken(fetch, ownerToken, accountId, onCall);
  if (!owner.ok || owner.kind !== "account") fail(3, `the token in ${secretsDir}/${SECRET.owner} is not accepted by Cloudflare as an account token of the test Cloudflare account ${accountId}: ${owner.error ?? `a ${owner.kind} token`}`);
  const now = new Date().toISOString();
  const runId = `lp-${now.replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
  holder.state = withFacts(newRun({ runId, accountId, version: opts.version ?? DEFAULT_VERSION, appName: opts.app ?? "livepass", bucket, runnerSha, now }), {
    ownerTokenId: owner.id,
    ownerTokenExpiresOn: owner.expiresOn,
    testerEmail: primaryLogin, // the primary account login's email (facts keep the key `tester`)
    recordsBucketWas: made,
  });
  await saveState(store, scrubber.value(holder.state));
  say(`Run ${runId} started. Records: R2 bucket ${bucket}, prefix ${holder.state.prefix}`);
} else {
  holder.state = await loadState(store, opts.run).catch((e) => fail(3, e.message));
  if (!holder.state) fail(2, `no run in the R2 bucket ${bucket} (${LATEST_KEY}); start one with "start"`);
  if (holder.state.accountId !== accountId) fail(3, `the run ${holder.state.runId} is in the test Cloudflare account ${holder.state.accountId}, but ${secretsDir}/${SECRET.account} holds ${accountId}`);
}

const state0 = holder.state;
recorder = createRecorder({ dir: join(workdir, "records", state0.runId), scrubber, store: r2Store(api, bucket, state0.prefix) });
for (const c of pendingCalls.splice(0)) recorder.append("api-calls.jsonl", c);
const recordsStore = r2Store(api, bucket, state0.prefix);
const takeSeq = () => {
  const [n, s] = nextSeq(holder.state);
  holder.state = s;
  return n;
};
// The stored state is a record like the others: it passes the scrubber (skip reasons, errors, pending evidence).
const save = async (s) => {
  await saveState(store, scrubber.value(s));
};
const print = (t) => say(scrubber.text(t));
const engine = createEngine({
  catalogue: STEPS,
  holder,
  save,
  makeCtx: contextFactory({ holder, env, vault, scrubber, recorder, api, repoDir: REPO, workdir, print, nextSeq: takeSeq }),
  afterStep: afterStepFactory({ holder, recorder, api, nextSeq: takeSeq, recordsStore }),
  writeStepRecord: (r) => {
    recorder.json(`steps/${String(takeSeq()).padStart(3, "0")}-${r.id}.json`, r);
    recorder.append("events.jsonl", { at: r.endedAt, event: "step", id: r.id, result: r.result, reason: r.reason });
  },
  print,
  secretsDir,
});

recorder.append("events.jsonl", { at: new Date().toISOString(), event: "invocation", command, args: opts._.slice(1), session: holder.state.session, phase: holder.state.phase, runnerSha, node: process.version });
if (runnerSha !== holder.state.runnerSha && runnerSha !== "unknown") say(`note: this runner is commit ${runnerSha}; the run started with ${holder.state.runnerSha}.`);

/** Part 1 ends at the checkpoint; part 2 begins at once, in the same session (DEC-0793). */
async function onward(o) {
  if (o === "session-done" && holder.state.phase === "checkpoint") {
    print("\nPart 1 is done and the checkpoint is stored. Part 2 begins now, in this session.");
    return engine.beginSession(2, budgetMs);
  }
  return o;
}

let outcome;
try {
  switch (command) {
    case "start":
    case "next":
      outcome = await onward(holder.state.phase === "checkpoint" ? "session-done" : await engine.advance(budgetMs));
      break;
    case "resume": {
      if (holder.state.phase === "finished") {
        outcome = "finished";
        break;
      }
      outcome = await onward(await engine.beginSession(holder.state.phase === "session-1" ? 1 : 2, budgetMs));
      break;
    }
    case "answer":
      if (opts._[1] === undefined) fail(2, 'answer needs the owner\'s reply in quotes: answer "ok"');
      vault.reload(); // the agent may just have saved a pasted value
      outcome = await onward(await engine.answer(scrubber.text(opts._.slice(1).join(" ")), budgetMs));
      break;
    case "retry":
      vault.reload();
      outcome = await onward(await engine.retry(budgetMs));
      break;
    case "skip":
      if (!opts._[1] || !opts._[2]) fail(2, 'skip needs a step and a reason: skip S5 "owner decided …"');
      outcome = await onward(await engine.skip(opts._[1], opts._.slice(2).join(" "), budgetMs));
      break;
    case "note":
      recorder.append("events.jsonl", { at: new Date().toISOString(), event: "note", text: opts._.slice(1).join(" ") });
      outcome = "status";
      break;
    case "status":
      outcome = "status";
      break;
  }
} catch (e) {
  recorder.append("events.jsonl", { at: new Date().toISOString(), event: "runner-error", error: String(e?.stack ?? e) });
  await recorder.sync();
  fail(1, scrubber.text(String(e?.message ?? e)));
}

writeResults();
const synced = await recorder.sync();
if (synced.failed.length > 0) say(`warning: ${synced.failed.length} record file(s) not uploaded yet; the next invocation retries:\n  ${synced.failed.slice(0, 5).join("\n  ")}`);

const s = holder.state;
const done = Object.keys(s.done).length;
say(`\n[run ${s.runId} · part ${s.session} · phase ${s.phase} · ${done}/${STEPS.length} steps recorded · records r2://${s.bucket}/${s.prefix}]`);
if (outcome === "session-done") say("Part 1 has no step left but the checkpoint is not recorded: run next.");
if (outcome === "finished") say(finishText(s));
if (outcome === "more") say("The time budget is used up. Run `node scripts/live-pass/live-pass.mjs next` again.");
if (outcome === "status") say(statusText(s));
process.exit(EXIT[outcome] ?? 0);

// ---- Texts and results ----

function statusText(st) {
  const lines = STEPS.filter((x) => x.session === st.session || st.done[x.id]).map((x) => `  ${(st.done[x.id]?.result ?? (st.pending?.stepId === x.id ? (st.pending.prompt ? "waiting for owner" : st.pending.blocked ? "BLOCKED" : "in progress") : "-")).padEnd(17)} ${x.id.padEnd(5)} ${x.title}`);
  return lines.join("\n");
}

function finishText(st) {
  return [
    "",
    "================ THE LIVE PASS IS FINISHED ================",
    "Everything is in the records bucket in the test Cloudflare account. Tell the owner, word for word:",
    "",
    "  The live pass is finished. The records are in the test Cloudflare account:",
    `    R2 bucket ${st.bucket}, prefix ${st.prefix}`,
    `    test Cloudflare account ID: ${st.accountId}`,
    "  The analysis and the cleanup use the same token, live-pass-owner: no new token is needed.",
    "  To have them done, start the analysis session as the runbook's section 4 says and give it these lines and that token.",
    "",
    `Then delete the secrets directory: rm -rf ${secretsDir}`,
  ].join("\n");
}

function writeResults() {
  const st = holder.state;
  const steps = STEPS.map((x) => ({ id: x.id, session: x.session, title: x.title, ...(st.done[x.id] ?? { result: st.pending?.stepId === x.id ? "in progress" : "not run" }) }));
  const checks = {};
  for (const x of steps) for (const [id, r] of Object.entries(x.checks ?? {})) (checks[id] ??= []).push({ step: x.id, result: r });
  const checkRows = Object.entries(checks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, list]) => ({ id, result: list.some((l) => l.result === "fail") ? "fail" : list.some((l) => l.result === "pass") ? "pass" : "info", steps: list.map((l) => `${l.step}:${l.result}`) }));
  recorder.json("results.json", { runId: st.runId, phase: st.phase, updatedAt: st.updatedAt, version: st.version, frameworkVersion: st.facts.frameworkVersion, steps, checks: checkRows });
  const md = [
    `# Live pass ${st.runId}`,
    "",
    `Phase ${st.phase}; framework ${st.facts.frameworkVersion ?? st.version}; runner ${st.runnerSha}; account ${st.accountId}.`,
    "",
    "## Steps",
    "",
    "| Step | Session | Result | Title | Reason |",
    "|---|---|---|---|---|",
    ...steps.map((x) => `| ${x.id} | ${x.session} | ${x.result} | ${x.title.replace(/\|/g, "\\|")} | ${(x.reason ?? "").replace(/\|/g, "\\|")} |`),
    "",
    "## Checks",
    "",
    "| Check | Result | Steps |",
    "|---|---|---|",
    ...checkRows.map((c) => `| ${c.id} | ${c.result} | ${c.steps.join(", ")} |`),
    "",
  ].join("\n");
  recorder.text("results.md", md);
  recorder.json("run.json", { runId: st.runId, bucket: st.bucket, prefix: st.prefix, accountId: st.accountId, version: st.version, appName: st.appName, runnerSha: st.runnerSha, createdAt: st.createdAt, sessions: st.sessions, phase: st.phase, facts: st.facts });
}
