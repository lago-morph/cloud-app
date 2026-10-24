/**
 * Inspection of the AWS Lambda bundle at build time (CORE-REQ-006, PROV-REQ-005; plan-aws G-06;
 * DEC-0474). It mirrors the Cloudflare bundle inspection (DEC-0240): modules are
 * recognised by the paths esbuild reports and by strings that survive minification. The build
 * fails before anything is deployed when the bundle:
 * - leaves anything but a Node built-in external: the AWS SDK and every other package are
 *   bundled, never taken from the managed runtime (DEC-0432);
 * - holds a Cloudflare-only module (Workers adapters, Wrangler, Miniflare, `cloudflare:`
 *   imports), provisioning (SST, Pulumi, `provision/`), a CLI-only AWS SDK client, the Postgres
 *   harness, the stub login provider or test helpers, the local file-transfer route or its
 *   ticket key, or tooling;
 * - is a production bundle and holds the authentication mock or its mock-login route;
 * - contains a secret value the build process can see (`SECRET_*` and AWS credential variables,
 *   the app's `.dev.vars`) or an AWS access key ID;
 * - is larger than the bundle size bound (PAR-276, DEC-0474).
 * The caller reads the bundle and the secret values; this module only compares.
 */

import { builtinModules } from "node:module";

/** The AWS Lambda bundle size bound in bytes (PAR-276, DEC-0474): 4 MiB minified. */
export const AWS_BUNDLE_MAX_BYTES = 4 * 1024 * 1024;

/** Secret values shorter than this are not searched for (they would match by chance). */
export const MIN_SECRET_LENGTH = 8;

export interface ForbiddenRule {
  /** What the matched module or string is, as a violation names it. */
  readonly what: string;
  /** Matched against each bundled module's path (as esbuild reports it, `/` separators). */
  readonly modules?: readonly RegExp[];
  /** Matched against the bundle's text. */
  readonly text?: readonly RegExp[];
  /** Applies to production bundles only. */
  readonly productionOnly?: boolean;
}

const SPECIFIER = (names: string): RegExp => new RegExp(`(?:from\\s*|import\\s*|require\\(\\s*|import\\(\\s*)["'](?:${names})["']`);
/** The framework's own modules: its sources in this repository, or its installed `dist/` (never the app's `src/`). */
const FRAMEWORK = "(?:^|/)(?:packages/framework|@lago-morph/prototype-framework)/(?:src|dist)/";

/** CLI or provisioning only (DEC-0432): the HTTP Lambda carries rds-data, s3 and ssm. */
export const CLI_ONLY_AWS_CLIENTS = ["ec2", "iam", "rds", "sts", "secrets-manager", "lambda", "resource-groups-tagging-api"] as const;

