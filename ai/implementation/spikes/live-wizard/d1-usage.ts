/**
 * Exercise 7's D1 budget check (≤ 100k rows written, ≤ 5M rows read per pass): the rows read and
 * written today on the D1 databases whose names start with LIVE_D1_PREFIX, from GraphQL Analytics
 * (`d1AnalyticsAdaptiveGroups`), read through the guarded layer. Prints names and sums only.
 *
 * Run: `NODE_USE_ENV_PROXY=1 LIVE_D1_PREFIX=wizapp-test-wizard node ai/implementation/spikes/live-wizard/run-live.mjs d1-usage.ts`.
 */
import { resultOf } from "../../../../packages/framework/src/provision/cloudflare/api.js";
import { startLivePass } from "./guarded-api.js";

const env = process.env;
const accountId = env.CLOUDFLARE_ACCOUNT_ID ?? "";
const prefix = env.LIVE_D1_PREFIX ?? "";
if (prefix === "") throw new Error("LIVE_D1_PREFIX must be set");
const pass = await startLivePass({ accountId, envToken: env.CLOUDFLARE_API_TOKEN ?? "", limits: { perPass: 10 } });
const dbs = resultOf<{ uuid: string; name: string }[]>(await pass.api("GET", `/accounts/${accountId}/d1/database?per_page=100`), "listing D1").filter((d) => d.name.startsWith(prefix));
const since = new Date(Date.now() - 24 * 3_600_000).toISOString().slice(0, 10);
const query = `query D1Usage($accountTag: string, $since: Date, $ids: [string]) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 100, filter: { date_geq: $since, databaseId_in: $ids }) { sum { rowsRead rowsWritten } dimensions { databaseId } }
  } }
}`;
const r = await pass.api("POST", "/graphql", { query, variables: { accountTag: accountId, since, ids: dbs.map((d) => d.uuid) } });
const body = r.body as { data?: { viewer?: { accounts?: { d1AnalyticsAdaptiveGroups?: { sum: { rowsRead: number; rowsWritten: number }; dimensions: { databaseId: string } }[] }[] } }; errors?: { message: string }[] } | null;
const groups = body?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups ?? [];
for (const d of dbs) {
  const sums = groups.filter((g) => g.dimensions.databaseId === d.uuid).reduce((s, g) => ({ read: s.read + g.sum.rowsRead, written: s.written + g.sum.rowsWritten }), { read: 0, written: 0 });
  pass.print(`${d.name}: rows read ${String(sums.read)}, rows written ${String(sums.written)} (since ${since}; analytics may lag a few minutes)`);
}
if (dbs.length === 0) pass.print(`no D1 database named ${prefix}*`);
if (body?.errors?.length) pass.print(`GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
pass.print(`calls: ${String(pass.calls().pass)}`);
