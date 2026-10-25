/**
 * The deny list of platform SDKs, database drivers and query tooling (check.md §2
 * `allowed-imports`; DEC-0180, DEC-0554). Plain data, Node-free: the import rule, the installed
 * dependency tree check (`check/dependencies.ts`) and the Worker bundle inspection
 * (`build/inspect.ts`) share it.
 */
/** Package-name patterns of platform SDKs, database drivers and query tooling. */
export const DENIED_PACKAGES: readonly RegExp[] = [
  /^@cloudflare\//, /^wrangler$/, /^miniflare$/, /^@aws-sdk\//, /^aws-sdk$/, /^aws-lambda$/, /^@aws-lambda-powertools\//,
  /^@smithy\//, /^sst$/, /^@pulumi\//, /^@vercel\//, /^@netlify\//, /^@google-cloud\//, /^@azure\//, /^firebase-admin$/,
  /^@electric-sql\/pglite/, /^pg$/, /^pg-/, /^postgres$/, /^mysql2?$/, /^better-sqlite3$/, /^sqlite3?$/, /^@libsql\//,
  /^@neondatabase\//, /^@planetscale\//, /^drizzle-kit$/, /^mongodb$/, /^redis$/, /^ioredis$/, /^@prisma\//, /^prisma$/,
  /^kysely$/, /^knex$/, /^typeorm$/, /^sequelize$/, /^@hono\/node-server$/, /^cloudflare$/, /^googleapis$/,
];

/**
 * Whether a package name is a platform SDK, database driver or query tool: the deny list the
 * import rule, the installed dependency tree check (`check/dependencies.ts`) and the Worker
 * bundle inspection (`build/inspect.ts`) share (DEC-0180, DEC-0554).
 */
export function isDeniedPackage(name: string): boolean {
  return DENIED_PACKAGES.some((re) => re.test(name));
}
