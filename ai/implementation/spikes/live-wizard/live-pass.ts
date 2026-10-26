/**
 * The live wizard pass, exercises 1 to 5 (plan-setup-wizard §6 "Live, in a milestone pass";
 * SETUP-AC-011), in one process, every Cloudflare call through the guarded layer
 * (`guarded-api.ts`): the framework's `cloudflare-setup` command runs in-process with the layer's
 * `apiFor`, `reach`, `protectedTokenIds` and `redactingIo`.
 *
 * 1. the everyday token `prototype-compliance-wizard-everyday` made through the API from
 *    `EVERYDAY` (the dashboard link's policies: account groups on the account, zone groups on all
 *    its zones), 2 h expiry;
 * 2. the state machine: everyday alone (why it is not "nothing to do"), then everyday plus the
 *    environment token as the protected bootstrap stand-in, then everyday alone again;
 * 3. `prototype-compliance-wizard-short` (EVERYDAY minus "Email Routing Rules Read"), restored in place;
 * 4. bad pastes; 5. the network step's hosts.
 *
 * It writes `results.json` (redacted, checked for every known secret) and, for the CLI exercises
 * (6, 7) that follow in other processes, a mode-600 `.env.cloudflare` in the starter app and a
 * mode-600 secrets file the redacting runner reads; both sit outside the repository and are deleted
 * by the cleanup. Tokens are not deleted here: the everyday token is used by exercises 6 and 7, and
 * `cleanup.ts` deletes every `prototype-compliance-wizard-*` token.
 *
 * Run: `NODE_USE_ENV_PROXY=1 LIVE_OUT=<dir> LIVE_APP=<app dir> node ai/implementation/spikes/live-wizard/run-live.mjs live-pass.ts`.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloudflareSetupCommand } from "../../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { deepLink, EVERYDAY, type PermissionGroup, type TokenPolicy } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { readAccountObject } from "../../../../packages/framework/src/provision/cloudflare/setup-record.js";
import { startLivePass, WIZARD_TOKEN_PREFIX, type LivePass } from "./guarded-api.js";

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const envToken = env.CLOUDFLARE_API_TOKEN ?? "";
const out = env.LIVE_OUT ?? "";
const appDir = env.LIVE_APP ?? "";
/** A: the context, exercise 1 and 2a (whose missing steps are read before going on); B: the rest. */
const stage = env.LIVE_STAGE === "B" ? "B" : "A";
if (out === "" || appDir === "") throw new Error("LIVE_OUT and LIVE_APP must be set");
mkdirSync(out, { recursive: true });

const progress: string[] = [];
const pass: LivePass = await startLivePass({ accountId, envToken, log: (l) => (progress.push(l), process.stdout.write(`${l}\n`)) });
const api = pass.api;
const a = `/accounts/${accountId}`;

interface Entry {
  readonly id: string;
  readonly what: string;
  exit?: number;
  calls: number;
  stdinRead?: boolean;
  lines: string[];
  notes: string[];
}
const entries: Entry[] = [];
const begin = (id: string, what: string): Entry => {
  const e: Entry = { id, what, calls: pass.calls().pass, lines: [], notes: [] };
  entries.push(e);
  pass.print(`== ${id}: ${what}`);
  return e;
};
const end = (e: Entry) => {
  e.calls = pass.calls().pass - e.calls;
  pass.print(`   ${e.id}: exit ${String(e.exit ?? "-")}, calls ${String(e.calls)}`);
};
const note = (e: Entry, text: string) => {
  e.notes.push(pass.redact(text));
  pass.print(`   ${text}`);
};
const save = () => {
  const text = pass.redact(JSON.stringify({ calls: pass.calls().pass, stopReason: pass.stopReason() ?? null, entries }, null, 2));
  for (const s of secrets()) if (text.includes(s)) throw new Error("live pass: a secret survived redaction; results not written");
  writeFileSync(join(out, `results-${stage}.json`), text);
};
const secretValues: string[] = [envToken, accountId, ...pass.protectedTokenIds];
const secrets = () => secretValues.filter((s) => s.length >= 4);
const addSecret = (value: string | undefined, replacement: string) => {
  if (value === undefined || value === "") return;
  secretValues.push(value);
  pass.addSecret(value, replacement);
};

