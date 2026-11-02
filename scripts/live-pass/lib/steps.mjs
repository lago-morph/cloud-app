// The live pass's steps, in order: session 1 (the starter token; setup in the admin app), the
// checkpoint, session 2 (the everyday token; stages, sign-ins, role change, removal), the finish.
// Step and check IDs keep the runbook's (ai/implementation/live-pass-v0.2.0.md): S1–S17 are its
// steps, the others (A-, C-, E-, F-, U-) its checks of points the run left unverified.
//
// Every step records observations: what was expected, what was observed, pass true/false, or null
// for a fact recorded without a verdict. Owner steps ask for one short reply; the runner then
// verifies what it can through the API, the auth app's database and the Workers logs.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi, describe as describeR } from "./cloudflare.mjs";
import { find } from "./snapshot.mjs";

// ---- Fixed names (framework constants this pass checks against) ----
export const ADMIN_ROLES = ["Super Administrator - All Privileges", "Administrator"]; // PAR-413
export const SUPER_ADMIN = "Super Administrator - All Privileges";
export const TEST_STAGE = "test-live";
export const PROD_STAGE = "prodcheck";
const ADMIN_SCRIPT = "prototype-admin";
const AUTH_SCRIPT = "prototype-auth";
const STORE = "prototype-framework"; // PAR-437
const CLIENTS = { admin: "prototype-framework-admin", signin: "prototype-framework-sign-in" };
const CLIENT_SECRETS = { admin: ["PROTOTYPE_ADMIN_CLIENT_ID", "PROTOTYPE_ADMIN_CLIENT_SECRET"], signin: ["PROTOTYPE_SIGNIN_CLIENT_ID", "PROTOTYPE_SIGNIN_CLIENT_SECRET"] };
const SIGNING_SECRETS = ["PROTOTYPE_R2_ACCESS_KEY_ID", "PROTOTYPE_R2_SECRET_ACCESS_KEY"];
const EVERYDAY_NAME = "prototype-framework";
const EVERYDAY_GROUPS = ["D1 Write", "Secrets Store Read", "Workers R2 Storage Write", "Workers Scripts Write"]; // EVERYDAY_V2, sorted
const BOOTSTRAP_GROUPS = ["Account API Tokens Write", "OAuth Client Write", "Secrets Store Write", "Workers Scripts Write"];
const SHARED_BUCKETS = ["prototype-logs", "sst-state", "prototype-backups"];
const ROLE_REFRESH_SECONDS = 300; // PAR-425
const BOOTSTRAP_MAX_SECONDS = 86_400; // PAR-435
// Permission group IDs used by the runner's own probe tokens (packages/framework/src/provision/cloudflare/permissions.ts).
const GROUP_IDS = { workersScriptsWrite: "e086da7e2179491d91ee5f35b3ca210a", r2Write: "bf7481a1826f439697cb59a20b22293e", d1Write: "09b2857d1c31407795e75e3fed8617a1" };

// ---- Small helpers ----
const out = (rec) => `${rec.stdout}\n${rec.stderr}`;
const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const ok = (answer) => /^\s*ok\b/i.test(answer);
const appUrl = (ctx, stage) => `https://${ctx.state.appName}-${stage}.${ctx.facts.subdomain}.workers.dev`;
const workerOf = (ctx, stage) => `${ctx.state.appName}-${stage}`;
const groupsOf = (token) => sorted((token?.policies ?? []).flatMap((p) => p.groups));
const accountOnly = (token, accountId) => (token?.policies ?? []).every((p) => Object.keys(p.resources ?? {}).every((r) => r === `com.cloudflare.api.account.${accountId}`));

function expectExit(ctx, rec, code, check) {
  ctx.observe("exit code", { check, expected: code, observed: rec.exitCode, pass: rec.exitCode === code });
}
function expectText(ctx, rec, texts, check) {
  for (const t of texts) ctx.observe(`output has "${t}"`, { check, expected: `output contains: ${t}`, observed: out(rec).includes(t) ? "present" : "absent", pass: out(rec).includes(t) });
}
function expectNoText(ctx, rec, texts, check) {
  for (const t of texts) ctx.observe(`output lacks "${t}"`, { check, expected: `output does not contain: ${t}`, observed: out(rec).includes(t) ? "present" : "absent", pass: !out(rec).includes(t) });
}
function expectNoSecret(ctx, rec, check) {
  const hits = Object.keys(rec.rawSecretHits ?? {});
  ctx.observe("no token value in output", { check, expected: "no known token value in the command's output", observed: hits.length === 0 ? "none" : `found: ${hits.join(", ")}`, pass: hits.length === 0 });
}
const replyCheck = (ctx, answer, what) => ctx.observe("owner reply", { expected: `"ok": ${what}`, observed: answer, pass: ok(answer) });

/** The owner and the tester from the members list: owner = Super Administrator, tester = the other accepted member. */
export function people(snapshot) {
  const accepted = (snapshot.members?.items ?? []).filter((m) => m.status === "accepted");
  const owner = accepted.find((m) => m.roles.includes(SUPER_ADMIN));
  const others = accepted.filter((m) => m !== owner);
  return { owner, tester: others.length === 1 ? others[0] : undefined, others, pending: (snapshot.members?.items ?? []).filter((m) => m.status !== "accepted") };
}

const isAdminRole = (roles) => roles.some((r) => ADMIN_ROLES.includes(r));

/** Verifies a starter token and checks its expiry against PAR-435. */
async function starterToken(ctx, name, value) {
  const v = await ctx.verify(value);
  const now = Date.now();
  const left = v.expiresOn ? Math.round((Date.parse(v.expiresOn) - now) / 1000) : null;
  return { ...v, secondsLeft: left, within: left !== null && left <= BOOTSTRAP_MAX_SECONDS && left > 0, name };
}

