#!/usr/bin/env node
// The v0.2.0 live-pass runner. The agent in a Claude cloud session runs it; it runs every command
// itself, asks the owner only for the browser steps (one short reply each), and records everything
// in an R2 bucket in the test account. The owner's runbook: ai/implementation/live-pass-v0.2.0.md.
// The analyst's guide: ai/implementation/live-pass-analysis.md.
//
// Usage: node scripts/live-pass/live-pass.mjs <command> [options]
//   start [--version <v>] [--app <name>] [--new]   session 1: create the run, then go on as `next`
//   next                                           run steps until the owner is needed or the session ends
//   answer "<owner's reply>"                       record the owner's reply to the waiting prompt and go on
//   resume                                         in a new session (or a new container): continue the run
//   retry                                          run a blocked step again
//   skip <step> "<reason>"                         record a step as skipped (only when the owner decides)
//   note "<text>"                                  add a note to the run's event log
//   status                                         print where the run is
//   download [--run <id>] [--to <dir>]             the analyst: fetch every record of a run (read-only;
//                                                  LIVE_PASS_ADMIN_TOKEN may hold the final analysis token)
// Options for every command: --bucket <name> (LIVE_PASS_BUCKET; default live-pass-records),
//   --workdir <dir> (LIVE_PASS_WORKDIR; default ~/live-pass), --budget <seconds> (default 180: no new step starts after it), --run <id>.
// Exit codes: 0 session or run done; 10 waiting for the owner; 11 time budget used, run `next` again;
//   1 blocked (retry or skip); 2 usage; 3 environment variables not as the runbook says.
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The framework and Node's fetch honour HTTPS_PROXY only with NODE_USE_ENV_PROXY=1 (cloud sessions).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)], { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status ?? 1);
}