const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const names = (groups: readonly { name?: string; id: string }[]) => groups.map((g) => g.name ?? EVERYDAY.find((e) => e.id === g.id)?.name ?? "(unknown group)");
const dashboardPolicies = (groups: readonly PermissionGroup[]): TokenPolicy[] => [
  { effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: "*" }, permission_groups: groups.filter((g) => g.scope === "account").map((g) => ({ id: g.id })) },
  { effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: groups.filter((g) => g.scope === "zone").map((g) => ({ id: g.id })) },
];

class StageDone extends Error {}

interface Made {
  readonly name: string;
  readonly id: string;
  readonly value: string;
}
async function makeToken(e: Entry, suffix: string, groups: readonly PermissionGroup[]): Promise<Made> {
  const name = `${WIZARD_TOKEN_PREFIX}${suffix}`;
  const r = await api("POST", `${a}/tokens`, { name, policies: dashboardPolicies(groups), expires_on: isoIn(110 * 60_000) });
  const t = resultOf<{ id: string; value: string }>(r, `creating ${name}`);
  addSecret(t.value, "<token-value>");
  addSecret(t.id, "<token-id>");
  note(e, `created ${name}: HTTP ${String(r.status)}, ${String(groups.length)} groups, expires in 110 minutes`);
  return { name, id: t.id, value: t.value };
}

/** The token's policies as `GET …/tokens/<id>` lists them, with the environment token. */
async function details(id: string): Promise<{ name: string; expires_on?: string; policies: TokenPolicy[] }> {
  return resultOf(await api("GET", `${a}/tokens/${id}`), "reading a wizard token");
}
const describePolicies = (ps: readonly TokenPolicy[]) =>
  ps
    .map((p) => {
      const keys = Object.keys(p.resources).map((k) => {
        const v = p.resources[k];
        const sub = typeof v === "object" && v !== null ? `{${Object.keys(v).join(",")}}` : String(v);
        return `${k}=${sub}`;
      });
      const meta = p.permission_groups.filter((g) => g.meta !== undefined && g.meta !== null).length;
      return `${p.effect} [${names(p.permission_groups).join(", ")}] on ${keys.join("; ")} (groups with meta: ${String(meta)})`;
    })
    .join(" | ");

/** One in-process `cloudflare-setup` run through the guarded layer. */
async function setupRun(e: Entry, settings: Record<string, string | undefined>, options: { args?: string[]; reach?: (url: string) => Promise<void> } = {}): Promise<string> {
  const projectDir = mkdtempSync(join(out, "proj-"));
  const runEnv: Record<string, string | undefined> = { ...env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined, CLOUDFLARE_BOOTSTRAP_TOKEN: undefined, CLOUDFLARE_EMAIL_DOMAIN: undefined, ...settings };
  for (const k of Object.keys(runEnv)) if (runEnv[k] === undefined) delete runEnv[k];
  let text = "";
  e.stdinRead = false;
  const stdin = {
    [Symbol.asyncIterator]() {
      e.stdinRead = true;
      return { next: async () => ({ done: true as const, value: undefined }) };
    },
  };
  const io = pass.redactingIo({ cwd: projectDir, stdin, stdout: (t: string) => void (text += t), stderr: (t: string) => void (text += t) });
  const reached: string[] = [];
  const reach = async (url: string) => {
    const kind = url.includes("r2.cloudflarestorage.com") ? "R2 storage host" : url.includes(".workers.dev") ? "workers.dev subdomain" : "api.cloudflare.com";
    try {
      await (options.reach ?? pass.reach)(url);
      reached.push(`${kind}: reachable`);
    } catch (error) {
      reached.push(`${kind}: not reachable (${error instanceof Error ? error.name : "error"})`);
      throw error;
    }
  };
  const command = cloudflareSetupCommand({ env: runEnv, apiFor: pass.apiFor, reach, protectedTokenIds: pass.protectedTokenIds, localSetup: async () => [] });
  e.exit = await command(options.args ?? [], io);
  e.lines = pass.redact(text).split("\n").filter((l) => l.trim() !== "");
  for (const r of reached) note(e, `network: ${r}`);
  const everydayLinks = text.split(deepLink("everyday")).length - 1;
  const bootstrapLinks = text.split(deepLink("bootstrap")).length - 1;
  note(e, `links printed: everyday ${String(everydayLinks)}, bootstrap ${String(bootstrapLinks)}; standard input read: ${e.stdinRead ? "yes" : "no"}`);
  return text;
}

