// The admin token's permission groups, and how a token's groups are matched against them.
// The API names groups "… Write" where the dashboard shows "… Edit"; matching ignores that and case.

/** The admin token's groups (API names). The final analysis token holds the same eight. */
export const ADMIN_GROUPS = [
  "Account API Tokens Write",
  "Account Settings Read",
  "D1 Write",
  "OAuth Client Write",
  "Secrets Store Write",
  "Workers Observability Write",
  "Workers R2 Storage Write",
  "Workers Scripts Write",
];

/** Groups the runner can do without: only the Workers Logs collection needs this one. */
export const OPTIONAL_ADMIN_GROUPS = ["Workers Observability Write"];

/** A group name's matching key: lower case, "edit" read as "write". */
export const groupKey = (name) => name.trim().toLowerCase().replace(/ edit$/, " write");

/** The admin groups a token's group names do not cover (a Write group covers its Read group). */
export function missingGroups(held) {
  const keys = new Set(held.map(groupKey));
  const covered = (g) => keys.has(groupKey(g)) || (g.endsWith(" Read") && keys.has(groupKey(g.replace(/ Read$/, " Write"))));
  const missing = ADMIN_GROUPS.filter((g) => !covered(g));
  return { required: missing.filter((g) => !OPTIONAL_ADMIN_GROUPS.includes(g)), optional: missing.filter((g) => OPTIONAL_ADMIN_GROUPS.includes(g)) };
}
