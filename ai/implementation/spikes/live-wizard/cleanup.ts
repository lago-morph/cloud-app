/**
 * The live wizard pass's cleanup and end-state proof, through the guarded layer:
 * - `pass.cleanup()`: every `prototype-compliance-wizard-*` token deleted, then the tokens listed
 *   again by name;
 * - the Worker scripts, R2 buckets and D1 databases by name, compared with preflight.md's baseline;
 * - with LIVE_EVIDENCE set to files (comma-separated), each searched for the real values this
 *   process knows (the environment token, the account ID, the protected token ID, the zone ID, the
 *   workers.dev subdomain, the account name) and any 32-hex ID: counts only are printed.
 * Writes `<LIVE_OUT>/cleanup.md` (redacted).
 *
 * Run: `NODE_USE_ENV_PROXY=1 LIVE_OUT=<dir> [LIVE_EVIDENCE=<files>] node ai/implementation/spikes/live-wizard/run-live.mjs cleanup.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { readAccountObject } from "../../../../packages/framework/src/provision/cloudflare/setup-record.js";
import { startLivePass, WIZARD_TOKEN_PREFIX } from "./guarded-api.js";

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const envToken = env.CLOUDFLARE_API_TOKEN ?? "";
const out = env.LIVE_OUT ?? "";
const lines: string[] = [];
const pass = await startLivePass({ accountId, envToken, log: (l) => (lines.push(l), process.stdout.write(`${l}\n`)) });
const a = `/accounts/${accountId}`;

const remaining = await pass.cleanup();

const scripts = resultOf<{ id: string }[]>(await pass.api("GET", `${a}/workers/scripts`), "listing the Worker scripts").map((s) => s.id).sort();
const buckets = (resultOf<{ buckets?: { name: string }[] }>(await pass.api("GET", `${a}/r2/buckets?per_page=1000`), "listing the R2 buckets").buckets ?? []).map((b) => b.name).sort();
const databases = resultOf<{ name: string }[]>(await pass.api("GET", `${a}/d1/database?per_page=100`), "listing the D1 databases").map((d) => d.name).sort();

// The baseline lists of preflight.md.
const preflight = readFileSync(join(env.COMPLIANCE_REPO_ROOT ?? process.cwd(), "ai/implementation/spikes/live-wizard/preflight.md"), "utf8");
const section = (title: string) => [...(preflight.split(`## ${title}`)[1]?.split("\n## ")[0] ?? "").matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1] ?? "").filter((n) => !n.includes(" / "));
const compare = (what: string, now: readonly string[], base: readonly string[]) => {
  const added = now.filter((n) => !base.includes(n));
  const gone = base.filter((n) => !now.includes(n));
  return `- ${what}: ${String(now.length)} now, ${String(base.length)} in the baseline; added: ${added.length === 0 ? "none" : added.join(", ")}; gone: ${gone.length === 0 ? "none" : gone.join(", ")}`;
};
const record = await readAccountObject(pass.api, accountId);

// The account name and zone, to search the evidence for them.
const accountName = resultOf<{ name: string }[]>(await pass.api("GET", "/accounts?per_page=50"), "listing accounts")[0]?.name ?? "";
const domain = typeof record?.emailDomain === "string" ? record.emailDomain : "";
const zoneId = resultOf<{ id: string }[]>(await pass.api("GET", `/zones?name=${encodeURIComponent(domain)}&account.id=${accountId}`), "reading the zone")[0]?.id ?? "";
const subdomain = resultOf<{ subdomain: string }>(await pass.api("GET", `${a}/workers/subdomain`), "reading the subdomain").subdomain;

const report = [
  "## Cleanup and end state",
  "",
  `- \`${WIZARD_TOKEN_PREFIX}*\` tokens still listed after the sweep: ${remaining.length === 0 ? "none" : remaining.join(", ")}`,
  ...lines.filter((l) => l.startsWith("cleanup: deleted")).map((l) => `- ${l}`),
  compare("Worker scripts", scripts, section("Worker scripts (baseline)")),
  compare("R2 buckets", buckets, section("R2 buckets (baseline)")),
  compare("D1 databases", databases, section("D1 databases (baseline)")),
  `- setup record: setupVersion ${JSON.stringify(record?.setupVersion)}, frameworkVersion ${JSON.stringify(record?.frameworkVersion)}, completedSteps ${String(Array.isArray(record?.completedSteps) ? record.completedSteps.length : 0)}`,
  `- calls used by this cleanup: ${String(pass.calls().pass)}`,
  "",
].join("\n");
const text = pass.redact(report);
writeFileSync(join(out, "cleanup.md"), text);
process.stdout.write(text);

for (const file of (env.LIVE_EVIDENCE ?? "").split(",").filter((f) => f !== "")) {
  const body = readFileSync(file, "utf8");
  const hits = [envToken, accountId, ...pass.protectedTokenIds, zoneId, subdomain, accountName].filter((v) => v.length >= 4).reduce((n, v) => n + (body.split(v).length - 1), 0);
  const hex = (body.match(/\b[0-9a-f]{32}\b/gi) ?? []).length;
  process.stdout.write(`evidence check ${file.split("/").pop() ?? ""}: real values found ${String(hits)}; 32-hex IDs found ${String(hex)}\n`);
}
