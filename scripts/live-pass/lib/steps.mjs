// The live pass's steps, in order, all in one Claude session (DEC-0793): part 1 (the starter tokens;
// setup in the admin app), the checkpoint, part 2 (the everyday token; stages, sign-ins, role change,
// removal), the finish. In the state and the records a part is a "session" (1 or 2).
// Step and check IDs keep the runbook's (ai/implementation/live-pass-v0.2.0.md): S1–S17 are its
// steps, the others (A-, C-, E-, F-, U-) its checks of points the run left unverified; TOK-… are the
// owner's starter tokens.
//
// The runner does by API everything that needs no human Cloudflare login: the tester's invitation and
// role changes, the roll of the everyday token's value, its probe tokens. Each owner prompt is one
// link, one to three sentences on what to do there and what the owner should see, and the exact reply.
// Every step records observations: what was expected, what was observed, pass true/false, or null
// for a fact recorded without a verdict. After a reply the runner verifies what it can through the
// API, the auth app's database and the Workers logs.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApi, describe as describeR } from "./cloudflare.mjs";
import { OWNER_GROUP_IDS, OWNER_GROUPS } from "./groups.mjs";
import { SECRET } from "./secrets.mjs";
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
/**
 * The starter-token link for the test Cloudflare account (the API cannot make this token, code 1001):
 * the account's own token page, pre-filled with the token's name and its four groups by ID (DEC-0563's
 * link form). The dashboard cannot pre-fill the end date, which the prompt names in one line.
 */
export function starterTokenLink(accountId) {
  const keys = BOOTSTRAP_GROUPS.map((g) => ({ key: OWNER_GROUP_IDS[g], type: "edit" }));
  return `https://dash.cloudflare.com/${accountId}/api-tokens?permissionGroupKeys=${encodeURIComponent(JSON.stringify(keys))}&name=prototype-framework-bootstrap`;
}
export const TESTER_ROLE = "HTTP Applications Read";
// Every prompt names its login (`who`): "test" is the test account login (the new login whose sign-up made
// the test Cloudflare account; its Super Administrator), "primary" the primary account login (the login
// that owns the primary Cloudflare account, invited into the test Cloudflare account). In the records the
// two are `facts.owner` and `facts.tester`.
const SHARED_BUCKETS = ["prototype-logs", "sst-state", "prototype-backups"];
const ROLE_REFRESH_SECONDS = 300; // PAR-425
/** How long S14 waits after the role change: the refresh interval plus a minute (the offline tests shorten it). */
const ROLE_WAIT_SECONDS = Number(process.env.LIVE_PASS_ROLE_WAIT_SECONDS ?? ROLE_REFRESH_SECONDS + 60);
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
const levelOf = (answer) => (/admin/i.test(answer) ? "admin" : /user/i.test(answer) ? "user" : answer);

/** An owner part that asks for a starter token made from the framework's link, pasted into the chat and saved as `name`. */
function starterTokenPart(name, ttl, { skippable = true } = {}) {
  return {
    saveAs: name,
    prompt: (ctx) => ({
      link: starterTokenLink(ctx.state.accountId),
      who: "test",
      text: [`Set the end date to tomorrow, the one thing the link cannot fill in (${ttl}).`, "Then press \"Continue to summary\" and \"Create Token\", and copy the token's value (only a token made in the dashboard may hold Account API Tokens Edit, so the runner cannot make it)."],
      reply: skippable ? "paste the value into this chat, or skip" : "paste the value into this chat",
    }),
    async verify(ctx, answer) {
      if (skippable && /^\s*skip\b/i.test(answer)) {
        ctx.observe("starter token", { expected: "pasted, or skipped by the owner", observed: "skipped", pass: null });
        return;
      }
      const value = ctx.secretValue(name);
      if (!value) {
        ctx.observe("starter token saved", { expected: `the pasted value saved as ${ctx.vault.dir}/${name}`, observed: "not saved", pass: false });
        return;
      }
      ctx.secret(name, value);
      const t = await starterToken(ctx, name, value);
      ctx.observe("starter token", { expected: "an active account token", observed: { ok: t.ok, status: t.status, kind: t.kind, expiresOn: t.expiresOn, secondsLeft: t.secondsLeft }, pass: t.ok && t.status === "active" });
      if (t.id) ctx.setFacts({ starterTokenIds: { ...(ctx.facts.starterTokenIds ?? {}), [name]: t.id } });
    },
  };
}

