/**
 * The live wizard pass's read-only preflight: GET requests only, through the guarded layer, at
 * most `PREFLIGHT_CALL_LIMIT` calls. It records the baseline the pass must leave as it found it:
 * - the environment token: valid or not, and whether it has an expiry (never its ID);
 * - how many `prototype-compliance-wizard-*` tokens the account lists (expected 0);
 * - the Worker scripts, R2 buckets and D1 databases by name, and the stages they belong to
 *   (`<app>-<stage>`, names.ts), so that the end of the pass can be compared with it;
 * - whether the setup record `framework/account.json` exists in `sst-state`, and its `setupVersion`.
 * The report is redacted, checked for every known secret and any 32-hex ID, and only then written
 * to `preflight.md` next to this file.
 *
 * Run: `NODE_USE_ENV_PROXY=1 node ai/implementation/spikes/live-wizard/run-preflight.mjs`.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { ACCOUNT_WORKERS, STATE_BUCKET } from "../../../../packages/framework/src/provision/cloudflare/names.js";
import { readAccountObject } from "../../../../packages/framework/src/provision/cloudflare/setup-record.js";
import { ACCOUNT_SETTINGS_KEY } from "../../../../packages/framework/src/provision/cloudflare/account-settings.js";
import { listTestTokens, TEST_TOKEN_PREFIX } from "../../../../tests/compliance/harness/test-tokens.js";
import { startLivePass, WIZARD_TOKEN_PREFIX } from "./guarded-api.js";

export const PREFLIGHT_CALL_LIMIT = 49;

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const envToken = env.CLOUDFLARE_API_TOKEN ?? "";
const log: string[] = [];
const pass = await startLivePass({ accountId, envToken, limits: { perPass: PREFLIGHT_CALL_LIMIT }, log: (l) => log.push(l) });
const api = pass.api;
const a = `/accounts/${accountId}`;

const tokens = await listTestTokens((method, path, body) => api(method as "GET", path, body), accountId);
const wizardTokens = tokens.filter((t) => t.name.startsWith(WIZARD_TOKEN_PREFIX)).length;
const otherHarnessTokens = tokens.length - wizardTokens;

const scripts = resultOf<{ id: string }[]>(await api("GET", `${a}/workers/scripts`), "listing the Worker scripts")
  .map((s) => s.id)
  .sort();
const buckets = resultOf<{ buckets?: { name: string }[] }>(await api("GET", `${a}/r2/buckets?per_page=1000`), "listing the R2 buckets")
  .buckets?.map((b) => b.name)
  .sort() ?? [];
const databases = resultOf<{ name: string }[]>(await api("GET", `${a}/d1/database?per_page=100`), "listing the D1 databases")
  .map((d) => d.name)
  .sort();

// App names have no hyphens (PAR-290), so a stage Worker `<app>-<stage>` splits at its first hyphen.
const stages = scripts
  .filter((s) => !ACCOUNT_WORKERS.includes(s) && s.includes("-"))
  .map((s) => `${s.slice(0, s.indexOf("-"))} / ${s.slice(s.indexOf("-") + 1)}`);

const record = await readAccountObject(api, accountId);
const setupVersion = record?.setupVersion;

const list = (names: readonly string[]) => (names.length === 0 ? "- (none)" : names.map((n) => `- \`${n}\``).join("\n"));
const report = `# Live wizard pass: read-only preflight

Date: ${new Date().toISOString().slice(0, 10)}. Read-only: GET requests only, through the guarded layer
(\`guarded-api.ts\`); nothing was created, changed or deleted. Calls used: ${String(pass.calls().pass)} (limit ${String(PREFLIGHT_CALL_LIMIT)}).
Values that identify the account (token values and IDs, account ID, zone IDs, the \`workers.dev\`
subdomain) are redacted and were never printed.

## Environment token (\`CLOUDFLARE_API_TOKEN\`)
- Valid: ${pass.envTokenStatus.status === "active" ? "yes (status active)" : `no (status ${pass.envTokenStatus.status})`}
- Has an expiry: ${pass.envTokenStatus.hasExpiry ? "yes" : "no"}
- Its ID was read and is protected by the guard (not recorded here).

## Tokens
- \`${WIZARD_TOKEN_PREFIX}*\` tokens listed: ${String(wizardTokens)} (expected 0)
- Other \`${TEST_TOKEN_PREFIX}*\` or compliance hook tokens listed: ${String(otherHarnessTokens)}

## Worker scripts (baseline)
${list(scripts)}

Stages (app / stage, from the stage Workers \`<app>-<stage>\`; account Workers ${ACCOUNT_WORKERS.map((w) => `\`${w}\``).join(", ")} excluded):
${list(stages)}

## R2 buckets (baseline)
${list(buckets)}

## D1 databases (baseline)
${list(databases)}

## Setup record (\`${ACCOUNT_SETTINGS_KEY}\` in \`${STATE_BUCKET}\`)
- Exists: ${record === undefined ? "no" : "yes"}
- \`setupVersion\`: ${record === undefined ? "n/a" : setupVersion === undefined ? "absent (a record from before the setup fields)" : JSON.stringify(setupVersion)}

## Owner's end condition
Only the existing \`prodcheck\` and demo stages must remain at the end of the pass; compare the lists above with the pass's end state.
`;

const out = pass.redact(report);
// Belt and braces: nothing secret, and no 32-hex ID, may reach the file.
for (const secret of [envToken, accountId, ...pass.protectedTokenIds]) if (secret !== "" && out.includes(secret)) throw new Error("preflight: a secret survived redaction; nothing written");
if (/\b[0-9a-f]{32}\b/i.test(out) || /\.[a-z0-9-]+\.workers\.dev/i.test(out.replace(/<subdomain>\.workers\.dev/g, ""))) throw new Error("preflight: an ID or subdomain survived redaction; nothing written");
writeFileSync(join(env.COMPLIANCE_REPO_ROOT ?? process.cwd(), "ai/implementation/spikes/live-wizard/preflight.md"), out);
for (const line of log) process.stdout.write(`${line}\n`);
process.stdout.write(pass.redact(`preflight: written (calls ${String(pass.calls().pass)}; wizard tokens ${String(wizardTokens)}; scripts ${String(scripts.length)}; setup record ${record === undefined ? "absent" : "present"})\n`));