export const AWS_BUNDLE_RULES: readonly ForbiddenRule[] = [
  {
    what: "Cloudflare-only module",
    modules: [new RegExp(`${FRAMEWORK}(?:[a-z-]+/)*cloudflare/`), /node_modules\/(?:wrangler|miniflare|@cloudflare\/[^/]+|workerd)\//],
    text: [SPECIFIER("cloudflare:[a-z-]+"), /\bR2Bucket\b/, /\bD1Database\b/],
  },
  {
    what: "provisioning",
    modules: [new RegExp(`${FRAMEWORK}provision/`), /node_modules\/(?:sst|@pulumi\/[^/]+|pulumi)\//],
    text: [/@pulumi/, SPECIFIER("sst(?:/[^\"']*)?"), /prototype-framework\/provision/, /setupAccount/, /listStageResources/],
  },
  {
    what: "CLI-only AWS SDK client",
    modules: [new RegExp(`node_modules/@aws-sdk/client-(?:${CLI_ONLY_AWS_CLIENTS.join("|")})/`)],
  },
  {
    what: "Postgres harness",
    modules: [/node_modules\/@electric-sql\//, /node_modules\/drizzle-orm\/pglite\//, new RegExp(`${FRAMEWORK}sql/postgres\\.`)],
    text: [/pglite/i, /electric-sql/],
  },
  {
    what: "stub login provider or test helpers",
    modules: [new RegExp(`${FRAMEWORK}auth/stub-provider\\.`), new RegExp(`${FRAMEWORK}testing/`), /\.test-support\./],
    text: [/stubLoginProvider|loginWithStub|stubFailure/],
  },
  {
    what: "local file-transfer route or its ticket key",
    modules: [new RegExp(`${FRAMEWORK}files/local/`)],
    text: [/__framework\/files/, /ticket[_-]?key/i, /SECRET_[A-Z0-9_]*TICKET/],
  },
  {
    what: "tooling",
    modules: [/node_modules\/(?:eslint|typescript|@typescript-eslint|typescript-eslint|drizzle-kit|vite|vitest|esbuild)\//],
    text: [SPECIFIER("eslint|typescript|typescript-eslint|drizzle-kit|wrangler|vite|vitest|esbuild|miniflare")],
  },
  {
    what: "authentication mock",
    productionOnly: true,
    modules: [new RegExp(`${FRAMEWORK}auth/mock\\.`)],
    text: [/mock-login/],
  },
];

export interface BundleUnderInspection {
  /** The bundle's text. */
  readonly text: string;
  /** Its size in bytes. */
  readonly bytes: number;
  /** Every module with code in it. */
  readonly modules: readonly string[];
  /** The imports it leaves external (loaded at run time). */
  readonly externals?: readonly string[];
  readonly production: boolean;
  /** Secret values the build can see; none may appear in the bundle. */
  readonly secretValues: readonly string[];
  /** Default `AWS_BUNDLE_MAX_BYTES`. */
  readonly maxBytes?: number;
  /** Default `AWS_BUNDLE_RULES`. */
  readonly rules?: readonly ForbiddenRule[];
}

/** Node's built-in modules, with or without `node:`: the only imports the Lambda bundle may leave external. */
export function isNodeBuiltin(specifier: string): boolean {
  const name = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
  return builtinModules.includes(name) || builtinModules.includes(name.split("/")[0] ?? "");
}

const ACCESS_KEY_ID =/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;

/** Every violation found, each naming what it is and where; empty when the bundle is clean. Never prints a secret value. */
export function inspectBundle(bundle: BundleUnderInspection): string[] {
  const violations: string[] = [];
  const modules = bundle.modules.map((m) => m.split("\\").join("/"));
  for (const external of bundle.externals ?? []) if (!isNodeBuiltin(external)) violations.push(`external import: ${external} is not bundled (only Node built-ins may be left to the runtime)`);
  for (const rule of bundle.rules ?? AWS_BUNDLE_RULES) {
    if (rule.productionOnly === true && !bundle.production) continue;
    for (const module of modules) if ((rule.modules ?? []).some((p) => p.test(module))) violations.push(`${rule.what}: module ${module}`);
    for (const pattern of rule.text ?? []) if (pattern.test(bundle.text)) violations.push(`${rule.what}: text matches ${String(pattern)}`);
  }
  const secrets = [...new Set(bundle.secretValues.filter((v) => v.length >= MIN_SECRET_LENGTH))];
  const leaked = secrets.filter((v) => bundle.text.includes(v)).length;
  if (leaked > 0) violations.push(`secret values: ${String(leaked)} secret value(s) visible to the build appear in the bundle`);
  if (ACCESS_KEY_ID.test(bundle.text)) violations.push("secret values: the bundle contains an AWS access key ID");
  const maxBytes = bundle.maxBytes ?? AWS_BUNDLE_MAX_BYTES;
  if (bundle.bytes > maxBytes) violations.push(`size: the bundle is ${String(bundle.bytes)} bytes, above the bound of ${String(maxBytes)} bytes`);
  return violations;
}

/** AWS credential variables whose values must never reach a bundle. */
export const AWS_CREDENTIAL_VARIABLES = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"] as const;

/** The secret values in a process environment: every `SECRET_*` variable and the AWS credentials. */
export function environmentSecretValues(env: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(env)
    .filter(([name]) => name.startsWith("SECRET_") || (AWS_CREDENTIAL_VARIABLES as readonly string[]).includes(name))
    .map(([, value]) => value ?? "")
    .filter((value) => value !== "");
}