/** Polls a condition on fresh snapshots (Cloudflare lists can lag a few seconds). */
async function eventually(ctx, fn, { tries = 6, waitMs = 5000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await fn(await ctx.freshSnapshot());
    if (last) return last;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return last;
}

async function checkSecretsStore(ctx, snap) {
  const store = find.store(snap, STORE);
  ctx.observe("Secrets Store store", { check: "C-3", expected: `one store named ${STORE} (PAR-437), created by the bootstrap`, observed: (snap.secretsStore.items ?? []).map((s) => s.name), pass: store !== undefined && snap.secretsStore.items.length === 1 });
  for (const kind of ["admin", "signin"]) {
    const [idName, secretName] = CLIENT_SECRETS[kind];
    const a = find.secret(snap, STORE, idName);
    const b = find.secret(snap, STORE, secretName);
    const client = find.oauthClient(snap, CLIENTS[kind]);
    const clientId = client?.client_id ?? client?.id;
    ctx.observe(`${kind} client's entries`, {
      check: "C-3",
      expected: `${idName} and ${secretName} exist and carry the same non-empty comment, the ${CLIENTS[kind]} client's ID`,
      observed: { [idName]: a?.comment ?? "(missing)", [secretName]: b?.comment ?? "(missing)", clientId: clientId ?? "(client not listed)" },
      pass: a !== undefined && b !== undefined && !!a.comment && a.comment === b.comment && (clientId === undefined || a.comment === clientId),
    });
  }
  if (store) ctx.setFacts({ storeId: store.id });
}

function checkAdminWorker(ctx, snap) {
  const w = find.worker(snap, ADMIN_SCRIPT);
  ctx.observe("admin app Worker", { check: "S4", expected: `Worker ${ADMIN_SCRIPT} deployed`, observed: w ? `deployed, modified ${w.modified_on}` : "absent", pass: w !== undefined });
  if (!w) return;
  ctx.observe("nodejs_compat", { check: "E-2", expected: "compatibility flag nodejs_compat", observed: w.compatibility_flags, pass: (w.compatibility_flags ?? []).includes("nodejs_compat") });
  for (const n of ["ADMIN_CLIENT_ID", "ADMIN_CLIENT_SECRET"]) {
    const b = find.binding(w, n);
    ctx.observe(`binding ${n}`, { check: "C-4", expected: "secrets_store_secret", observed: b ? { type: b.type, store_id: b.store_id, secret_name: b.secret_name } : "absent", pass: b?.type === "secrets_store_secret" });
  }
  for (const n of ["ADMIN_ACCOUNT_ID", "ADMIN_APP_ORIGIN"]) {
    const b = find.binding(w, n);
    ctx.observe(`binding ${n}`, { check: "E-2", expected: "plain_text", observed: b ? { type: b.type } : "absent", pass: b?.type === "plain_text" });
  }
}

function checkClients(ctx, snap) {
  for (const kind of ["admin", "signin"]) {
    const c = find.oauthClient(snap, CLIENTS[kind]);
    ctx.observe(`OAuth client ${CLIENTS[kind]}`, {
      check: "C-2",
      expected: "listed by name, with its client ID (the list's fields), redirect URI and scopes",
      observed: c ? { client_id: c.client_id ?? c.id, redirect_uris: c.redirect_uris, scopes: c.scopes, optional_scopes: c.optional_scopes, response_types: c.response_types, grant_types: c.grant_types, token_endpoint_auth_method: c.token_endpoint_auth_method } : snap.oauthClients.ok === false ? `not readable: ${snap.oauthClients.error}` : "absent",
      pass: c !== undefined,
    });
  }
}

const ownerLinkHelp = "Reply ok if everything matched; otherwise say in a few words what differed. The runner records the reply word for word.";

// ---- The steps ----

/** @type {any[]} */
export const STEPS = [
  // ===================== Session 1 =====================
  {
    id: "P1",
    session: 1,
    title: "Preflight: tools, network, tokens, and an empty account",
    expected: ["Node and npm present", "api.cloudflare.com, the npm registry and dash.cloudflare.com reachable", "the admin token holds every group the runner needs", "each supplied starter token is active", "the account holds nothing but the records bucket and the run's tokens"],
    blocking: true,
    async run(ctx) {
      ctx.observe("runner", { expected: null, observed: { node: process.version, platform: process.platform, runnerSha: ctx.state.runnerSha, version: ctx.state.version, app: ctx.state.appName }, pass: null });
      const npm = await ctx.exec(["npm", "--version"], { cwd: ctx.repoDir, label: "npm-version" });
      ctx.observe("npm", { expected: "npm runs", observed: npm.stdout.trim(), pass: npm.exitCode === 0 });
      for (const url of ["https://api.cloudflare.com/client/v4/ips", "https://registry.npmjs.org/-/ping", "https://dash.cloudflare.com/.well-known/openid-configuration"]) {
        const r = await ctx.http(url);
        ctx.observe(`reach ${new URL(url).host}`, { expected: "HTTP 200", observed: r.status, pass: r.status === 200 });
      }
      const missing = await ctx.adminGroupsMissing();
      ctx.observe("admin token groups", { expected: "every group of the runbook's admin token", observed: missing.length === 0 ? "all present" : `missing: ${missing.join(", ")}`, pass: missing.length === 0 });
      if (missing.length > 0) throw new Error(`The admin token LIVE_PASS_ADMIN_TOKEN lacks: ${missing.join(", ")}. Make it again as runbook section 1.4 says, put it in the environment settings and start a new session.`);
      const tokens = {};
      for (const [name, value] of Object.entries(ctx.starterTokens())) {
        const t = await starterToken(ctx, name, value);
        tokens[name] = t;
        ctx.observe(`starter token ${name}`, { expected: name === "LIVE_PASS_BOOTSTRAP_LONG" ? "active, no expiry" : `active, expiry at most ${BOOTSTRAP_MAX_SECONDS} s away (PAR-435)`, observed: { ok: t.ok, status: t.status, kind: t.kind, expiresOn: t.expiresOn, secondsLeft: t.secondsLeft }, pass: t.ok && t.status === "active" });
      }
      ctx.setFacts({ starterTokenIds: Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, v.id ?? null])) });
      const snap = await ctx.freshSnapshot();
      const ours = new Set([ctx.facts.adminTokenId, ...Object.values(ctx.facts.starterTokenIds ?? {})]);
      const otherTokens = (snap.tokens.items ?? []).filter((t) => !ours.has(t.id));
      const buckets = (snap.r2.items ?? []).map((b) => b.name).filter((n) => n !== ctx.state.bucket);
      const empty = { workers: (snap.workers.items ?? []).map((w) => w.name), d1: (snap.d1.items ?? []).map((d) => d.name), buckets, stores: (snap.secretsStore.items ?? []).map((s) => s.name), oauthClients: (snap.oauthClients.items ?? []).map((c) => c.name), otherTokens: otherTokens.map((t) => t.name) };
      ctx.observe("account empty", { expected: "no Workers, D1, other buckets, stores, OAuth clients or other tokens", observed: empty, pass: Object.values(empty).every((l) => l.length === 0) });
      for (const sec of ["members", "tokens", "oauthClients", "workers", "d1", "r2", "secretsStore"]) {
        ctx.observe(`snapshot section ${sec} readable`, { expected: "readable with the admin token", observed: snap[sec].ok === false ? snap[sec].error : "readable", pass: snap[sec].ok !== false });
      }
      ctx.observe("workers.dev subdomain before setup", { expected: null, observed: snap.subdomain, pass: null });
    },
  },
  {
    id: "P2",
    session: 1,
    title: "A new app from the published release candidate",
    expected: ["npm create @lago-morph/prototype-app@<version> makes the app and installs it", "the installed framework is the release candidate", "a committed config/cloudflare/prodcheck.json for the production stage"],
    blocking: true,
    async run(ctx) {
      await ctx.ensureProject({ force: true });
    },
  },
  {
    id: "P3",
    session: 1,
    title: "The owner and the tester are members",
    expected: ["two accepted members: the owner (Super Administrator - All Privileges) and the tester with a role that is not an administrator role"],
    blocking: true,
    async run(ctx) {
      const snap = await ctx.freshSnapshot();
      const p = people(snap);
      ctx.observe("members before", { expected: null, observed: (snap.members.items ?? []).map((m) => ({ email: m.email, userId: m.userId, status: m.status, roles: m.roles })), pass: null });
      if (p.owner && p.tester && !isAdminRole(p.tester.roles)) {
        ctx.setFacts({ skipInvite: true });
      }
    },
    owner: [
      {
        prompt: (ctx) =>
          ctx.facts.skipInvite
            ? "Nothing to do: the tester is already a member with a role that is not an administrator role. Reply ok."
            : [
                "In your own browser profile: Cloudflare dashboard → Manage Account → Members → Invite.",
                "  Invite the tester's email address with exactly one role: \"HTTP Applications Read\" (if that role is not offered, pick any one role that is not an administrator role, and say which in your reply).",
                "In the tester's browser profile (or a private window): accept the invitation from the email, sign in to Cloudflare as the tester, and stay signed in.",
                ownerLinkHelp,
              ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the tester accepted the invitation");
          const p = await eventually(ctx, (s) => {
            const x = people(s);
            return x.owner && x.tester ? x : undefined;
          });
          const found = p ?? people(await ctx.freshSnapshot());
          ctx.observe("owner", { expected: `an accepted member with ${SUPER_ADMIN}`, observed: found.owner ? { email: found.owner.email, userId: found.owner.userId, roles: found.owner.roles } : "none", pass: found.owner !== undefined });
          ctx.observe("tester", { expected: "one other accepted member with no administrator role", observed: found.tester ? { email: found.tester.email, userId: found.tester.userId, roles: found.tester.roles } : { others: found.others.length, pending: found.pending.map((m) => m.email) }, pass: found.tester !== undefined && !isAdminRole(found.tester.roles) });
          if (found.owner && found.tester) {
            ctx.setFacts({ owner: { email: found.owner.email, userId: found.owner.userId, memberId: found.owner.id }, tester: { email: found.tester.email, userId: found.tester.userId, memberId: found.tester.id, roles: found.tester.roles } });
          } else {
            throw new Error("the owner and the tester could not be identified from the members list");
          }
        },
      },
    ],
  },
  {
    id: "S2",
    session: 1,
    check: "SETUP-AC-011",
    title: "Bad paste: a value that is not a token",
    expected: ["names CLOUDFLARE_BOOTSTRAP_TOKEN and says Cloudflare does not accept it, with the bootstrap link", "exit 1", "nothing created"],
    async run(ctx) {
      const before = await ctx.freshSnapshot();
      const rec = await ctx.fw(["cloudflare-setup"], { set: { CLOUDFLARE_BOOTSTRAP_TOKEN: "not-a-token" }, label: "bad-paste" });
      expectExit(ctx, rec, 1, "S2");
      expectText(ctx, rec, ["CLOUDFLARE_BOOTSTRAP_TOKEN", "https://dash.cloudflare.com/"], "S2");
      const after = await ctx.freshSnapshot();
      const diff = ctx.diff(before, after);
      ctx.observe("nothing created", { check: "S2", expected: "no resource added or changed", observed: diff, pass: diff.added.length === 0 && diff.changed.filter((k) => !k.startsWith("token:")).length === 0 });
    },
  },
  {
    id: "S1",
    session: 1,
    check: "SETUP-AC-011",
    title: "A starter token with no expiry is deleted at once",
    expected: ["\"…: it has no expiry … Setup deleted it at once and used it for nothing else.\" and the link again", "exit 1", "the token no longer verifies and is gone from the list", "no token value in the output", "nothing else created"],
    async run(ctx) {
      const value = ctx.env.LIVE_PASS_BOOTSTRAP_LONG;
      if (!value) {
        ctx.na("LIVE_PASS_BOOTSTRAP_LONG was not supplied");
        return;
      }
      const t = await starterToken(ctx, "LIVE_PASS_BOOTSTRAP_LONG", value);
      ctx.observe("token before", { expected: "active, no expiry", observed: { status: t.status, expiresOn: t.expiresOn }, pass: t.ok && t.expiresOn === null });
      const before = await ctx.freshSnapshot();
      const rec = await ctx.fw(["cloudflare-setup"], { set: { CLOUDFLARE_BOOTSTRAP_TOKEN: value }, label: "long-lived" });
      expectExit(ctx, rec, 1, "S1");
      expectText(ctx, rec, ["no expiry", "deleted it at once", "https://dash.cloudflare.com/"], "S1");
      expectNoSecret(ctx, rec, "S1");
      const v = await ctx.verify(value);
      ctx.observe("token after", { check: "S1", expected: "no longer verifies", observed: v.ok ? { status: v.status } : v.error, pass: !v.ok });
      const after = await ctx.freshSnapshot();
      ctx.observe("token gone from the list", { check: "S1", expected: "absent", observed: find.token(after, t.id) ? "present" : "absent", pass: find.token(after, t.id) === undefined });
      const diff = ctx.diff(before, after);
      ctx.observe("nothing else created", { check: "S1", expected: "nothing added", observed: diff, pass: diff.added.length === 0 });
    },
  },
  {
    id: "C-1",
    session: 1,
    check: "C-1",
    title: "What the dashboard's TTL picker set on the starter tokens (PAR-435)",
    expected: ["CLOUDFLARE_BOOTSTRAP_TOKEN (and LIVE_PASS_BOOTSTRAP_RERUN, if given) active with expires_on at most 24 h away"],
    blocking: true,
    async run(ctx) {
      const main = await starterToken(ctx, "CLOUDFLARE_BOOTSTRAP_TOKEN", ctx.env.CLOUDFLARE_BOOTSTRAP_TOKEN);
      ctx.observe("CLOUDFLARE_BOOTSTRAP_TOKEN expiry", { check: "C-1", expected: `active, expires_on at most ${BOOTSTRAP_MAX_SECONDS} s away`, observed: { status: main.status, expiresOn: main.expiresOn, now: new Date().toISOString(), secondsLeft: main.secondsLeft }, pass: main.ok && main.within });
      const groups = await ctx.tokenGroups(main.id);
      ctx.observe("CLOUDFLARE_BOOTSTRAP_TOKEN groups", { check: "S3", expected: BOOTSTRAP_GROUPS, observed: groups, pass: same(groups ?? [], BOOTSTRAP_GROUPS) });
      if (ctx.env.LIVE_PASS_BOOTSTRAP_RERUN) {
        const re = await starterToken(ctx, "LIVE_PASS_BOOTSTRAP_RERUN", ctx.env.LIVE_PASS_BOOTSTRAP_RERUN);
        ctx.observe("LIVE_PASS_BOOTSTRAP_RERUN expiry", { check: "C-1", expected: `active, expires_on at most ${BOOTSTRAP_MAX_SECONDS} s away`, observed: { status: re.status, expiresOn: re.expiresOn, secondsLeft: re.secondsLeft }, pass: re.ok && re.within });
      }
      if (!main.ok || !main.within) {
        throw new Error(
          `CLOUDFLARE_BOOTSTRAP_TOKEN is ${main.ok ? `active but expires ${main.expiresOn ?? "never"} (${main.secondsLeft ?? "no"} s away), more than 1 day` : "not usable"}. The setup would delete it at once. Nothing was run with it. Make a new starter token with TODAY as the end date (runbook section 1.4), replace CLOUDFLARE_BOOTSTRAP_TOKEN in the environment settings, start a new session and paste the resume prompt (runbook section 5).`,
        );
      }
    },
  },
  {
    id: "S4",
    session: 1,
    check: "SETUP-AC-011",
    title: "Bootstrap with the starter token",
    expected: ["\"OAuth clients: created prototype-framework-admin and prototype-framework-sign-in …\"", "\"admin app: deployed (Worker prototype-admin) …\"", "\"the bootstrap token deleted itself\"", "\"The Cloudflare bootstrap is complete.\" and the admin app's URL", "exit 0", "the starter token no longer verifies", "no token value in the output", "two OAuth clients, Secrets Store prototype-framework with four entries, Worker prototype-admin (C-2, C-3, C-4, E-2)"],
    blocking: true,
    async run(ctx) {
      const before = await ctx.freshSnapshot();
      const rec = await ctx.fw(["cloudflare-setup"], { label: "bootstrap" });
      expectExit(ctx, rec, 0, "S4");
      expectText(ctx, rec, ["OAuth clients: created", "admin app: deployed (Worker prototype-admin)", "the bootstrap token deleted itself", "The Cloudflare bootstrap is complete."], "S4");
      expectNoSecret(ctx, rec, "S4");
      ctx.observe("cloud-session note", { check: "S4", expected: "says the environment variable can be deleted (SETUP-REQ-004)", observed: /environment/i.test(out(rec)) ? "mentions the environment" : "no mention", pass: null });
      const m = out(rec).match(/https:\/\/prototype-admin\.([a-z0-9-]+)\.workers\.dev/);
      const v = await ctx.verify(ctx.env.CLOUDFLARE_BOOTSTRAP_TOKEN);
      ctx.observe("starter token after", { check: "S4", expected: "no longer verifies (deleted itself)", observed: v.ok ? { status: v.status } : v.error, pass: !v.ok });
      const after = await ctx.freshSnapshot();
      ctx.observe("starter token gone from the list", { check: "S4", expected: "absent", observed: find.token(after, ctx.facts.starterTokenIds?.CLOUDFLARE_BOOTSTRAP_TOKEN) ? "present" : "absent", pass: find.token(after, ctx.facts.starterTokenIds?.CLOUDFLARE_BOOTSTRAP_TOKEN) === undefined });
      ctx.observe("what the bootstrap changed", { expected: null, observed: ctx.diff(before, after), pass: null });
      const subdomain = after.subdomain?.subdomain ?? m?.[1];
      ctx.observe("workers.dev subdomain", { check: "S4", expected: "registered, and the printed URL uses it", observed: { api: after.subdomain?.subdomain, printed: m?.[1] }, pass: !!subdomain && (!m || m[1] === subdomain) });
      if (!subdomain) throw new Error("the bootstrap printed no admin app URL and the account has no workers.dev subdomain");
      ctx.setFacts({ subdomain, adminUrl: `https://prototype-admin.${subdomain}.workers.dev`, authUrl: `https://prototype-auth.${subdomain}.workers.dev`, clientIds: Object.fromEntries(["admin", "signin"].map((k) => [k, find.oauthClient(after, CLIENTS[k])?.client_id ?? find.oauthClient(after, CLIENTS[k])?.id ?? null])) });
      checkClients(ctx, after);
      await checkSecretsStore(ctx, after);
      checkAdminWorker(ctx, after);
      const page = await ctx.http(ctx.facts.adminUrl);
      ctx.observe("admin app answers", { check: "S4", expected: "HTTP 200 sign-in page", observed: page.status, pass: page.status === 200 });
      if (rec.exitCode !== 0) throw new Error("the bootstrap did not finish (exit code above); the starter token is kept by the framework for a retry within its expiry");
    },
  },
  {
    id: "S5",
    session: 1,
    check: "C-2",
    title: "Bootstrap re-run with a second starter token keeps both clients",
    expected: ["\"OAuth clients: prototype-framework-admin and prototype-framework-sign-in already exist …\"", "admin app redeployed", "the token deleted itself", "exit 0", "both clients keep their IDs"],
    async run(ctx) {
      const value = ctx.env.LIVE_PASS_BOOTSTRAP_RERUN;
      if (!value) {
        ctx.na("LIVE_PASS_BOOTSTRAP_RERUN was not supplied");
        return;
      }
      const before = await ctx.freshSnapshot();
      const rec = await ctx.fw(["cloudflare-setup"], { set: { CLOUDFLARE_BOOTSTRAP_TOKEN: value }, label: "bootstrap-rerun" });
      expectExit(ctx, rec, 0, "S5");
      expectText(ctx, rec, ["already exist", "admin app: deployed", "the bootstrap token deleted itself"], "S5");
      expectNoText(ctx, rec, ["OAuth clients: created"], "C-2");
      expectNoSecret(ctx, rec, "S5");
      const v = await ctx.verify(value);
      ctx.observe("token after", { check: "S5", expected: "no longer verifies", observed: v.ok ? { status: v.status } : v.error, pass: !v.ok });
      const after = await ctx.freshSnapshot();
      for (const k of ["admin", "signin"]) {
        const c = find.oauthClient(after, CLIENTS[k]);
        const id = c?.client_id ?? c?.id ?? null;
        ctx.observe(`${CLIENTS[k]} kept`, { check: "C-2", expected: ctx.facts.clientIds?.[k], observed: id, pass: id !== null && id === ctx.facts.clientIds?.[k] });
      }
      const w0 = find.worker(before, ADMIN_SCRIPT);
      const w1 = find.worker(after, ADMIN_SCRIPT);
      ctx.observe("admin app redeployed", { check: "S5", expected: "modified_on changed", observed: { before: w0?.modified_on, after: w1?.modified_on }, pass: !!w1 && w0?.modified_on !== w1?.modified_on });
      ctx.observe("observability after a framework redeploy", { expected: null, observed: { before: w0?.observability, after: w1?.observability }, pass: null, note: "whether a framework upload keeps Workers Logs on; the runner turns it on again after every step" });
      await checkSecretsStore(ctx, after);
    },
  },
  {
    id: "S6",
    session: 1,
    check: "SETUP-AC-011",
    title: "Admin app sign-in: the owner is admitted, the tester refused",
    expected: ["consent names client prototype-framework-admin with fixed rows Profile Information, User Details Read, Memberships Read", "owner: \"Signed in as <owner email>\", links Account setup, Everyday token, Status, Clean up v0.1.x email, and Sign out", "tester: 403 \"Only an administrator of this Cloudflare account can use the admin app.\"", "admin app log: \"admin signed in\""],
    owner: [
      {
        prompt: (ctx) =>
          [
            `1. Owner, in your own browser profile: open ${ctx.facts.adminUrl} and press "Sign in with Cloudflare".`,
            "   The consent page should name the client prototype-framework-admin and show the fixed rows Profile Information, User Details Read, Memberships Read (no optional toggles). Approve.",
            `   Expected: "Signed in as ${ctx.facts.owner?.email ?? "<your email>"}", links Account setup, Everyday token, Status, Clean up v0.1.x email, and a Sign out button. Stay signed in.`,
            `2. Tester, in the tester's browser profile: open ${ctx.facts.adminUrl} and do the same.`,
            "   Expected: \"Only an administrator of this Cloudflare account can use the admin app.\" and no session.",
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "owner admitted, tester refused");
          const ev = await ctx.logsSince(["admin signed in"], { scripts: [ADMIN_SCRIPT] });
          ctx.observe("admin app log", { check: "S6", expected: "an \"admin signed in\" event", observed: `${ev.matched.length} matching of ${ev.total} events`, pass: ev.ok ? ev.matched.length >= 1 : null, note: ev.ok ? undefined : ev.error });
          const refused = ev.events.filter((e) => /\b403\b/.test(JSON.stringify(e)) && JSON.stringify(e).includes(ADMIN_SCRIPT));
          ctx.observe("tester refusal in the logs", { check: "S6", expected: "a 403 from the admin app", observed: `${refused.length} event(s)`, pass: ev.ok ? refused.length >= 1 : null });
        },
      },
    ],
  },
  {
    id: "S7",
    session: 1,
    check: "SETUP-AC-011",
    title: "Admin app page 1, Account setup",
    expected: ["consent offers five optional toggles (Workers Scripts, D1, Workers R2, Secrets Store, Account API Tokens), all kept ticked", "\"The auth app is deployed at https://prototype-auth.<subdomain>.workers.dev, with its new D1 database.\"", "one Created/already-there line per shared resource", "\"Created the … signing … in Secrets Store.\"", "\"Recorded account setup version 2.\"", "E-8: the signing token prototype-r2-signing is made (release-blocking)", "E-9/F-3: the auth app's bindings", "F-6: the signing entries' comment"],
    owner: [
      {
        prompt: (ctx) =>
          [
            `Owner, in the admin app (${ctx.facts.adminUrl}; sign in again if it asks): open "Account setup" and press "Continue at Cloudflare".`,
            "The consent page offers five optional toggles (Workers Scripts, D1, Workers R2, Secrets Store, Account API Tokens). Keep all ticked. Approve.",
            "Expected, in order: \"The auth app is deployed at https://prototype-auth.…workers.dev, with its new D1 database.\", one \"Created …\" line per shared resource (log, state and backup buckets, lifecycle, subdomain), \"Created the … signing … in Secrets Store.\", \"Recorded account setup version 2.\"",
            "If you see \"That step failed: …\" instead, copy that page's text into your reply.",
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "account setup completed");
          const snap = await eventually(ctx, (s) => (find.worker(s, AUTH_SCRIPT) && find.d1(s, AUTH_SCRIPT) ? s : undefined));
          const s = snap ?? (await ctx.freshSnapshot());
          const auth = find.worker(s, AUTH_SCRIPT);
          ctx.observe("auth app Worker", { check: "S7", expected: `Worker ${AUTH_SCRIPT}`, observed: auth ? "deployed" : "absent", pass: auth !== undefined });
          const db = find.d1(s, AUTH_SCRIPT);
          ctx.observe("auth app D1", { check: "S7", expected: `D1 database ${AUTH_SCRIPT}`, observed: db ? db.uuid : "absent", pass: db !== undefined });
          for (const b of SHARED_BUCKETS) ctx.observe(`bucket ${b}`, { check: "S7", expected: "exists", observed: find.bucket(s, b) ? "exists" : "absent", pass: find.bucket(s, b) !== undefined });
          const backups = find.bucket(s, "prototype-backups");
          ctx.observe("backup lifecycle rule", { check: "S7", expected: "a lifecycle rule on prototype-backups (PAR-311)", observed: backups?.lifecycle ?? "absent", pass: Array.isArray(backups?.lifecycle?.rules) && backups.lifecycle.rules.length > 0 });
          const record = find.bucket(s, "sst-state")?.frameworkRecords?.["framework/account.json"];
          ctx.observe("setup record", { check: "S7", expected: "framework/account.json with setupVersion 2", observed: record ?? "absent", pass: record?.setupVersion === 2 });
          const signing = find.tokens(s, "prototype-r2-signing");
          ctx.observe("signing token", { check: "E-8", expected: "token prototype-r2-signing made by page 1 (release-blocking: workers-r2.write covers its group)", observed: signing.map((t) => ({ id: t.id, status: t.status, groups: groupsOf(t) })), pass: signing.length === 1 });
          const a = find.secret(s, STORE, SIGNING_SECRETS[0]);
          const b = find.secret(s, STORE, SIGNING_SECRETS[1]);
          ctx.observe("signing entries' comment", { check: "F-6", expected: `${SIGNING_SECRETS.join(" and ")} carry the same comment, the ID of prototype-r2-signing`, observed: { [SIGNING_SECRETS[0]]: a?.comment ?? "(missing)", [SIGNING_SECRETS[1]]: b?.comment ?? "(missing)", tokenId: signing[0]?.id }, pass: !!a && !!b && a.comment === b.comment && a.comment === signing[0]?.id });
          if (auth) {
            const dbb = find.binding(auth, "DB");
            ctx.observe("auth DB binding", { check: "E-9", expected: "DB as d1", observed: dbb ?? "absent", pass: dbb?.type === "d1" });
            ctx.observe("D1 binding's ID field", { check: "F-3", expected: "record whether it carries id or database_id", observed: dbb ? { id: dbb.id ?? null, database_id: dbb.database_id ?? null } : "absent", pass: dbb ? (dbb.id ?? dbb.database_id) !== undefined : false });
            for (const n of ["AUTH_APP_CLIENT_ID", "AUTH_APP_CLIENT_SECRET"]) ctx.observe(`binding ${n}`, { check: "E-9", expected: "secrets_store_secret", observed: find.binding(auth, n)?.type ?? "absent", pass: find.binding(auth, n)?.type === "secrets_store_secret" });
            for (const n of ["AUTH_APP_ACCOUNT_ID", "AUTH_APP_ORIGIN"]) ctx.observe(`binding ${n}`, { check: "E-9", expected: "plain_text", observed: find.binding(auth, n)?.type ?? "absent", pass: find.binding(auth, n)?.type === "plain_text" });
          }
          ctx.setFacts({ authDbId: db?.uuid ?? null, signingTokenId: signing[0]?.id ?? null });
          const ev = await ctx.logsSince(["step failed"], { scripts: [ADMIN_SCRIPT], wait: false });
          ctx.observe("admin app step failures", { check: "S7", expected: "no \"step failed\" event", observed: `${ev.matched.length} event(s)`, pass: ev.ok ? ev.matched.length === 0 : null });
        },
      },
    ],
  },
  {
    id: "E-1",
    session: 1,
    check: "E-1",
    title: "Page 2 with Secrets Store unticked does nothing",
    expected: ["\"Nothing was done: at Cloudflare these permissions were not granted, and this step needs them: secrets-store.read\"", "no token named prototype-framework made or changed"],
    owner: [
      {
        prompt: (ctx) =>
          [
            `Owner, in the admin app (${ctx.facts.adminUrl}): open "Everyday token" and press "Continue at Cloudflare".`,
            "On the consent page UNTICK \"Secrets Store\" (keep the others ticked) and approve.",
            "Expected: \"Nothing was done: at Cloudflare these permissions were not granted, and this step needs them:\" listing secrets-store.read. No token is made.",
            "(A \"That step failed: … 1001/9109\" page instead means the answer's scope was absent or listed unticked scopes: copy its text into your reply.)",
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "nothing was done, secrets-store.read named");
          const s = await ctx.freshSnapshot();
          const t = find.tokens(s, EVERYDAY_NAME);
          ctx.observe("no everyday token yet", { check: "E-1", expected: "no token named prototype-framework", observed: t.map((x) => x.id), pass: t.length === 0 });
        },
      },
    ],
  },
  {
    id: "S8",
    session: 1,
    check: "U2",
    title: "Page 2, Everyday token: created with exactly four groups",
    expected: ["\"The everyday token prototype-framework was created with exactly these permissions:\" and its value, shown once", "the token holds exactly Workers Scripts Write, Workers R2 Storage Write, D1 Write, Secrets Store Read, on this account only, no zone (U2)"],
    owner: [
      {
        prompt: (ctx) =>
          [
            `Owner, in the admin app (${ctx.facts.adminUrl}): open "Everyday token" and press "Continue at Cloudflare". Keep every toggle ticked and approve.`,
            "Expected: \"The everyday token prototype-framework was created with exactly these permissions:\" with four permissions, and the token's value, shown once.",
            "Copy the value. Do NOT paste it in this chat. Put it straight into this cloud environment's settings, as runbook section 2 says for session 2:",
            "  add CLOUDFLARE_API_TOKEN=<the value>, and delete CLOUDFLARE_BOOTSTRAP_TOKEN, LIVE_PASS_BOOTSTRAP_LONG and LIVE_PASS_BOOTSTRAP_RERUN.",
            "  (This session keeps its old values; only session 2 sees the change.)",
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the token was created and its value saved in the environment settings");
          const t = await eventually(ctx, (s) => (find.tokens(s, EVERYDAY_NAME).length > 0 ? find.tokens(s, EVERYDAY_NAME) : undefined));
          const tokens = t ?? [];
          ctx.observe("one everyday token", { check: "U2", expected: "exactly one token named prototype-framework, active", observed: tokens.map((x) => ({ id: x.id, status: x.status, expires_on: x.expires_on })), pass: tokens.length === 1 && tokens[0].status === "active" });
          if (tokens.length >= 1) {
            const g = groupsOf(tokens[0]);
            ctx.observe("its groups", { check: "U2", expected: EVERYDAY_GROUPS, observed: g, pass: same(g, EVERYDAY_GROUPS) });
            ctx.observe("its resources", { check: "U2", expected: "this account only, no zone", observed: tokens[0].policies.map((p) => p.resources), pass: accountOnly(tokens[0], ctx.state.accountId) });
            ctx.setFacts({ everydayTokenId: tokens[0].id });
          }
        },
      },
    ],
  },
  {
    id: "S10",
    session: 1,
    check: "SETUP-AC-011",
    title: "Page 3, Status, before any sign-in",
    expected: ["sections Workers (prototype-admin, prototype-auth deployed), Account setup (version 2, framework version, applied time), Registered apps (none yet), Recent sign-ins (none yet)", "no section shows a warning"],
    owner: [
      {
        prompt: (ctx) =>
          [
            `Owner, in the admin app (${ctx.facts.adminUrl}): open "Status" and press "Continue at Cloudflare" (three optional toggles; keep them ticked).`,
            "Expected sections: Workers (prototype-admin and prototype-auth deployed), Account setup (version 2, the framework version, when applied), Registered apps (none yet), Recent sign-ins (none yet). No section shows a warning.",
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "four sections, no warning");
          const rows = await ctx.authDb();
          ctx.observe("auth app database", { check: "S10", expected: "no registered app and no sign-in yet", observed: { registry: rows.registry.rows.length, users: rows.users.rows.length }, pass: rows.registry.ok ? rows.registry.rows.length === 0 && rows.users.rows.length === 0 : null });
        },
      },
    ],
  },
  {
    id: "CP",
    session: 1,
    checkpoint: true,
    title: "Checkpoint: session 1 done",
    expected: ["server logs, the auth app's records and a snapshot collected", "the checkpoint stored in the records bucket"],
    async run(ctx) {
      await ctx.collectServer("checkpoint");
      ctx.observe("facts for session 2", { expected: "admin app URL, subdomain, everyday token ID, owner, tester", observed: { adminUrl: ctx.facts.adminUrl, subdomain: ctx.facts.subdomain, everydayTokenId: ctx.facts.everydayTokenId, owner: ctx.facts.owner?.email, tester: ctx.facts.tester?.email }, pass: !!(ctx.facts.adminUrl && ctx.facts.everydayTokenId && ctx.facts.owner && ctx.facts.tester) });
    },
  },

  // ===================== Session 2 =====================
  {
    id: "R1",
    session: 2,
    title: "Session 2 preflight: only the everyday and admin tokens",
    expected: ["CLOUDFLARE_API_TOKEN is the everyday token made on page 2, active", "no starter token reaches any command", "network reachable"],
    blocking: true,
    async run(ctx) {
      const v = await ctx.verify(ctx.env.CLOUDFLARE_API_TOKEN);
      ctx.observe("everyday token", { expected: `active, ID ${ctx.facts.everydayTokenId}`, observed: v.ok ? { id: v.id, status: v.status, kind: v.kind } : v.error, pass: v.ok && v.status === "active" && v.id === ctx.facts.everydayTokenId });
      for (const name of ["CLOUDFLARE_BOOTSTRAP_TOKEN", "LIVE_PASS_BOOTSTRAP_LONG", "LIVE_PASS_BOOTSTRAP_RERUN"]) {
        const value = ctx.env[name];
        if (!value) {
          ctx.observe(name, { expected: "not set", observed: "not set", pass: true });
          continue;
        }
        const t = await ctx.verify(value);
        ctx.observe(name, { expected: "not set (removed from the environment settings)", observed: `still set; ${t.ok ? `ACTIVE (${t.status})` : "no longer valid"}; kept away from every command`, pass: null });
      }
      for (const url of ["https://api.cloudflare.com/client/v4/ips", "https://registry.npmjs.org/-/ping", `${ctx.facts.adminUrl}/`]) {
        const r = await ctx.http(url);
        ctx.observe(`reach ${new URL(url).host}`, { expected: "HTTP 200", observed: r.status, pass: r.status === 200 });
      }
      if (!v.ok || v.id !== ctx.facts.everydayTokenId) throw new Error(`CLOUDFLARE_API_TOKEN is ${v.ok ? `a different token (ID ${v.id}) than the everyday token page 2 made (${ctx.facts.everydayTokenId})` : "not a valid token"}. Put the value page 2 showed into CLOUDFLARE_API_TOKEN in the environment settings and start a new session.`);
    },
  },
  {
    id: "R2",
    session: 2,
    title: "The app again, in the new container",
    expected: ["the same app from the same release candidate"],
    blocking: true,
    async run(ctx) {
      await ctx.ensureProject({ force: true });
    },
  },
  {
    id: "S9",
    session: 2,
    check: "SETUP-AC-011",
    title: "\"continue prototype setup\" with the everyday token only; A-1a, A-2",
    expected: ["no question about an email domain", "\"account setup: current (setup version 2)\"", "\"everyday token: passed the quick check …\"", "U2: the everyday token reads Workers, R2, D1 and the Secrets Store list (a Secrets Store Read token can list stores)", "next step npm run deploy -- --target cloudflare --stage test-first", "exit 0", "A-1a: the role list holds exactly \"Administrator\" and \"Super Administrator - All Privileges\"", "A-2: Cloudflare's issuer string recorded"],
    async run(ctx) {
      const rec = await ctx.fw(["cloudflare-setup"], { label: "continue-setup" });
      expectExit(ctx, rec, 0, "S9");
      expectText(ctx, rec, ["account setup: current", "everyday token: passed", "--stage test-first"], "S9");
      expectNoText(ctx, rec, ["email domain", "CLOUDFLARE_EMAIL_DOMAIN"], "S9");
      expectNoSecret(ctx, rec, "S9");
      // U2: each everyday group answers with the everyday token; the store list needs only Secrets Store Read (C 34a's open item).
      for (const p of ["/workers/scripts", "/r2/buckets", "/d1/database", "/secrets_store/stores"]) {
        const r = await ctx.everydayApi().call("GET", ctx.api.account(p));
        ctx.observe(`everyday token GET ${p}`, { check: "U2", expected: 200, observed: r.ok ? r.status : describeR(r), pass: r.status === 200 && r.ok });
      }
      const roles = await ctx.api.call("GET", ctx.api.account("/roles?per_page=50"));
      const names = roles.ok ? (roles.body.result ?? []).map((r) => r.name) : [];
      ctx.observe("role names (admin token)", { check: "A-1", expected: ADMIN_ROLES, observed: roles.ok ? names : describeR(roles), pass: roles.ok ? ADMIN_ROLES.every((n) => names.includes(n)) : false });
      const er = await ctx.everydayApi().call("GET", ctx.api.account("/roles?per_page=50"));
      ctx.observe("role list with the everyday token", { check: "A-1", expected: "recorded (it holds no Account Settings Read)", observed: er.ok ? "readable" : describeR(er), pass: null });
      const issuer = await ctx.http("https://dash.cloudflare.com/.well-known/openid-configuration", { json: true });
      ctx.observe("issuer", { check: "A-2", expected: "recorded (DEC-0653)", observed: issuer.json?.issuer ?? issuer.status, pass: null });
    },
  },
  {
    id: "U3",
    session: 2,
    check: "U3",
    title: "Does a deploy that binds a Secrets Store secret need Secrets Store Read? (U3, F-7)",
    expected: ["a 1-day token with Workers Scripts Write, Workers R2 Storage Write and D1 Write only (made by the runner)", "probe upload with a secrets_store_secret binding: recorded (success means Secrets Store Read is not needed at deploy)", "control upload without bindings succeeds", "F-7: the store list answers 403 with an error code to that token", "probe Worker and token deleted"],
    async run(ctx) {
      const made = await ctx.api.call("POST", ctx.api.account("/tokens"), {
        json: { name: "pf-live-no-ssr", expires_on: new Date(Date.now() + 86_400_000).toISOString().replace(/\.\d+Z$/, "Z"), policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.${ctx.state.accountId}`]: "*" }, permission_groups: Object.values(GROUP_IDS).map((id) => ({ id })) }] },
      });
      if (!made.ok) {
        ctx.observe("probe token", { check: "U3", expected: "made", observed: describeR(made), pass: false });
        return;
      }
      const value = made.body.result.value;
      const id = made.body.result.id;
      ctx.secret("pf-live-no-ssr", value);
      ctx.observe("probe token", { check: "U3", expected: "made", observed: { id, groups: ["Workers Scripts Write", "Workers R2 Storage Write", "D1 Write"] }, pass: true });
      try {
        const probe = createApi({ token: value, accountId: ctx.state.accountId, onCall: ctx.onApiCall, label: "pf-live-no-ssr" });
        for (let i = 0; i < 6 && !(await ctx.verify(value)).ok; i++) await new Promise((r) => setTimeout(r, 5000));
        const upload = async (bindings) => {
          const form = new FormData();
          form.append("metadata", new Blob([JSON.stringify({ main_module: "pf-probe.js", compatibility_date: "2026-10-01", bindings })], { type: "application/json" }), "metadata.json");
          form.append("pf-probe.js", new Blob(['export default { fetch() { return new Response("ok"); } };\n'], { type: "application/javascript+module" }), "pf-probe.js");
          return probe.call("PUT", probe.account("/workers/scripts/pf-live-probe"), { body: form });
        };
        const withSecret = await upload([{ type: "secrets_store_secret", name: "PROBE", store_id: ctx.facts.storeId, secret_name: "PROTOTYPE_ADMIN_CLIENT_ID" }]);
        ctx.observe("upload binding a store secret", { check: "U3", expected: "recorded: success → Secrets Store Read is not needed at deploy; failure (with the control passing) → it is", observed: withSecret.ok ? "success" : describeR(withSecret), pass: null });
        const control = await upload([]);
        ctx.observe("control upload", { check: "U3", expected: "success", observed: control.ok ? "success" : describeR(control), pass: control.ok });
        const stores = await probe.call("GET", probe.account("/secrets_store/stores"));
        ctx.observe("store list without Secrets Store", { check: "F-7", expected: "403 with an error code", observed: { status: stores.status, errors: stores.body?.errors }, pass: stores.status === 403 });
        ctx.setFacts({ u3: withSecret.ok ? "not needed" : "needed" });
      } finally {
        const dw = await ctx.api.call("DELETE", ctx.api.account("/workers/scripts/pf-live-probe"));
        ctx.observe("probe Worker deleted", { expected: "deleted or absent", observed: dw.status, pass: dw.ok || dw.status === 404 });
        const dt = await ctx.api.call("DELETE", ctx.api.account(`/tokens/${id}`));
        ctx.observe("probe token deleted", { expected: "deleted", observed: dt.status, pass: dt.ok });
      }
    },
  },
  {
    id: "S11",
    session: 2,
    title: "Test stage with mock login",
    expected: ["deploy --target cloudflare --stage test-live exits 0 (after setting apiKey when the first deploy names it)", "the stage answers its health route", "mock login works: /api/auth/me shows level user (no auth app involved)"],
    async run(ctx) {
      await deployStage(ctx, TEST_STAGE);
      const base = appUrl(ctx, TEST_STAGE);
      const login = await ctx.http(`${base}/api/auth/mock-login`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ level: "user" }) });
      ctx.observe("mock login", { check: "S11", expected: "204 with a session cookie", observed: { status: login.status, cookies: login.cookieNames }, pass: login.status === 204 && login.cookieNames.length > 0 });
      const me = await ctx.http(`${base}/api/auth/me`, { headers: { cookie: login.cookieHeader }, json: true });
      ctx.observe("me after mock login", { check: "S11", expected: "level user", observed: me.json ?? me.status, pass: me.json?.level === "user" });
    },
  },
  {
    id: "S12",
    session: 2,
    check: "F-1",
    title: "Production stage prodcheck: registered with the auth app",
    expected: ["the first v0.2.0-only production deploy: no email-domain stop, exit 0", "F-1: binding AUTH is a service binding to prototype-auth with entrypoint AuthApp", "F-4: the registry row <app>-prodcheck → <APP>/api/auth/callback, read with the everyday token", "/start with the registered return: 302 to https://dash.cloudflare.com/oauth2/auth…; with a foreign return: 400, no redirect", "no mock login on a production stage", "F-5: n/a (no 0.1.x stage on a new account)"],
    async run(ctx) {
      const rec = await deployStage(ctx, PROD_STAGE);
      expectNoText(ctx, rec, ["email domain", "CLOUDFLARE_EMAIL_DOMAIN"], "S12");
      const app = appUrl(ctx, PROD_STAGE);
      ctx.setFacts({ appUrl: app, testUrl: appUrl(ctx, TEST_STAGE) });
      const s = await ctx.freshSnapshot();
      const w = find.worker(s, workerOf(ctx, PROD_STAGE));
      const auth = find.binding(w, "AUTH");
      ctx.observe("AUTH binding", { check: "F-1", expected: { type: "service", service: AUTH_SCRIPT, entrypoint: "AuthApp" }, observed: auth ?? "absent", pass: auth?.type === "service" && auth?.service === AUTH_SCRIPT && auth?.entrypoint === "AuthApp" });
      const reg = await ctx.d1With(ctx.everydayApi(), ctx.facts.authDbId, "SELECT app, return_url FROM registry");
      const want = { app: workerOf(ctx, PROD_STAGE), return_url: `${app}/api/auth/callback` };
      ctx.observe("registry via the everyday token", { check: "F-4", expected: want, observed: reg.ok ? reg.rows : reg.error, pass: reg.ok && reg.rows.some((r) => r.app === want.app && r.return_url === want.return_url) });
      const ret = encodeURIComponent(`${app}/api/auth/callback`);
      const start = await ctx.http(`${ctx.facts.authUrl}/start?app=${want.app}&return=${ret}&state=x`);
      ctx.observe("/start, registered return", { check: "S12", expected: "302 to https://dash.cloudflare.com/oauth2/auth", observed: { status: start.status, location: start.location }, pass: start.status === 302 && (start.location ?? "").startsWith("https://dash.cloudflare.com/oauth2/auth") });
      const foreign = await ctx.http(`${ctx.facts.authUrl}/start?app=${want.app}&return=${encodeURIComponent("https://example.com/api/auth/callback")}&state=x`);
      ctx.observe("/start, foreign return", { check: "S12", expected: "400, no redirect", observed: { status: foreign.status, location: foreign.location }, pass: foreign.status === 400 && !foreign.location });
      const login = await ctx.http(`${app}/api/auth/login`);
      ctx.observe("/api/auth/login", { check: "S12", expected: `302 to ${ctx.facts.authUrl}/start?app=${want.app}…`, observed: { status: login.status, location: login.location }, pass: login.status === 302 && (login.location ?? "").startsWith(`${ctx.facts.authUrl}/start`) });
      const mock = await ctx.http(`${app}/api/auth/mock-login`, { method: "POST", headers: { origin: app, "content-type": "application/json" }, body: JSON.stringify({ level: "admin" }) });
      ctx.observe("no mock login in production", { check: "S12", expected: "not 204 (no mock route)", observed: mock.status, pass: mock.status !== 204 });
      ctx.observe("delete-then-bind on a 0.1.x stage", { check: "F-5", expected: "n/a: a new account has no 0.1.x stage with Worker secrets", observed: "n/a", pass: null });
    },
  },
  {
    id: "S13",
    session: 2,
    check: "F-8",
    title: "Real sign-ins: the owner is admin, the tester user; a file upload (F-8)",
    expected: ["consent names client prototype-framework-sign-in, fixed rows only", "owner: \"Logged in as u_… (admin)\", /api/auth/me level admin", "tester: (user), level user", "F-8: the owner uploads a small image and opens it", "the auth app records the owner as admin and the tester as user"],
    owner: [
      {
        prompt: (ctx) =>
          [
            `1. Owner, own profile: open ${ctx.facts.appUrl} and press "Log in". The consent page names the client prototype-framework-sign-in with fixed rows only. Approve.`,
            `   Expected: back on the app, "Logged in as u_… (admin)". Open ${ctx.facts.appUrl}/api/auth/me: "level":"admin".`,
            "2. Owner: on the app's Files page choose a small image (PNG or JPEG), press Upload → \"Uploaded.\"; open it from the list → it loads.",
            `3. Tester, tester's profile: open ${ctx.facts.appUrl}, "Log in", approve. Expected "(user)" and ${ctx.facts.appUrl}/api/auth/me "level":"user". The tester stays signed in for the next step.`,
            ownerLinkHelp,
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "owner admin, tester user, upload works");
          const rows = await ctx.authDb();
          const users = rows.users.rows;
          const o = users.find((u) => u.email === ctx.facts.owner?.email);
          const t = users.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("owner recorded", { check: "S13", expected: { email: ctx.facts.owner?.email, sub: ctx.facts.owner?.userId, role: "admin" }, observed: o ?? "absent", pass: o?.role === "admin" });
          ctx.observe("tester recorded", { check: "S13", expected: { email: ctx.facts.tester?.email, sub: ctx.facts.tester?.userId, role: "user" }, observed: t ?? "absent", pass: t?.role === "user" });
          const s = await ctx.freshSnapshot();
          const files = find.bucket(s, `${workerOf(ctx, PROD_STAGE)}-files`);
          ctx.observe("uploaded object", { check: "F-8", expected: "at least one object in the stage's files bucket", observed: Array.isArray(files?.objects) ? files.objects.length : files ? files.objects : "bucket absent", pass: Array.isArray(files?.objects) && files.objects.length >= 1 });
          const ev = await ctx.logsSince(["/callback"], { scripts: [AUTH_SCRIPT], wait: true });
          ctx.observe("auth app callbacks in the logs", { check: "S13", expected: "invocations of /callback", observed: `${ev.matched.length} event(s)`, pass: ev.ok ? ev.matched.length >= 1 : null });
        },
      },
    ],
  },
  {
    id: "S14",
    session: 2,
    check: "A-1",
    title: "A role change takes effect at the next sign-in (DEC-0703, DEC-0791)",
    expected: ["the tester's existing session stays user after the role-refresh interval (PAR-425, 300 s)", "after signing out and in, the tester is admin with only the \"Administrator\" role (A-1 part b)", "set back to the original role, a new sign-in gives user"],
    owner: [
      {
        prompt: (ctx) =>
          [
            "The tester stays signed in to the app.",
            `Owner, own profile: Cloudflare dashboard → Manage Account → Members → ${ctx.facts.tester?.email} → change the role to exactly "Administrator" (remove the other role). Save.`,
            "Reply ok once it is saved.",
          ].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "role changed to Administrator");
          const m = await eventually(ctx, (s) => {
            const x = find.member(s, ctx.facts.tester?.email);
            return x && x.roles.includes("Administrator") ? x : undefined;
          });
          ctx.observe("tester's role", { check: "A-1", expected: ["Administrator"], observed: m?.roles ?? "unchanged", pass: m !== undefined && same(m.roles, ["Administrator"]) });
          ctx.setFacts({ roleChangedAt: new Date().toISOString() });
        },
      },
      {
        prompt: (ctx) => {
          const at = new Date(Date.parse(ctx.facts.roleChangedAt) + (ROLE_REFRESH_SECONDS + 60) * 1000).toISOString();
          return [
            `Wait until ${at.slice(11, 19)} UTC (the role-refresh interval, ${ROLE_REFRESH_SECONDS} s, plus a minute).`,
            `Then the tester reloads ${ctx.facts.appUrl}/api/auth/me (with DevTools → Network open, the answer may carry a new __Host-session cookie: the refresh ran).`,
            "Expected: still \"level\":\"user\" — a role change shows only at the next sign-in.",
            "Reply with the level shown: user or admin.",
          ].join("\n");
        },
        async verify(ctx, answer) {
          const level = /admin/i.test(answer) ? "admin" : /user/i.test(answer) ? "user" : answer;
          const waited = (Date.now() - Date.parse(ctx.facts.roleChangedAt)) / 1000;
          ctx.observe("existing session after the interval", { check: "S14", expected: "user", observed: { level, secondsSinceRoleChange: Math.round(waited) }, pass: level === "user" && waited >= ROLE_REFRESH_SECONDS ? true : level !== "user" ? false : null, note: waited < ROLE_REFRESH_SECONDS ? "answered before the interval had passed" : undefined });
          const t = (await ctx.authDb()).users.rows.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("auth app's recorded role", { check: "S14", expected: "user (recorded at the last sign-in)", observed: t?.role ?? "absent", pass: t?.role === "user" });
        },
      },
      {
        prompt: (ctx) => [`Tester: press "Log out" on ${ctx.facts.appUrl}, then "Log in" again.`, `Expected: "(admin)" and ${ctx.facts.appUrl}/api/auth/me "level":"admin".`, "Reply with the level shown: user or admin."].join("\n"),
        async verify(ctx, answer) {
          const level = /admin/i.test(answer) ? "admin" : /user/i.test(answer) ? "user" : answer;
          ctx.observe("after a new sign-in", { check: "A-1", expected: "admin (\"Administrator\" is an admin role, PAR-413)", observed: level, pass: level === "admin" });
          const t = (await ctx.authDb()).users.rows.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("auth app's recorded role", { check: "A-1", expected: "admin", observed: t?.role ?? "absent", pass: t?.role === "admin" });
        },
      },
      {
        prompt: (ctx) =>
          [
            `Owner: set ${ctx.facts.tester?.email} back to the original role (${(ctx.facts.tester?.roles ?? []).join(", ") || "the role it had"}) in Manage Account → Members.`,
            `Tester: "Log out", then "Log in" on ${ctx.facts.appUrl}. Expected "(user)" and "level":"user".`,
            "Reply with the level shown: user or admin.",
          ].join("\n"),
        async verify(ctx, answer) {
          const level = /admin/i.test(answer) ? "admin" : /user/i.test(answer) ? "user" : answer;
          ctx.observe("after the role is set back", { check: "S14", expected: "user", observed: level, pass: level === "user" });
          const m = find.member(await ctx.freshSnapshot(), ctx.facts.tester?.email);
          ctx.observe("tester's role restored", { check: "S14", expected: ctx.facts.tester?.roles, observed: m?.roles, pass: m !== undefined && same(m.roles, ctx.facts.tester?.roles ?? []) });
          const t = (await ctx.authDb()).users.rows.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("auth app's recorded role", { check: "S14", expected: "user", observed: t?.role ?? "absent", pass: t?.role === "user" });
        },
      },
    ],
  },
  {
    id: "S15",
    session: 2,
    title: "Sign-out",
    expected: ["owner: \"Log out\" → \"You are not logged in.\", /api/auth/me level anonymous, no __Host-session cookie", "admin app: \"Sign out\" → the sign-in page", "the Cloudflare dashboard session stays (no end_session, DEC-0660)"],
    owner: [
      {
        prompt: (ctx) => [`Owner on ${ctx.facts.appUrl}: press "Log out". Expected "You are not logged in."; ${ctx.facts.appUrl}/api/auth/me shows "level":"anonymous".`, `Then in the admin app (${ctx.facts.adminUrl}) press "Sign out": the sign-in page shows. Your Cloudflare dashboard stays signed in.`, ownerLinkHelp].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "signed out of both");
        },
      },
    ],
  },
  {
    id: "S16",
    session: 2,
    check: "E-4",
    title: "Page 3 again: registered app and recent sign-ins (E-4)",
    expected: ["Registered apps lists <app>-prodcheck → <APP>/api/auth/callback", "Recent sign-ins lists the owner (admin) and the tester (user)", "both D1 sections show rows, not a warning"],
    owner: [
      {
        prompt: (ctx) => [`Owner: sign in to the admin app again (${ctx.facts.adminUrl}), open "Status", "Continue at Cloudflare", approve.`, `Expected: Registered apps lists ${ctx.state.appName}-${PROD_STAGE} → ${ctx.facts.appUrl}/api/auth/callback; Recent sign-ins lists you (admin) and the tester (user); no warning.`, ownerLinkHelp].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "both sections show rows");
          const rows = await ctx.authDb();
          ctx.observe("auth app database", { check: "E-4", expected: "the registry row and both people", observed: { registry: rows.registry.rows, users: rows.users.rows.map((u) => ({ email: u.email, role: u.role })) }, pass: rows.registry.rows.length >= 1 && rows.users.rows.length >= 2 });
        },
      },
    ],
  },
  {
    id: "U1",
    session: 2,
    check: "U1",
    title: "Can the grant update an everyday token it did not create? (U1, E-5)",
    expected: ["the runner makes a second token named prototype-framework with two of the four groups", "page 2 either updates it in place to exactly the four groups (yes) or makes a new one (no)", "the everyday token in use keeps working"],
    async run(ctx) {
      const made = await ctx.api.call("POST", ctx.api.account("/tokens"), {
        json: { name: EVERYDAY_NAME, policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.${ctx.state.accountId}`]: "*" }, permission_groups: [{ id: GROUP_IDS.workersScriptsWrite }, { id: GROUP_IDS.d1Write }] }] },
      });
      if (!made.ok) throw new Error(`making the stand-in token failed: ${describeR(made)}`);
      ctx.secret("u1-stand-in", made.body.result.value);
      ctx.setFacts({ u1TokenId: made.body.result.id });
      ctx.observe("stand-in token", { check: "U1", expected: "a token named prototype-framework, not made by the admin app", observed: { id: made.body.result.id, groups: ["Workers Scripts Write", "D1 Write"] }, pass: true });
    },
    owner: [
      {
        prompt: (ctx) =>
          [
            `Owner, admin app (${ctx.facts.adminUrl}): open "Everyday token", "Continue at Cloudflare", keep every toggle ticked, approve.`,
            "Expected, one of:",
            "  (yes) \"The existing everyday token was updated in place …; its value did not change\" — reply: updated",
            "  (no)  \"Cloudflare did not let this sign-in change the existing everyday token, so a new one was created …\" — reply: new",
            "If it is (no): do NOT press \"I have saved the new token: delete the old one\" (it would delete the token session 2 runs on), and do not save the new value.",
          ].join("\n"),
        async verify(ctx, answer) {
          const s = await ctx.freshSnapshot();
          const all = find.tokens(s, EVERYDAY_NAME);
          const standIn = find.token(s, ctx.facts.u1TokenId);
          const extra = all.filter((t) => t.id !== ctx.facts.u1TokenId && t.id !== ctx.facts.everydayTokenId);
          const updated = standIn !== undefined && same(groupsOf(standIn), EVERYDAY_GROUPS);
          ctx.observe("owner reply", { check: "U1", expected: "updated or new", observed: answer, pass: /updated|new/i.test(answer) ? null : false });
          ctx.observe("U1 answer", { check: "U1", expected: "recorded: the stand-in updated to exactly the four groups (yes), or a new token (no)", observed: { standIn: standIn ? groupsOf(standIn) : "absent", newTokens: extra.map((t) => ({ id: t.id, groups: groupsOf(t) })) }, pass: updated || extra.length > 0 });
          ctx.observe("reply agrees with the API", { check: "U1", expected: updated ? "updated" : "new", observed: answer, pass: updated ? /updated/i.test(answer) : /new/i.test(answer) });
          const v = await ctx.verify(ctx.env.CLOUDFLARE_API_TOKEN);
          ctx.observe("everyday token still works", { check: "U1", expected: "active", observed: v.ok ? v.status : v.error, pass: v.ok });
          const ev = find.token(s, ctx.facts.everydayTokenId);
          ctx.observe("everyday token's groups", { check: "U2", expected: EVERYDAY_GROUPS, observed: ev ? groupsOf(ev) : "absent", pass: ev !== undefined && same(groupsOf(ev), EVERYDAY_GROUPS) });
          ctx.setFacts({ u1: updated ? "yes" : extra.length > 0 ? "no" : "unclear", u1ExtraTokenIds: extra.map((t) => t.id) });
        },
      },
    ],
    async after(ctx) {
      for (const id of [ctx.facts.u1TokenId, ...(ctx.facts.u1ExtraTokenIds ?? [])].filter(Boolean)) {
        const d = await ctx.api.call("DELETE", ctx.api.account(`/tokens/${id}`));
        ctx.observe(`cleanup token ${id}`, { expected: "deleted (the runner's stand-in, or the copy page 2 made for it)", observed: d.status, pass: d.ok || d.status === 404 });
      }
    },
  },
  {
    id: "E-10",
    session: 2,
    check: "E-10",
    title: "Clean up v0.1.x email: R2 object and bucket deletes with a grant token (E-10)",
    expected: ["the runner makes a stand-in bucket prototype-mailsink with one object", "\"The Worker prototype-mailsink was already gone.\"", "\"Deleted the R2 bucket prototype-mailsink and its 1 stored test messages.\"", "the bucket is gone"],
    async run(ctx) {
      const c = await ctx.api.call("POST", ctx.api.account("/r2/buckets"), { json: { name: "prototype-mailsink" } });
      const p = await ctx.api.call("PUT", ctx.api.account("/r2/buckets/prototype-mailsink/objects/probe.txt"), { body: "probe", contentType: "text/plain" });
      ctx.observe("stand-in bucket", { check: "E-10", expected: "made, with one object", observed: { bucket: c.status, object: p.status }, pass: (c.ok || c.status === 409) && p.ok });
    },
    owner: [
      {
        prompt: (ctx) => [`Owner, admin app (${ctx.facts.adminUrl}): open "Clean up v0.1.x email", "Continue at Cloudflare", approve.`, "Expected: \"The Worker prototype-mailsink was already gone.\" and \"Deleted the R2 bucket prototype-mailsink and its 1 stored test messages.\", then the dashboard steps.", ownerLinkHelp].join("\n"),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the bucket and its message deleted");
          const s = await ctx.freshSnapshot();
          ctx.observe("stand-in bucket gone", { check: "E-10", expected: "absent", observed: find.bucket(s, "prototype-mailsink") ? "present" : "absent", pass: find.bucket(s, "prototype-mailsink") === undefined });
        },
      },
    ],
  },
  {
    id: "S17",
    session: 2,
    title: "Remove both stages; the registry is cleared",
    expected: ["remove test-live: exit 0", "remove prodcheck --confirm-production prodcheck: backup to prototype-backups, exit 0", "/start for the removed app: 400 (DEC-0725)", "no <app>-test-… Worker, no stage database or bucket left", "the shared account resources stay"],
    async run(ctx) {
      const r1 = await ctx.fw(["remove", "--target", "cloudflare", "--stage", TEST_STAGE], { label: "remove-test" });
      expectExit(ctx, r1, 0, "S17");
      const r2 = await ctx.fw(["remove", "--target", "cloudflare", "--stage", PROD_STAGE, "--confirm-production", PROD_STAGE], { label: "remove-prod" });
      expectExit(ctx, r2, 0, "S17");
      expectText(ctx, r2, ["prototype-backups"], "S17");
      const want = workerOf(ctx, PROD_STAGE);
      const start = await ctx.http(`${ctx.facts.authUrl}/start?app=${want}&return=${encodeURIComponent(`${ctx.facts.appUrl}/api/auth/callback`)}&state=x`);
      ctx.observe("/start after removal", { check: "S17", expected: 400, observed: start.status, pass: start.status === 400 });
      const reg = await ctx.authDb();
      ctx.observe("registry after removal", { check: "S17", expected: "no row for the removed app", observed: reg.registry.rows, pass: reg.registry.ok && !reg.registry.rows.some((r) => r.app === want) });
      const s = await ctx.freshSnapshot();
      const left = { workers: (s.workers.items ?? []).map((w) => w.name).filter((n) => n.startsWith(`${ctx.state.appName}-`)), d1: (s.d1.items ?? []).map((d) => d.name).filter((n) => n.startsWith(`${ctx.state.appName}-`)), buckets: (s.r2.items ?? []).map((b) => b.name).filter((n) => n.startsWith(`${ctx.state.appName}-`)) };
      ctx.observe("stage resources left", { check: "S17", expected: "none", observed: left, pass: Object.values(left).every((l) => l.length === 0) });
      const backups = find.bucket(s, "prototype-backups");
      const keys = Array.isArray(backups?.objects) ? backups.objects.filter((o) => o.key.startsWith(`${ctx.state.appName}/${PROD_STAGE}/`)) : [];
      ctx.observe("production backup", { check: "S17", expected: `objects under prototype-backups/${ctx.state.appName}/${PROD_STAGE}/ including manifest.json`, observed: keys.map((k) => k.key), pass: keys.some((k) => k.key.endsWith("manifest.json")) });
      const shared = [...SHARED_BUCKETS.map((b) => find.bucket(s, b)), find.worker(s, ADMIN_SCRIPT), find.worker(s, AUTH_SCRIPT), find.d1(s, AUTH_SCRIPT)];
      ctx.observe("shared account resources kept", { check: "S17", expected: "the three buckets, both apps, the auth database", observed: shared.map((x) => (x ? x.name : "absent")), pass: shared.every(Boolean) });
    },
  },
  {
    id: "FIN",
    session: 2,
    final: true,
    title: "Finish: collect everything and hand over",
    expected: ["all Workers logs of the run, the log bucket, the auth app's records and a final snapshot in the records bucket", "the final token's permission groups and link printed"],
    async run(ctx) {
      await ctx.collectServer("final");
      await ctx.finalInstructions();
    },
  },
];

/** Deploys a stage, setting apiKey when the first deploy names it; returns the last deploy's record. */
async function deployStage(ctx, stage) {
  let rec = await ctx.fw(["deploy", "--target", "cloudflare", "--stage", stage], { label: `deploy-${stage}` });
  if (rec.exitCode !== 0 && out(rec).includes("apiKey")) {
    ctx.observe("first deploy names the unset secret", { check: stage === PROD_STAGE ? "S12" : "S11", expected: "stops after creating the Worker, naming apiKey", observed: `exit ${rec.exitCode}`, pass: rec.exitCode === 1 });
    const value = randomBytes(24).toString("hex");
    ctx.secret(`apiKey-${stage}`, value);
    const set = await ctx.fw(["secrets", "set", "apiKey", "--target", "cloudflare", "--stage", stage], { input: value, label: `secret-${stage}` });
    ctx.observe("secrets set apiKey", { expected: "exit 0", observed: set.exitCode, pass: set.exitCode === 0 });
    rec = await ctx.fw(["deploy", "--target", "cloudflare", "--stage", stage], { label: `deploy-${stage}-again` });
  }
  expectExit(ctx, rec, 0, stage === PROD_STAGE ? "S12" : "S11");
  expectNoSecret(ctx, rec, stage === PROD_STAGE ? "S12" : "S11");
  const health = await ctx.http(`${appUrl(ctx, stage)}/api/__framework/health`);
  ctx.observe("health", { check: stage === PROD_STAGE ? "S12" : "S11", expected: 200, observed: health.status, pass: health.status === 200 });
  return rec;
}

/** Writes config/cloudflare/prodcheck.json (a production stage needs its own committed values file). */
export function addProdConfig(projectDir) {
  const target = join(projectDir, "config", "cloudflare", `${PROD_STAGE}.json`);
  if (existsSync(target)) return false;
  const test = join(projectDir, "config", "cloudflare", "test.json");
  writeFileSync(target, existsSync(test) ? readFileSync(test, "utf8") : '{\n  "values": {},\n  "framework": {}\n}\n');
  return true;
}
