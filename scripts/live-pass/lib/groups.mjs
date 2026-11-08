// The owner token's permission groups (live-pass-owner, DEC-0793), and how a token's groups are
// matched against them. The API names groups "… Write" where the dashboard shows "… Edit"; matching
// ignores that and case.
//
// The owner makes this one token in the test Cloudflare account's dashboard. It holds every group the
// runner uses directly: snapshots and cleanup of every resource kind the run makes, the records bucket,
// Workers Logs, the runner's own probe tokens, the roll of the everyday token's value, and the
// primary account login's invitation and role change (Account Settings Write). It cannot stand in for a starter
// token: Cloudflare refuses to let an API-made token hold "Account API Tokens Write" (code 1001,
// "sub-token is not allowed to have permissions to manage other tokens", seen again on 2026-11-08),
// so the starter tokens are made in the dashboard too.

/** The owner token's groups (API names), and Cloudflare's IDs for them (GET …/tokens/permission_groups, 2026-11-08). */
export const OWNER_GROUP_IDS = {
  "Account API Tokens Write": "5bc3f8b21c554832afc660159ab75fa4",
  "Account Settings Write": "1af1fa2adc104452b74a9a3364202f20",
  "D1 Write": "09b2857d1c31407795e75e3fed8617a1",
  "OAuth Client Write": "50fc2f43318f40e4855a35d8de5bf643",
  "Secrets Store Write": "adc8fa2bc6124928a8b3314dc63a1235",
  "Workers Observability Write": "82c075da3f4647a2a03becd0fe240f8a",
  "Workers R2 Storage Write": "bf7481a1826f439697cb59a20b22293e",
  "Workers Scripts Write": "e086da7e2179491d91ee5f35b3ca210a",
};
export const OWNER_GROUPS = Object.keys(OWNER_GROUP_IDS);
export const OWNER_TOKEN_NAME = "live-pass-owner";

/** Groups the runner can do without: only the Workers Logs collection needs this one. */
export const OPTIONAL_OWNER_GROUPS = ["Workers Observability Write"];

/** A group name's matching key: lower case, "edit" read as "write". */
export const groupKey = (name) => name.trim().toLowerCase().replace(/ edit$/, " write");

/** The owner groups a token's group names do not cover (a Write group covers its Read group, never the reverse). */
export function missingGroups(held) {
  const keys = new Set(held.map(groupKey));
  const covered = (g) => keys.has(groupKey(g)) || (g.endsWith(" Read") && keys.has(groupKey(g.replace(/ Read$/, " Write"))));
  const missing = OWNER_GROUPS.filter((g) => !covered(g));
  return { required: missing.filter((g) => !OPTIONAL_OWNER_GROUPS.includes(g)), optional: missing.filter((g) => OPTIONAL_OWNER_GROUPS.includes(g)) };
}

/**
 * The dashboard's account token template (DEC-0563's link form: group IDs as keys, which the owner
 * checked on 2026-10-26), pre-filled with the owner token's eight groups and its name. The page sets
 * no account and no expiry: the owner picks those.
 */
export function ownerTokenLink() {
  const keys = OWNER_GROUPS.map((g) => ({ key: OWNER_GROUP_IDS[g], type: "edit" }));
  return `https://dash.cloudflare.com/?to=/:account/api-tokens&permissionGroupKeys=${encodeURIComponent(JSON.stringify(keys))}&name=${OWNER_TOKEN_NAME}`;
}