const { envProblems, LATEST_KEY, loadState, newRun, nextSeq, saveState, withFacts } = await import("./lib/checkpoint.mjs");
const { createApi, ensureBucket, r2Store, verifyToken } = await import("./lib/cloudflare.mjs");
const { afterStepFactory, contextFactory } = await import("./lib/context.mjs");
const { createEngine } = await import("./lib/engine.mjs");
const { createRecorder } = await import("./lib/records.mjs");
const { createScrubber } = await import("./lib/scrub.mjs");
const { STEPS } = await import("./lib/steps.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DEFAULT_VERSION = "0.2.0-rc01";
const EXIT = { "session-done": 0, finished: 0, owner: 10, more: 11, blocked: 1 };
const TOKEN_VARS = ["LIVE_PASS_ADMIN_TOKEN", "CLOUDFLARE_BOOTSTRAP_TOKEN", "CLOUDFLARE_API_TOKEN", "LIVE_PASS_BOOTSTRAP_LONG", "LIVE_PASS_BOOTSTRAP_RERUN"];

function parse(argv) {
  const opts = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new") opts.new = true;
    else if (["--version", "--app", "--bucket", "--workdir", "--budget", "--run", "--to"].includes(a)) opts[a.slice(2)] = argv[++i];
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
if (!env.LIVE_PASS_ADMIN_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) fail(3, "LIVE_PASS_ADMIN_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set in the environment settings (runbook section 2).");

const scrubber = createScrubber(TOKEN_VARS.map((name) => ({ name, value: env[name] })));
const pendingCalls = [];
let recorder = null;
const onCall = (c) => (recorder ? recorder.append("api-calls.jsonl", c) : pendingCalls.push(c));
const api = createApi({ token: env.LIVE_PASS_ADMIN_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, onCall });
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

/**
 * Session 1 accepts session 2's variables once S8 (page 2) has been reached: its prompt, saved before it
 * is printed, tells the owner to change them before replying. Every stored state from then on counts:
 * S8 pending in any part (prompt waiting, or the reply saved before S8 completes), S8 done, or the
 * everyday token's ID known. A container lost in any of them resumes with session 2's variables.
 */
function checkEnv(session, state) {
  const s8Reached = !!state?.facts?.everydayTokenId || state?.done?.S8 !== undefined || state?.pending?.stepId === "S8";
  const bootstrapSet = typeof env.CLOUDFLARE_BOOTSTRAP_TOKEN === "string" && env.CLOUDFLARE_BOOTSTRAP_TOKEN.trim() !== ""; // as envProblems tests it
  const asSession = session === 1 && s8Reached && !bootstrapSet ? 2 : session;
  const { stop, warn } = envProblems(asSession, env);
  for (const w of warn) say(`warning: ${w}`);
  if (stop.length > 0) fail(3, `the environment is not as the runbook says for session ${session}:\n  - ${stop.join("\n  - ")}\nChange the environment settings, then start a new session (runbook section 5).`);
  return warn;
}

const holder = { state: null };

if (command === "start") {
  checkEnv(1, null);
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
  const admin = await verifyToken(fetch, env.LIVE_PASS_ADMIN_TOKEN, env.CLOUDFLARE_ACCOUNT_ID, onCall);
  if (!admin.ok) fail(3, `LIVE_PASS_ADMIN_TOKEN is not accepted by Cloudflare for this account: ${admin.error ?? "not valid"}`);
  const now = new Date().toISOString();
  const runId = `lp-${now.replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`;
  holder.state = withFacts(newRun({ runId, accountId: env.CLOUDFLARE_ACCOUNT_ID, version: opts.version ?? DEFAULT_VERSION, appName: opts.app ?? "livepass", bucket, runnerSha, now }), {
    adminTokenId: admin.id,
    adminTokenExpiresOn: admin.expiresOn,
    recordsBucketWas: made,
  });
  await saveState(store, scrubber.value(holder.state));
  say(`Run ${runId} started. Records: R2 bucket ${bucket}, prefix ${holder.state.prefix}`);
} else {
  holder.state = await loadState(store, opts.run).catch((e) => fail(3, e.message));
  if (!holder.state) fail(2, `no run in the R2 bucket ${bucket} (${LATEST_KEY}); start one with "start"`);
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
  makeCtx: contextFactory({ holder, env, scrubber, recorder, api, repoDir: REPO, workdir, print, nextSeq: takeSeq }),
  afterStep: afterStepFactory({ holder, recorder, api, nextSeq: takeSeq, recordsStore }),
  writeStepRecord: (r) => {
    recorder.json(`steps/${String(takeSeq()).padStart(3, "0")}-${r.id}.json`, r);
    recorder.append("events.jsonl", { at: r.endedAt, event: "step", id: r.id, result: r.result, reason: r.reason });
  },
  print,
});

recorder.append("events.jsonl", { at: new Date().toISOString(), event: "invocation", command, args: opts._.slice(1), session: holder.state.session, phase: holder.state.phase, runnerSha, node: process.version });
if (runnerSha !== holder.state.runnerSha && runnerSha !== "unknown") say(`note: this runner is commit ${runnerSha}; the run started with ${holder.state.runnerSha}.`);

let outcome;
try {
  switch (command) {
    case "start":
    case "next":
      if (command === "next") checkEnv(holder.state.session, holder.state);
      if (holder.state.phase === "checkpoint") {
        outcome = "session-done";
        break;
      }
      outcome = await engine.advance(budgetMs);
      break;
    case "resume": {
      if (holder.state.phase === "finished") {
        outcome = "finished";
        break;
      }
      const session = holder.state.phase === "session-1" ? 1 : 2;
      const warn = checkEnv(session, holder.state);
      if (warn.length > 0) recorder.append("events.jsonl", { at: new Date().toISOString(), event: "environment-warnings", warn });
      outcome = await engine.beginSession(session, budgetMs);
      break;
    }
    case "answer":
      if (opts._[1] === undefined) fail(2, 'answer needs the owner\'s reply in quotes: answer "ok"');
      outcome = await engine.answer(scrubber.text(opts._.slice(1).join(" ")), budgetMs);
      break;
    case "retry":
      outcome = await engine.retry(budgetMs);
      break;
    case "skip":
      if (!opts._[1] || !opts._[2]) fail(2, 'skip needs a step and a reason: skip S5 "owner decided …"');
      outcome = await engine.skip(opts._[1], opts._.slice(2).join(" "), budgetMs);
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
say(`\n[run ${s.runId} · session ${s.session} · phase ${s.phase} · ${done}/${STEPS.length} steps recorded · records r2://${s.bucket}/${s.prefix}]`);
if (outcome === "session-done" && s.phase === "checkpoint") say(checkpointText(s));
if (outcome === "session-done" && s.phase === "session-1") say("Session 1 has no step left but the checkpoint is not recorded: run next.");
if (outcome === "finished") say(finishText(s));
if (outcome === "more") say("The time budget is used up. Run `node scripts/live-pass/live-pass.mjs next` again.");
if (outcome === "status") say(statusText(s));
process.exit(EXIT[outcome] ?? 0);

// ---- Texts and results ----

function statusText(st) {
  const lines = STEPS.filter((x) => x.session === st.session || st.done[x.id]).map((x) => `  ${(st.done[x.id]?.result ?? (st.pending?.stepId === x.id ? (st.pending.prompt ? "waiting for owner" : st.pending.blocked ? "BLOCKED" : "in progress") : "-")).padEnd(17)} ${x.id.padEnd(5)} ${x.title}`);
  return lines.join("\n");
}

function checkpointText(st) {
  return [
    "",
    "================ SESSION 1 IS DONE: STOP HERE ================",
    `The checkpoint is stored in the test account: R2 bucket ${st.bucket}, ${st.prefix}state.json.`,
    "Tell the owner, word for word:",
    "",
    "  1. In this cloud environment's settings (environment menu → Edit → Environment variables), make them exactly:",
    "       CLOUDFLARE_ACCOUNT_ID    unchanged",
    "       LIVE_PASS_ADMIN_TOKEN    unchanged",
    "       CLOUDFLARE_API_TOKEN     the everyday token value the admin app's Everyday token page showed",
    "     and DELETE CLOUDFLARE_BOOTSTRAP_TOKEN, LIVE_PASS_BOOTSTRAP_LONG and LIVE_PASS_BOOTSTRAP_RERUN. Save.",
    "  2. Start a NEW session in this environment, on the same repository branch, and paste this prompt:",
    "",
    "       Run session 2 of the v0.2.0 live pass. Follow ai/implementation/live-pass-v0.2.0.md, section 4.",
    "       Start with: node scripts/live-pass/live-pass.mjs resume",
    "",
    `  (The runner in session 1 was commit ${st.runnerSha}; session 2 should run the same commit or a later one of the same branch.)`,
    "Then end this session. Do not run anything else here.",
  ].join("\n");
}

function finishText(st) {
  const h = st.facts.handover ?? {};
  return [
    "",
    "================ THE LIVE PASS IS FINISHED ================",
    "Everything is in the records bucket. Tell the owner, word for word:",
    "",
    "  Make one more account API token for the analysis and cleanup (the runbook's last step):",
    `    ${h.finalTokenLink ?? "(the link could not be built; make it by hand)"}`,
    "  It must hold exactly these permissions (all on this account; the dashboard shows Write as Edit):",
    ...(h.finalTokenGroups ?? []).map((g) => `    - ${g.replace(/ Write$/, " Edit")}`),
    ...(h.groupsNotResolved?.length ? [`  Add these by hand on the page (the link could not pre-fill them): ${h.groupsNotResolved.join(", ")}`] : []),
    "  Expiry: 7 days. Then give the analyst, in one message:",
    `    records: R2 bucket ${st.bucket}, prefix ${st.prefix}`,
    `    account ID: ${st.accountId}`,
    "    the token value (only to the analyst; never in this chat)",
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