/** Rolls the everyday token's value with the owner's token and keeps the new value in the secrets directory (DEC-0793). */
async function rollEveryday(ctx) {
  const r = await ctx.rollToken(ctx.facts.everydayTokenId);
  if (!r.ok) {
    ctx.observe("everyday token rolled", { check: "U2", expected: "the value rolled with the owner's token (PUT …/tokens/<id>/value)", observed: r.error, pass: null, note: "the owner pastes the value instead" });
    ctx.setFacts({ everydayRolled: false });
    return;
  }
  ctx.saveSecret(SECRET.everyday, r.value);
  let v = await ctx.verify(r.value);
  for (let i = 0; i < 5 && !v.ok; i++) {
    await new Promise((res) => setTimeout(res, 3000));
    v = await ctx.verify(r.value);
  }
  ctx.observe("everyday token rolled", { check: "U2", expected: `the new value verifies as the same token (${ctx.facts.everydayTokenId})`, observed: v.ok ? { id: v.id, status: v.status } : v.error, pass: v.ok && v.id === ctx.facts.everydayTokenId });
  ctx.setFacts({ everydayRolled: v.ok && v.id === ctx.facts.everydayTokenId, everydayRolledAt: new Date().toISOString() });
}

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

// ---- The steps ----

/** @type {any[]} */
export const STEPS = [
  // ===================== Part 1: the starter tokens and the setup =====================
  {
    id: "P1",
    session: 1,
    title: "Preflight: tools, network, the owner's token, and an empty test Cloudflare account",
    expected: ["Node and npm present", "api.cloudflare.com, the npm registry and dash.cloudflare.com reachable", "the owner's token live-pass-owner holds every group the runner needs", "the test Cloudflare account holds nothing but the records bucket and the owner's token"],
    blocking: true,
    async run(ctx) {
      ctx.observe("runner", { expected: null, observed: { node: process.version, platform: process.platform, runnerSha: ctx.state.runnerSha, version: ctx.state.version, app: ctx.state.appName }, pass: null });
      const npm = await ctx.exec(["npm", "--version"], { cwd: ctx.repoDir, label: "npm-version" });
      ctx.observe("npm", { expected: "npm runs", observed: npm.stdout.trim(), pass: npm.exitCode === 0 });
      for (const url of ["https://api.cloudflare.com/client/v4/ips", "https://registry.npmjs.org/-/ping", "https://dash.cloudflare.com/.well-known/openid-configuration"]) {
        const r = await ctx.http(url);
        ctx.observe(`reach ${new URL(url).host}`, { expected: "HTTP 200", observed: r.status, pass: r.status === 200 });
      }
      const missing = await ctx.ownerGroupsMissing();
      ctx.observe("owner token groups", { expected: OWNER_GROUPS, observed: missing.required.length === 0 ? "all required present" : `missing: ${missing.required.join(", ")}`, pass: missing.required.length === 0 });
      ctx.observe("owner token: Workers Observability", { expected: "present (without it no Workers log is collected)", observed: missing.optional.length === 0 ? "present" : "missing: the run goes on without the Workers logs", pass: missing.optional.length === 0 ? true : null });
      if (missing.required.length > 0) throw new Error(`The token live-pass-owner lacks: ${missing.required.map((g) => g.replace(/ Write$/, " Edit")).join(", ")}. In the test Cloudflare account's dashboard, edit the token live-pass-owner and add them (runbook section 1, step 3), then tell the agent to retry.`);
      const snap = await ctx.freshSnapshot();
      const ours = new Set([ctx.facts.ownerTokenId]);
      const otherTokens = (snap.tokens.items ?? []).filter((t) => !ours.has(t.id));
      const buckets = (snap.r2.items ?? []).map((b) => b.name).filter((n) => n !== ctx.state.bucket);
      const empty = { workers: (snap.workers.items ?? []).map((w) => w.name), d1: (snap.d1.items ?? []).map((d) => d.name), buckets, stores: (snap.secretsStore.items ?? []).map((s) => s.name), oauthClients: (snap.oauthClients.items ?? []).map((c) => c.name), otherTokens: otherTokens.map((t) => t.name) };
      ctx.observe("test Cloudflare account empty", { expected: "no Workers, D1, other buckets, stores, OAuth clients or other tokens", observed: empty, pass: Object.values(empty).every((l) => l.length === 0) });
      for (const sec of ["members", "tokens", "oauthClients", "workers", "d1", "r2", "secretsStore"]) {
        ctx.observe(`snapshot section ${sec} readable`, { expected: "readable with the owner's token", observed: snap[sec].ok === false ? snap[sec].error : "readable", pass: snap[sec].ok !== false });
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
    title: "The primary account login is invited into the test Cloudflare account and accepts",
    expected: ["the runner invites the primary account login's email with the role \"HTTP Applications Read\" (POST …/members, DEC-0793)", "two accepted members: the test account login (Super Administrator - All Privileges) and the primary account login with a role that is not an administrator role"],
    blocking: true,
    async run(ctx) {
      const email = ctx.facts.testerEmail;
      if (!email) throw new Error("The runner does not know the primary account login's email. Start the run with: node scripts/live-pass/live-pass.mjs start --primary-login <email>");
      const snap = await ctx.freshSnapshot();
      ctx.observe("members before", { expected: null, observed: (snap.members.items ?? []).map((m) => ({ email: m.email, userId: m.userId, status: m.status, roles: m.roles })), pass: null });
      const existing = find.member(snap, email);
      if (existing?.status === "accepted" && !isAdminRole(existing.roles)) {
        ctx.setFacts({ skipInvite: true });
        ctx.observe("invitation", { expected: "sent, or not needed", observed: "not needed: the primary account login is already an accepted member without an administrator role", pass: true });
        return;
      }
      if (existing) {
        ctx.observe("invitation", { expected: "sent, or not needed", observed: `an invitation is already ${existing.status}; none sent`, pass: existing.status === "pending" ? true : null });
        return;
      }
      const roles = await ctx.roles();
      const role = roles.items.find((r) => r.name === TESTER_ROLE);
      if (!role) throw new Error(`The test Cloudflare account offers no role "${TESTER_ROLE}" (${roles.ok ? `${roles.items.length} roles listed` : roles.error}).`);
      const inv = await ctx.invite(email, [role.id]);
      ctx.observe("invitation", { check: "P3", expected: `invited ${email} with ${TESTER_ROLE}`, observed: inv.ok ? { status: inv.status, memberId: inv.id } : inv.error, pass: inv.ok });
      if (!inv.ok) throw new Error(`Inviting ${email} failed: ${inv.error}. The token live-pass-owner needs Account Settings Edit.`);
    },
    owner: [
      {
        when: (ctx) => !ctx.facts.skipInvite,
        prompt: (ctx) => ({
          link: `the invitation link in the email Cloudflare just sent to ${ctx.facts.testerEmail}`,
          who: "primary", text: [`Open that email and press its link; sign in if asked, and accept the invitation to the test Cloudflare account.`, "Nothing in the primary Cloudflare account changes."],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the primary account login accepted the invitation");
          await eventually(ctx, (s) => (find.member(s, ctx.facts.testerEmail)?.status === "accepted" ? s : undefined));
        },
      },
    ],
    async after(ctx) {
      const found = people(await ctx.freshSnapshot());
      const tester = found.tester?.email === ctx.facts.testerEmail ? found.tester : undefined;
      ctx.observe("test account login", { expected: `an accepted member with ${SUPER_ADMIN}`, observed: found.owner ? { email: found.owner.email, userId: found.owner.userId, roles: found.owner.roles } : "none", pass: found.owner !== undefined });
      ctx.observe("primary account login", { expected: `${ctx.facts.testerEmail}, accepted, with no administrator role`, observed: tester ? { email: tester.email, userId: tester.userId, roles: tester.roles } : { others: found.others.map((m) => m.email), pending: found.pending.map((m) => m.email) }, pass: tester !== undefined && !isAdminRole(tester.roles) });
      if (found.owner && tester) {
        ctx.setFacts({ owner: { email: found.owner.email, userId: found.owner.userId, memberId: found.owner.id }, tester: { email: tester.email, userId: tester.userId, memberId: tester.id, roles: tester.roles, roleIds: tester.roleIds } });
      }
    },
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
    id: "TOK-S4",
    session: 1,
    title: "The test account login makes the starter token for the bootstrap (S4)",
    expected: ["a starter token with the framework's four groups and an end date of tomorrow, pasted by the owner and saved in the secrets directory"],
    owner: [starterTokenPart(SECRET.starter, "the framework refuses a starter token with more than one day left", { skippable: false })],
  },
  {
    id: "C-1",
    session: 1,
    check: "C-1",
    title: "What the dashboard's TTL picker set on the starter tokens (PAR-435)",
    expected: ["the starter token for S4 is active with expires_on at most 24 h away", "it holds exactly the framework's four groups"],
    blocking: true,
    async run(ctx) {
      const value = ctx.secretValue(SECRET.starter);
      if (!value) throw new Error(`There is no starter token for S4: the owner's pasted value was not saved as ${ctx.vault.dir}/${SECRET.starter}. Ask the owner for it again (runbook section 5).`);
      const main = await starterToken(ctx, SECRET.starter, value);
      ctx.observe("starter token expiry", { check: "C-1", expected: `active, expires_on at most ${BOOTSTRAP_MAX_SECONDS} s away`, observed: { status: main.status, expiresOn: main.expiresOn, now: new Date().toISOString(), secondsLeft: main.secondsLeft }, pass: main.ok && main.within });
      const groups = await ctx.tokenGroups(main.id);
      ctx.observe("starter token groups", { check: "S3", expected: BOOTSTRAP_GROUPS, observed: groups, pass: same(groups ?? [], BOOTSTRAP_GROUPS) });
      ctx.setFacts({ starterTokenIds: { ...(ctx.facts.starterTokenIds ?? {}), [SECRET.starter]: main.id ?? null } });
      if (!main.ok || !main.within) {
        throw new Error(
          `The starter token for S4 is ${main.ok ? `active but expires ${main.expiresOn ?? "never"} (${main.secondsLeft ?? "no"} s away), more than 1 day` : "not usable"}. The setup would delete it at once. Nothing was run with it. Ask the owner to make it again with TOMORROW as the end date and paste it; save it as ${ctx.vault.dir}/${SECRET.starter}, then run retry.`,
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
      const value = ctx.secretValue(SECRET.starter);
      const before = await ctx.freshSnapshot();
      const rec = await ctx.fw(["cloudflare-setup"], { set: { CLOUDFLARE_BOOTSTRAP_TOKEN: value }, label: "bootstrap" });
      expectExit(ctx, rec, 0, "S4");
      expectText(ctx, rec, ["OAuth clients: created", "admin app: deployed (Worker prototype-admin)", "the bootstrap token deleted itself", "The Cloudflare bootstrap is complete."], "S4");
      expectNoSecret(ctx, rec, "S4");
      ctx.observe("cloud-session note", { check: "S4", expected: "says the environment variable can be deleted (SETUP-REQ-004)", observed: /environment/i.test(out(rec)) ? "mentions the environment" : "no mention", pass: null });
      const m = out(rec).match(/https:\/\/prototype-admin\.([a-z0-9-]+)\.workers\.dev/);
      const v = await ctx.verify(value);
      ctx.observe("starter token after", { check: "S4", expected: "no longer verifies (deleted itself)", observed: v.ok ? { status: v.status } : v.error, pass: !v.ok });
      const after = await ctx.freshSnapshot();
      const id = ctx.facts.starterTokenIds?.[SECRET.starter];
      ctx.observe("starter token gone from the list", { check: "S4", expected: "absent", observed: find.token(after, id) ? "present" : "absent", pass: find.token(after, id) === undefined });
      ctx.observe("what the bootstrap changed", { expected: null, observed: ctx.diff(before, after), pass: null });
      const subdomain = after.subdomain?.subdomain ?? m?.[1];
      ctx.observe("workers.dev subdomain", { check: "S4", expected: "registered, and the printed URL uses it", observed: { api: after.subdomain?.subdomain, printed: m?.[1] }, pass: !!subdomain && (!m || m[1] === subdomain) });
      if (!subdomain) throw new Error("the bootstrap printed no admin app URL and the test Cloudflare account has no workers.dev subdomain");
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
    id: "TOK-S5",
    session: 1,
    title: "The test account login makes the second starter token (for the re-run, S5)",
    expected: ["a second starter token with the framework's four groups and an end date of tomorrow, pasted by the owner; or skip (S5 n/a)"],
    owner: [starterTokenPart(SECRET.starterRerun, "S5 runs the bootstrap again with it")],
  },
  {
    id: "S5",
    session: 1,
    check: "C-2",
    title: "Bootstrap re-run with a second starter token keeps both clients",
    expected: ["\"OAuth clients: prototype-framework-admin and prototype-framework-sign-in already exist …\"", "admin app redeployed", "the token deleted itself", "exit 0", "both clients keep their IDs"],
    async run(ctx) {
      const value = ctx.secretValue(SECRET.starterRerun);
      if (!value) {
        ctx.na("the owner skipped the second starter token");
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
    title: "Admin app sign-in: the test account login is admitted, the primary account login refused",
    expected: ["consent names client prototype-framework-admin with fixed rows Profile Information, User Details Read, Memberships Read", "test account login: \"Signed in as <its email>\", links Account setup, Everyday token, Status, Clean up v0.1.x email, and Sign out", "primary account login: 403 \"Only an administrator of this Cloudflare account can use the admin app.\"", "admin app log: \"admin signed in\""],
    owner: [
      {
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Press "Sign in with Cloudflare" and approve (the consent page names prototype-framework-admin).`, `You should see "Signed in as ${ctx.facts.owner?.email ?? "<the test account login's email>"}" and the links Account setup, Everyday token, Status and Clean up v0.1.x email.`],
          reply: "ok",
        }),
        verify(ctx, answer) {
          replyCheck(ctx, answer, "the test account login admitted");
        },
      },
      {
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "primary", text: [`Press "Sign in with Cloudflare" and approve.`, "You should see \"Only an administrator of this Cloudflare account can use the admin app.\""],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the primary account login refused");
          const ev = await ctx.logsSince(["admin signed in"], { scripts: [ADMIN_SCRIPT] });
          ctx.observe("admin app log", { check: "S6", expected: "an \"admin signed in\" event", observed: `${ev.matched.length} matching of ${ev.total} events`, pass: ev.ok ? ev.matched.length >= 1 : null, note: ev.ok ? undefined : ev.error });
          const refused = ev.events.filter((e) => /\b403\b/.test(JSON.stringify(e)) && JSON.stringify(e).includes(ADMIN_SCRIPT));
          ctx.observe("the primary account login's refusal in the logs", { check: "S6", expected: "a 403 from the admin app", observed: `${refused.length} event(s)`, pass: ev.ok ? refused.length >= 1 : null });
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
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Open "Account setup", press "Continue at Cloudflare", keep all five toggles ticked and approve (sign in again first if it asks).`, "You should see one line per shared resource and, last, \"Recorded account setup version 2.\""],
          reply: "ok, or the page's text if it says \"That step failed\"",
        }),
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
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Open "Everyday token", press "Continue at Cloudflare", UNTICK "Secrets Store" (keep the others ticked) and approve.`, "You should see \"Nothing was done: …\" naming secrets-store.read."],
          reply: "ok, or the page's text if it differs",
        }),
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
    title: "Page 2, Everyday token: created with exactly four groups; the runner rolls its value",
    expected: ["\"The everyday token prototype-framework was created with exactly these permissions:\" and its value, shown once", "the token holds exactly Workers Scripts Write, Workers R2 Storage Write, D1 Write, Secrets Store Read, on the test Cloudflare account only, no zone (U2)", "the runner rolls the token's value with the owner's token (PUT …/tokens/<id>/value) and keeps the new value in the secrets directory; the owner copies nothing (DEC-0793)"],
    owner: [
      {
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Open "Everyday token", press "Continue at Cloudflare", keep every toggle ticked and approve.`, "You should see \"The everyday token prototype-framework was created with exactly these permissions\" and its value; leave the page open, but do not copy the value: the runner replaces it."],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the token was created");
          const t = await eventually(ctx, (s) => (find.tokens(s, EVERYDAY_NAME).length > 0 ? find.tokens(s, EVERYDAY_NAME) : undefined));
          const tokens = t ?? [];
          ctx.observe("one everyday token", { check: "U2", expected: "exactly one token named prototype-framework, active", observed: tokens.map((x) => ({ id: x.id, status: x.status, expires_on: x.expires_on })), pass: tokens.length === 1 && tokens[0].status === "active" });
          if (tokens.length < 1) return;
          const g = groupsOf(tokens[0]);
          ctx.observe("its groups", { check: "U2", expected: EVERYDAY_GROUPS, observed: g, pass: same(g, EVERYDAY_GROUPS) });
          ctx.observe("its resources", { check: "U2", expected: "the test Cloudflare account only, no zone", observed: tokens[0].policies.map((p) => p.resources), pass: accountOnly(tokens[0], ctx.state.accountId) });
          ctx.setFacts({ everydayTokenId: tokens[0].id });
          await rollEveryday(ctx);
        },
      },
      {
        when: (ctx) => !!ctx.facts.everydayTokenId && ctx.facts.everydayRolled !== true,
        saveAs: SECRET.everyday,
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test",
          text: ["The runner could not replace the everyday token's value through the API: copy the value the Everyday token page still shows."],
          reply: "paste the value into this chat",
        }),
        async verify(ctx) {
          const value = ctx.secretValue(SECRET.everyday);
          const v = value ? await ctx.verify(value) : { ok: false, error: "not saved" };
          ctx.observe("pasted everyday token", { check: "U2", expected: `active, ID ${ctx.facts.everydayTokenId}`, observed: v.ok ? { id: v.id, status: v.status } : v.error, pass: v.ok && v.id === ctx.facts.everydayTokenId });
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
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Open "Status", press "Continue at Cloudflare", keep the toggles ticked and approve.`, "You should see four sections, Workers, Account setup (version 2), Registered apps (none yet) and Recent sign-ins (none yet), and no warning."],
          reply: "ok",
        }),
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
    title: "Checkpoint: part 1 done (the run goes on in the same session)",
    expected: ["server logs, the auth app's records and a snapshot collected", "the checkpoint stored in the records bucket"],
    async run(ctx) {
      await ctx.collectServer("checkpoint");
      ctx.observe("facts for part 2", { expected: "admin app URL, subdomain, everyday token ID, both logins", observed: { adminUrl: ctx.facts.adminUrl, subdomain: ctx.facts.subdomain, everydayTokenId: ctx.facts.everydayTokenId, owner: ctx.facts.owner?.email, tester: ctx.facts.tester?.email }, pass: !!(ctx.facts.adminUrl && ctx.facts.everydayTokenId && ctx.facts.owner && ctx.facts.tester) });
    },
  },

  // ===================== Part 2: stages, sign-ins and the hand-over (same session) =====================
  {
    id: "R1",
    session: 2,
    title: "Part 2 preflight: the everyday token, and no starter token left",
    expected: ["the everyday token's value in the secrets directory verifies as the token page 2 made (rolled again if a new container lost it)", "every starter token is gone (each deleted itself)", "network reachable"],
    blocking: true,
    async run(ctx) {
      await ctx.ensureEveryday();
      const value = ctx.secretValue(SECRET.everyday);
      const v = value ? await ctx.verify(value) : { ok: false, error: `no value in ${ctx.vault.dir}/${SECRET.everyday}` };
      ctx.observe("everyday token", { expected: `active, ID ${ctx.facts.everydayTokenId}`, observed: v.ok ? { id: v.id, status: v.status, kind: v.kind } : v.error, pass: v.ok && v.status === "active" && v.id === ctx.facts.everydayTokenId });
      for (const name of [SECRET.starter, SECRET.starterRerun]) {
        const tv = ctx.secretValue(name);
        if (!tv) {
          ctx.observe(name, { expected: "gone", observed: "not in the secrets directory", pass: null });
          continue;
        }
        const t = await ctx.verify(tv);
        ctx.observe(name, { expected: "no longer valid (deleted itself)", observed: t.ok ? `ACTIVE (${t.status})` : "no longer valid", pass: !t.ok, note: "never passed to a part-2 command" });
      }
      for (const url of ["https://api.cloudflare.com/client/v4/ips", "https://registry.npmjs.org/-/ping", `${ctx.facts.adminUrl}/`]) {
        const r = await ctx.http(url);
        ctx.observe(`reach ${new URL(url).host}`, { expected: "HTTP 200", observed: r.status, pass: r.status === 200 });
      }
      if (!v.ok || v.id !== ctx.facts.everydayTokenId) throw new Error(`The everyday token's value in ${ctx.vault.dir}/${SECRET.everyday} is ${v.ok ? `a different token (ID ${v.id}) than the one page 2 made (${ctx.facts.everydayTokenId})` : "not usable"}. Run retry; if it blocks again, tell the owner.`);
    },
  },
  {
    id: "R2",
    session: 2,
    title: "The app is there (made again from the release candidate in a new container)",
    expected: ["the same app from the same release candidate"],
    blocking: true,
    async run(ctx) {
      await ctx.ensureProject({ force: false });
    },
  },
  {
    id: "S9",
    session: 2,
    check: "SETUP-AC-011",
    title: "\"continue prototype setup\" with the everyday token only; A-1a, A-2",
    expected: ["no question about an email domain", "\"account setup: current (setup version 2)\"", "\"everyday token: passed the quick check …\"", "U2: the everyday token reads Workers, R2, D1 and the Secrets Store list (a Secrets Store Read token can list stores)", "next step npm run deploy -- --target cloudflare --stage test-first", "exit 0", "A-1a: the role list holds exactly \"Administrator\" and \"Super Administrator - All Privileges\" (every page of it)", "A-2: Cloudflare's issuer string recorded"],
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
      // The role list has several pages (184 roles on 2026-11-08; "Administrator" is on the last).
      const roles = await ctx.roles();
      const names = roles.items.map((r) => r.name);
      ctx.observe("role names (owner's token)", { check: "A-1", expected: ADMIN_ROLES, observed: roles.ok ? names.filter((n) => ADMIN_ROLES.includes(n) || n === TESTER_ROLE) : roles.error, pass: roles.ok ? ADMIN_ROLES.every((n) => names.includes(n)) : false });
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
    title: "Real sign-ins: the test account login is admin, the primary account login user; a file upload (F-8)",
    expected: ["consent names client prototype-framework-sign-in, fixed rows only", "test account login: \"Logged in as u_… (admin)\"", "F-8: the test account login uploads a small image and opens it", "primary account login: (user)", "the auth app records the test account login as admin and the primary account login as user"],
    owner: [
      {
        prompt: (ctx) => ({
          link: ctx.facts.appUrl,
          who: "test", text: [`Press "Log in" and approve (the consent page names prototype-framework-sign-in); then on the Files page upload a small PNG or JPEG and open it from the list.`, "You should see \"Logged in as u_… (admin)\", then \"Uploaded.\" and the image."],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the test account login admin, upload works");
          const s = await ctx.freshSnapshot();
          const files = find.bucket(s, `${workerOf(ctx, PROD_STAGE)}-files`);
          ctx.observe("uploaded object", { check: "F-8", expected: "at least one object in the stage's files bucket", observed: Array.isArray(files?.objects) ? files.objects.length : files ? files.objects : "bucket absent", pass: Array.isArray(files?.objects) && files.objects.length >= 1 });
        },
      },
      {
        prompt: (ctx) => ({
          link: ctx.facts.appUrl,
          who: "primary", text: [`Press "Log in" and approve, and stay signed in for the next steps.`, "You should see \"Logged in as u_… (user)\"."],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "the primary account login user");
          const rows = await ctx.authDb();
          const users = rows.users.rows;
          const o = users.find((u) => u.email === ctx.facts.owner?.email);
          const t = users.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("test account login recorded", { check: "S13", expected: { email: ctx.facts.owner?.email, sub: ctx.facts.owner?.userId, role: "admin" }, observed: o ?? "absent", pass: o?.role === "admin" });
          ctx.observe("primary account login recorded", { check: "S13", expected: { email: ctx.facts.tester?.email, sub: ctx.facts.tester?.userId, role: "user" }, observed: t ?? "absent", pass: t?.role === "user" });
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
    title: "A role change takes effect at the next sign-in (DEC-0703, DEC-0791); the runner changes the role",
    expected: ["the runner changes the primary account login's role to exactly \"Administrator\" through the API (PUT …/members/<id>, DEC-0793) and waits the role-refresh interval (PAR-425, 300 s) plus a minute", "the primary account login's existing session stays user", "after signing out and in, the primary account login is admin (A-1 part b)", "the runner sets the original role back; a new sign-in gives user"],
    async run(ctx) {
      if (ctx.facts.roleChangedAt) return;
      const roles = await ctx.roles();
      const admin = roles.items.find((r) => r.name === "Administrator");
      if (!admin) throw new Error(`the test Cloudflare account offers no role "Administrator" (${roles.ok ? `${roles.items.length} roles listed` : roles.error})`);
      const r = await ctx.setMemberRoles(ctx.facts.tester?.memberId, [admin.id]);
      ctx.observe("role change", { check: "A-1", expected: "the primary account login's role set to Administrator", observed: r.ok ? { status: r.status, roles: r.roles } : r.error, pass: r.ok });
      const m = await eventually(ctx, (s) => {
        const x = find.member(s, ctx.facts.tester?.email);
        return x && same(x.roles, ["Administrator"]) ? x : undefined;
      });
      ctx.observe("primary account login's role", { check: "A-1", expected: ["Administrator"], observed: m?.roles ?? "unchanged", pass: m !== undefined });
      ctx.setFacts({ roleChangedAt: new Date().toISOString() });
    },
    owner: [
      {
        async before(ctx) {
          const left = Date.parse(ctx.facts.roleChangedAt) + ROLE_WAIT_SECONDS * 1000 - Date.now();
          if (left > 0) await ctx.wait(left, `the role-refresh interval (${ROLE_REFRESH_SECONDS} s) plus a minute`);
        },
        prompt: (ctx) => ({
          link: `${ctx.facts.appUrl}/api/auth/me`,
          who: "primary", text: [`Reload this page (the primary account login is still signed in to the app).`, `The runner changed the primary account login's role to Administrator more than ${Math.round(ROLE_REFRESH_SECONDS / 60) + 1} minutes ago; you should still see "level":"user", because a role change shows only at the next sign-in.`],
          reply: "the level shown: user or admin",
        }),
        async verify(ctx, answer) {
          const level = levelOf(answer);
          const waited = (Date.now() - Date.parse(ctx.facts.roleChangedAt)) / 1000;
          ctx.observe("existing session after the interval", { check: "S14", expected: "user", observed: { level, secondsSinceRoleChange: Math.round(waited) }, pass: level === "user" && waited >= ROLE_REFRESH_SECONDS ? true : level !== "user" ? false : null, note: waited < ROLE_REFRESH_SECONDS ? "answered before the interval had passed" : undefined });
          const t = (await ctx.authDb()).users.rows.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("auth app's recorded role", { check: "S14", expected: "user (recorded at the last sign-in)", observed: t?.role ?? "absent", pass: t?.role === "user" });
        },
      },
      {
        prompt: (ctx) => ({
          link: ctx.facts.appUrl,
          who: "primary", text: [`Press "Log out", then "Log in" and approve.`, "You should see \"Logged in as u_… (admin)\"."],
          reply: "the level shown: user or admin",
        }),
        async verify(ctx, answer) {
          const level = levelOf(answer);
          ctx.observe("after a new sign-in", { check: "A-1", expected: "admin (\"Administrator\" is an admin role, PAR-413)", observed: level, pass: level === "admin" });
          const t = (await ctx.authDb()).users.rows.find((u) => u.email === ctx.facts.tester?.email);
          ctx.observe("auth app's recorded role", { check: "A-1", expected: "admin", observed: t?.role ?? "absent", pass: t?.role === "admin" });
          const r = await ctx.setMemberRoles(ctx.facts.tester?.memberId, ctx.facts.tester?.roleIds ?? []);
          ctx.observe("role set back", { check: "S14", expected: ctx.facts.tester?.roles, observed: r.ok ? { status: r.status, roles: r.roles } : r.error, pass: r.ok });
          await eventually(ctx, (s) => {
            const x = find.member(s, ctx.facts.tester?.email);
            return x && same(x.roles, ctx.facts.tester?.roles ?? []) ? x : undefined;
          });
        },
      },
      {
        prompt: (ctx) => ({
          link: ctx.facts.appUrl,
          who: "primary", text: [`Press "Log out", then "Log in" again.`, `The runner has set the primary account login's role back to ${(ctx.facts.tester?.roles ?? []).join(", ") || "its first role"}; you should see "Logged in as u_… (user)".`],
          reply: "the level shown: user or admin",
        }),
        async verify(ctx, answer) {
          const level = levelOf(answer);
          ctx.observe("after the role is set back", { check: "S14", expected: "user", observed: level, pass: level === "user" });
          const m = find.member(await ctx.freshSnapshot(), ctx.facts.tester?.email);
          ctx.observe("primary account login's role restored", { check: "S14", expected: ctx.facts.tester?.roles, observed: m?.roles, pass: m !== undefined && same(m.roles, ctx.facts.tester?.roles ?? []) });
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
    expected: ["test account login: \"Log out\" → \"You are not logged in.\", /api/auth/me level anonymous, no __Host-session cookie", "admin app: \"Sign out\" → the sign-in page", "the Cloudflare dashboard session stays (no end_session, DEC-0660)"],
    owner: [
      {
        prompt: (ctx) => ({ link: ctx.facts.appUrl, who: "test", text: [`Press "Log out".`, "You should see \"You are not logged in.\"; the Cloudflare dashboard stays signed in."], reply: "ok" }),
        verify(ctx, answer) {
          replyCheck(ctx, answer, "signed out of the app");
        },
      },
      {
        prompt: (ctx) => ({ link: ctx.facts.adminUrl, who: "test", text: [`Press "Sign out" (sign in first if the admin app asks, then sign out).`, "You should see the admin app's sign-in page."], reply: "ok" }),
        verify(ctx, answer) {
          replyCheck(ctx, answer, "signed out of the admin app");
        },
      },
    ],
  },
  {
    id: "S16",
    session: 2,
    check: "E-4",
    title: "Page 3 again: registered app and recent sign-ins (E-4)",
    expected: ["Registered apps lists <app>-prodcheck → <APP>/api/auth/callback", "Recent sign-ins lists the test account login (admin) and the primary account login (user)", "both D1 sections show rows, not a warning"],
    owner: [
      {
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Sign in again, open "Status", press "Continue at Cloudflare" and approve.`, `You should see ${ctx.state.appName}-${PROD_STAGE} under Registered apps, and the test account login (admin) and the primary account login (user) under Recent sign-ins, with no warning.`],
          reply: "ok",
        }),
        async verify(ctx, answer) {
          replyCheck(ctx, answer, "both sections show rows");
          const rows = await ctx.authDb();
          ctx.observe("auth app database", { check: "E-4", expected: "the registry row and both logins", observed: { registry: rows.registry.rows, users: rows.users.rows.map((u) => ({ email: u.email, role: u.role })) }, pass: rows.registry.rows.length >= 1 && rows.users.rows.length >= 2 });
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
        prompt: (ctx) => ({
          link: ctx.facts.adminUrl,
          who: "test", text: [`Open "Everyday token", press "Continue at Cloudflare", keep every toggle ticked and approve.`, "The page says either that the existing everyday token was updated in place, or that a new one was created; if a new one was created, do NOT press \"I have saved the new token: delete the old one\" (it would delete the token the run uses)."],
          reply: "updated, or new",
        }),
        async verify(ctx, answer) {
          const s = await ctx.freshSnapshot();
          const all = find.tokens(s, EVERYDAY_NAME);
          const standIn = find.token(s, ctx.facts.u1TokenId);
          const extra = all.filter((t) => t.id !== ctx.facts.u1TokenId && t.id !== ctx.facts.everydayTokenId);
          const updated = standIn !== undefined && same(groupsOf(standIn), EVERYDAY_GROUPS);
          ctx.observe("owner reply", { check: "U1", expected: "updated or new", observed: answer, pass: /updated|new/i.test(answer) ? null : false });
          ctx.observe("U1 answer", { check: "U1", expected: "recorded: the stand-in updated to exactly the four groups (yes), or a new token (no)", observed: { standIn: standIn ? groupsOf(standIn) : "absent", newTokens: extra.map((t) => ({ id: t.id, groups: groupsOf(t) })) }, pass: updated || extra.length > 0 });
          ctx.observe("reply agrees with the API", { check: "U1", expected: updated ? "updated" : "new", observed: answer, pass: updated ? /updated/i.test(answer) : /new/i.test(answer) });
          await ctx.ensureEveryday();
          const v = await ctx.verify(ctx.secretValue(SECRET.everyday) ?? "");
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
    expected: ["all Workers logs of the run, the log bucket, the auth app's records and a final snapshot in the records bucket", "the records' bucket and prefix printed; the analysis and the cleanup use the owner's token, no new token"],
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
