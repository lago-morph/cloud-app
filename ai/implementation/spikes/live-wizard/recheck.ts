/**
 * The live pass's re-check on the fix-live code (2026-10-26), every call through the guarded layer:
 * 1. a fresh `prototype-compliance-wizard-everyday2` token from `EVERYDAY` (dashboard policies,
 *    110 minutes); `cloudflare-setup` with it alone, then with the environment token as the
 *    protected bootstrap stand-in (the real `frameworkVersion` passed this time);
 * 2. D3's correction: the setup record `framework/account.json` rewritten with `writeSetupRecord`,
 *    `frameworkVersion` set to the framework package's version and every other field as stored
 *    (`appliedAt` passed back as `now`), then read back and compared field by field.
 * It writes `recheck.json` (redacted, checked for every known secret), and, for exercise 6's
 * re-run (`run-cli.mjs`), the starter app's mode-600 `.env.cloudflare` and the runner's mode-600
 * secrets file. The token is deleted by `cleanup.ts`.
 *
 * Run: `NODE_USE_ENV_PROXY=1 LIVE_OUT=<dir> LIVE_APP=<app dir> node ai/implementation/spikes/live-wizard/run-live.mjs recheck.ts`.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cloudflareSetupCommand } from "../../../../packages/framework/src/cli/commands/cloudflare-setup.js";
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { EVERYDAY, type PermissionGroup, type TokenPolicy } from "../../../../packages/framework/src/provision/cloudflare/permissions.js";
import { parseSetupRecord, readAccountObject, writeSetupRecord } from "../../../../packages/framework/src/provision/cloudflare/setup-record.js";
import { startLivePass, WIZARD_TOKEN_PREFIX } from "./guarded-api.js";

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const envToken = env.CLOUDFLARE_API_TOKEN ?? "";
const out = env.LIVE_OUT ?? "";
const appDir = env.LIVE_APP ?? "";
if (out === "" || appDir === "") throw new Error("LIVE_OUT and LIVE_APP must be set");
const pass = await startLivePass({ accountId, envToken });
const api = pass.api;
const a = `/accounts/${accountId}`;
// The bundle has no package.json beside it, so the version is read as frameworkVersion() reads it, from the package's own file.
const version = (JSON.parse(readFileSync(join(env.COMPLIANCE_REPO_ROOT ?? process.cwd(), "packages/framework/package.json"), "utf8")) as { version: string }).version;

const secretValues: string[] = [envToken, accountId, ...pass.protectedTokenIds];
const addSecret = (value: string | undefined, replacement: string) => {
  if (value === undefined || value === "") return;
  secretValues.push(value);
  pass.addSecret(value, replacement);
};
const results: { id: string; exit?: number | undefined; calls: number; stdinRead?: boolean; lines: string[]; notes: string[] }[] = [];
const save = () => {
  const text = pass.redact(JSON.stringify({ calls: pass.calls().pass, stopReason: pass.stopReason() ?? null, results }, null, 2));
  for (const s of secretValues) if (s.length >= 4 && text.includes(s)) throw new Error("recheck: a secret survived redaction; nothing written");
  writeFileSync(join(out, env.LIVE_REUSE === "1" ? "recheck-reuse.json" : "recheck.json"), text);
};

class Done extends Error {}

async function setupRun(id: string, settings: Record<string, string>): Promise<void> {
  const e = { id, calls: pass.calls().pass, lines: [] as string[], notes: [] as string[], stdinRead: false, exit: undefined as number | undefined };
  results.push(e);
  const runEnv: Record<string, string | undefined> = { ...env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined, ...settings };
  for (const k of Object.keys(runEnv)) if (runEnv[k] === undefined) delete runEnv[k];
  let text = "";
  const stdin = {
    [Symbol.asyncIterator]() {
      e.stdinRead = true;
      return { next: async () => ({ done: true as const, value: undefined }) };
    },
  };
  const io = pass.redactingIo({ cwd: mkdtempSync(join(out, "proj-")), stdin, stdout: (t: string) => void (text += t), stderr: (t: string) => void (text += t) });
  const reach = async (url: string) => {
    const kind = url.includes("r2.cloudflarestorage.com") ? "R2 storage host" : url.includes(".workers.dev") ? "workers.dev subdomain" : "api.cloudflare.com";
    try {
      await pass.reach(url);
      e.notes.push(`network: ${kind}: reachable`);
    } catch (error) {
      e.notes.push(`network: ${kind}: not reachable`);
      throw error;
    }
  };
  const command = cloudflareSetupCommand({ env: runEnv, apiFor: pass.apiFor, reach, protectedTokenIds: pass.protectedTokenIds, localSetup: async () => [], frameworkVersion: version });
  e.exit = await command([], io);
  e.lines = pass.redact(text).split("\n").filter((l) => l.trim() !== "");
  e.calls = pass.calls().pass - e.calls;
  pass.print(`${id}: exit ${String(e.exit)}, calls ${String(e.calls)}, stdin read ${e.stdinRead ? "yes" : "no"}; ${e.notes.join("; ")}`);
}

try {
  const stored = await readAccountObject(api, accountId);
  const domain = typeof stored?.emailDomain === "string" ? stored.emailDomain : "";
  addSecret(resultOf<{ subdomain: string }>(await api("GET", `${a}/workers/subdomain`), "reading the subdomain").subdomain, "<subdomain>");
  const base = { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_EMAIL_DOMAIN: domain };

  // 1. A fresh everyday token.
  const groups: readonly PermissionGroup[] = EVERYDAY;
  const policies: TokenPolicy[] = [
    { effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: "*" }, permission_groups: groups.filter((g) => g.scope === "account").map((g) => ({ id: g.id })) },
    { effect: "allow", resources: { [`com.cloudflare.api.account.${accountId}`]: { "com.cloudflare.api.account.zone.*": "*" } }, permission_groups: groups.filter((g) => g.scope === "zone").map((g) => ({ id: g.id })) },
  ];
  const name = `${WIZARD_TOKEN_PREFIX}everyday2`;
  let token: { id: string; value: string };
  if (env.LIVE_REUSE === "1") {
    // A later process: the token this re-check made, from the app's .env.cloudflare (a fresh token can answer 401 for a short while).
    const value = /^CLOUDFLARE_API_TOKEN=(.+)$/m.exec(readFileSync(join(appDir, ".env.cloudflare"), "utf8"))?.[1] ?? "";
    addSecret(value, "<token-value>");
    const verified = resultOf<{ id: string; status: string }>(await pass.apiFor(value)("GET", `${a}/tokens/verify`), `verifying ${name}`);
    token = { id: verified.id, value };
    addSecret(token.id, "<token-id>");
    pass.print(`reusing ${name}: verify ${verified.status}`);
  } else {
    const created = await api("POST", `${a}/tokens`, { name, policies, expires_on: new Date(Date.now() + 110 * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z") });
    token = resultOf<{ id: string; value: string }>(created, `creating ${name}`);
    addSecret(token.value, "<token-value>");
    addSecret(token.id, "<token-id>");
    pass.print(`created ${name}: HTTP ${String(created.status)}, ${String(groups.length)} groups, 110 minutes`);
    writeFileSync(join(appDir, ".env.cloudflare"), `CLOUDFLARE_API_TOKEN=${token.value}\nCLOUDFLARE_ACCOUNT_ID=${accountId}\nCLOUDFLARE_EMAIL_DOMAIN=${domain}\n`, { mode: 0o600 });
    writeFileSync(join(out, "secrets.json"), JSON.stringify({ values: secretValues.filter((s) => s.length >= 4), protectedIds: pass.protectedTokenIds }), { mode: 0o600 });
  }

  await setupRun("R1a everyday2 alone", { ...base, CLOUDFLARE_API_TOKEN: token.value });
  await setupRun("R1b everyday2 + the protected bootstrap stand-in", { ...base, CLOUDFLARE_API_TOKEN: token.value, CLOUDFLARE_BOOTSTRAP_TOKEN: envToken });
  save();
  if (env.LIVE_REUSE === "1") throw new Done();

  // 2. D3: frameworkVersion corrected, every other field as stored.
  const before = await readAccountObject(api, accountId);
  const record = parseSetupRecord(before);
  if (before === undefined || record === undefined) throw new Error("the setup record could not be read");
  await writeSetupRecord(api, accountId, { emailDomain: record.emailDomain, completedSteps: record.completedSteps, setupVersion: record.setupVersion, frameworkVersion: version, now: () => new Date(record.appliedAt) }, true);
  const after = (await readAccountObject(api, accountId)) ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  const changed = keys.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  const d3 = `D3: frameworkVersion ${JSON.stringify(before.frameworkVersion)} -> ${JSON.stringify(after.frameworkVersion)}; fields compared ${String(keys.length)} (${keys.join(", ")}); changed: ${changed.join(", ") || "none"}`;
  results.push({ id: "R2 D3 record rewrite", calls: 0, lines: [], notes: [d3] });
  pass.print(d3);
} catch (error) {
  if (!(error instanceof Done)) {
    pass.print(`recheck stopped: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
    process.exitCode = 1;
  }
} finally {
  save();
  pass.print(`calls: ${String(pass.calls().pass)}; stop: ${pass.stopReason() ?? "none"}`);
}