try {
  // Read-only context: the email domain from the record, the zone, the accounts the environment token sees.
  const record = await readAccountObject(api, accountId);
  const domain = typeof record?.emailDomain === "string" ? record.emailDomain : "";
  if (domain === "") throw new Error("the account record names no email domain");
  const zones = resultOf<{ id: string; name: string }[]>(await api("GET", `/zones?name=${encodeURIComponent(domain)}&account.id=${accountId}`), "reading the zone");
  const zoneId = zones[0]?.id ?? "";
  addSecret(zoneId, "<zone-id>");
  const subdomain = resultOf<{ subdomain: string }>(await api("GET", `${a}/workers/subdomain`), "reading the subdomain").subdomain;
  addSecret(subdomain, "<subdomain>");
  const accounts = resultOf<unknown[]>(await api("GET", "/accounts?per_page=50"), "listing accounts").length;
  pass.print(`context: email domain ${domain}; record setupVersion ${record?.setupVersion === undefined ? "absent" : JSON.stringify(record.setupVersion)}; accounts visible to the environment token: ${String(accounts)}`);
  const base = { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_EMAIL_DOMAIN: domain };

  let everyday: Made;
  if (stage === "A") {
    // 1. The everyday token from the permission list.
    const e1 = begin("1", "everyday token from EVERYDAY (dashboard policies, 2 h)");
    everyday = await makeToken(e1, "everyday", EVERYDAY);
    const d0 = await details(everyday.id);
    note(e1, `policies: ${describePolicies(d0.policies)}`);
    const v1 = resultOf<{ status: string }>(await pass.apiFor(everyday.value)("GET", `${a}/tokens/verify`), "verifying the everyday token");
    note(e1, `verify with its own value: ${v1.status}`);
    e1.exit = 0;
    end(e1);
    save();

    // The CLI exercises' inputs: the starter app's .env.cloudflare and the runner's secrets (mode 600, outside the repository).
    writeFileSync(join(appDir, ".env.cloudflare"), `CLOUDFLARE_API_TOKEN=${everyday.value}\nCLOUDFLARE_ACCOUNT_ID=${accountId}\nCLOUDFLARE_EMAIL_DOMAIN=${domain}\n`, { mode: 0o600 });
    writeFileSync(join(out, "secrets.json"), JSON.stringify({ values: secrets(), protectedIds: pass.protectedTokenIds }), { mode: 0o600 });

    // 2. The state machine on the real account: first the everyday token alone, to read why it is not "nothing to do".
    const e2a = begin("2a", "everyday token alone, before the bootstrap run (why not 'nothing to do')");
    await setupRun(e2a, { ...base, CLOUDFLARE_API_TOKEN: everyday.value });
    end(e2a);
    save();
    throw new StageDone();
  }
  // Stage B: the everyday token as exercises 6 and 7 read it, from the app's .env.cloudflare.
  const value = /^CLOUDFLARE_API_TOKEN=(.+)$/m.exec(readFileSync(join(appDir, ".env.cloudflare"), "utf8"))?.[1] ?? "";
  addSecret(value, "<token-value>");
  const verified = resultOf<{ id: string }>(await pass.apiFor(value)("GET", `${a}/tokens/verify`), "verifying the everyday token");
  addSecret(verified.id, "<token-id>");
  everyday = { name: `${WIZARD_TOKEN_PREFIX}everyday`, id: verified.id, value };
  const d1 = await details(everyday.id);

  const e2b = begin("2b", "everyday token + the environment token as the protected bootstrap stand-in");
  await setupRun(e2b, { ...base, CLOUDFLARE_API_TOKEN: everyday.value, CLOUDFLARE_BOOTSTRAP_TOKEN: envToken });
  const after2b = await readAccountObject(api, accountId);
  note(e2b, `record after: setupVersion ${JSON.stringify(after2b?.setupVersion)}, frameworkVersion ${JSON.stringify(after2b?.frameworkVersion)}, completedSteps ${String(Array.isArray(after2b?.completedSteps) ? after2b.completedSteps.length : 0)}`);
  const d2 = await details(everyday.id);
  note(e2b, `everyday token after: ${d2.policies.length === d1.policies.length ? "policies unchanged (no PUT)" : "policies changed"}`);
  end(e2b);
  save();
  const e2c = begin("2c", "everyday token alone, again");
  await setupRun(e2c, { ...base, CLOUDFLARE_API_TOKEN: everyday.value });
  end(e2c);
  save();

  // 5 (cont.). Whether a blocked host would be named: the same run with the workers.dev host made unreachable (no request sent for it).
  const e5 = begin("5", "everyday alone, the workers.dev host made unreachable in-process");
  await setupRun(e5, { ...base, CLOUDFLARE_API_TOKEN: everyday.value }, { reach: async (url) => (url.includes(".workers.dev") ? Promise.reject(new Error("blocked")) : pass.reach(url)) });
  end(e5);
  save();

  // 3. The exact check and the in-place update.
  const e3 = begin("3", "EVERYDAY minus Email Routing Rules Read, restored in place");
  const missing = EVERYDAY.find((g) => g.name === "Email Routing Rules Read");
  if (missing === undefined) throw new Error("internal: no Email Routing Rules Read in EVERYDAY");
  const short = await makeToken(e3, "short", EVERYDAY.filter((g) => g !== missing));
  const before = await details(short.id);
  note(e3, `before: ${describePolicies(before.policies)}`);
  const shortApi = pass.apiFor(short.value);
  const rulesPath = `/zones/${zoneId}/email/routing/rules?per_page=1`;
  note(e3, `before: GET email routing rules with the short token: HTTP ${String((await shortApi("GET", rulesPath)).status)}`);
  await setupRun(e3, { ...base, CLOUDFLARE_API_TOKEN: short.value, CLOUDFLARE_BOOTSTRAP_TOKEN: envToken });
  const after = await details(short.id);
  note(e3, `after: ${describePolicies(after.policies)}`);
  note(e3, `after: name ${after.name === before.name ? "kept" : "changed"}, expires_on ${after.expires_on === before.expires_on ? "kept" : "changed"}`);
  const keptMeta = before.policies.every((p) => {
    const q = after.policies.find((x) => x.id === p.id);
    return q !== undefined && JSON.stringify(p.permission_groups.map((g) => g.meta ?? null)) === JSON.stringify(q.permission_groups.map((g) => g.meta ?? null)) && JSON.stringify(p.resources) === JSON.stringify(q.resources);
  });
  note(e3, `after: earlier policies kept with the same IDs, resources and group meta: ${keptMeta ? "yes" : "no"}`);
  const added = after.policies.filter((p) => !before.policies.some((b) => b.id === p.id));
  note(e3, `added policy resources use the top-level zone form com.cloudflare.api.account.zone.<zone>: ${added.some((p) => Object.keys(p.resources).some((k) => k === `com.cloudflare.api.account.zone.${zoneId}` && p.resources[k] === "*")) ? "yes" : "no"}`);
  note(e3, `after: GET email routing rules with the same short token value: HTTP ${String((await shortApi("GET", rulesPath)).status)}`);
  note(e3, `after: verify with the same value: ${resultOf<{ status: string }>(await shortApi("GET", `${a}/tokens/verify`), "verifying the short token").status}`);
  end(e3);
  save();

  // 4. Bad pastes.
  const e4a = begin("4a", "a garbage string as CLOUDFLARE_API_TOKEN");
  await setupRun(e4a, { ...base, CLOUDFLARE_API_TOKEN: "not-a-token-just-some-pasted-text" });
  end(e4a);
  const e4b = begin("4b", "an everyday token pasted as the bootstrap (the short token, now complete, as CLOUDFLARE_BOOTSTRAP_TOKEN)");
  await setupRun(e4b, { ...base, CLOUDFLARE_API_TOKEN: everyday.value, CLOUDFLARE_BOOTSTRAP_TOKEN: short.value });
  end(e4b);
  const e4c = begin("4c", "the same everyday token in both slots (a valid token in the wrong slot)");
  await setupRun(e4c, { ...base, CLOUDFLARE_API_TOKEN: everyday.value, CLOUDFLARE_BOOTSTRAP_TOKEN: everyday.value });
  note(e4c, `a token of another account: not feasible (the environment token sees ${String(accounts)} account${accounts === 1 ? "" : "s"})`);
  end(e4c);

  // The short token is done with; the everyday token stays for exercises 6 and 7.
  const del = await api("DELETE", `${a}/tokens/${short.id}`);
  pass.print(`deleted ${short.name}: HTTP ${String(del.status)}`);
} catch (error) {
  if (error instanceof StageDone) pass.print("stage A done");
  else {
    pass.print(`live pass stopped with an error: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  save();
  pass.print(`calls: ${String(pass.calls().pass)}; stop: ${pass.stopReason() ?? "none"}`);
}
