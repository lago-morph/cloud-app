/**
 * The AWS Lambda runtime (aws.md §2; plan-aws G-05): the shared stage runtime (`assembleStage`)
 * over the AWS adapters, behind Hono's AWS Lambda adapter for Function URL (payload 2.0) events
 * (DEC-PENDING-g-s1-3). `public.ts` calls it with the Lambda's own environment and clients;
 * tests pass fakes.
 *
 * - **SQL and KV**: the Data API adapter (`sql/data-api.ts`, G-02) on the cluster, secret and
 *   database the Lambda variables name. The client is created once per cold start.
 * - **FILES**: the S3 store and ticket issuer (`files/aws/`, G-04), signed with the role's
 *   session credentials, read per request. Both are created on first use, so a Lambda without a
 *   files bucket still serves every request that does not touch files.
 * - **SEC**: SSM parameters `/<app>/<stage>/secrets/<name>` (`secrets/aws.ts`, G-03), read per
 *   request, for app and framework-internal secrets alike. The SSM client is created once per
 *   cold start, on the first secret read.
 * - **LOG**: one S3 `PutObject` per entry into the shared log bucket (`log/aws/sink.ts`, G-03).
 *   Each invocation has its own pending-write tracker, and the handler awaits it for at most
 *   PAR-260 before it returns the response (LOG-REQ-001). A write still running then is
 *   abandoned (DEC-PENDING-g-03-1, open question 3; DEC-PENDING-g-05-3).
 * - **Public origin**: `FRAMEWORK_PUBLIC_ORIGIN`, never the request's `Host` (AWS-REQ-004,
 *   DEC-0044). The adapter builds `c.req.url` from `Host`; the framework does not use it as the
 *   origin.
 * - **Redaction**: every secret value the runtime has read during this cold start, through
 *   either reader, is redacted from error responses and log entries (DEC-0123;
 *   DEC-PENDING-g-05-4). A value never read cannot appear in an error.
 *
 * Node only (the AWS SDK clients); the Lambda bundle (G-06) is the only place it runs.
 */
import { Hono } from "hono";
import { handle, type LambdaContext, type LambdaEvent } from "hono/aws-lambda";
import type { RDSDataClient } from "@aws-sdk/client-rds-data";
import type { SSMClient } from "@aws-sdk/client-ssm";
import type { RuntimeContext, RuntimeEnv } from "../../core/assemble.js";
import type { DefinedApp } from "../../core/public.js";
import type { ConfigDeclaration } from "../../config/public.js";
import type { ResolvedConfig } from "../../config/resolve.js";
import type { AuthMock } from "../../auth/mock.js";
import type { LoginProvider } from "../../auth/login-provider.js";
import type { FilesStore, TicketIssuer } from "../../files/service.js";
import { createS3FilesStore } from "../../files/aws/store.js";
import { createAwsTicketIssuer } from "../../files/aws/tickets.js";
import { lambdaSessionCredentials, type S3BucketLocation } from "../../files/aws/location.js";
import { workerOutputSink } from "../../log/local.js";
import { s3LogSink } from "../../log/aws/sink.js";
import { createPendingWrites, type PendingWrites } from "../../log/aws/pending.js";
import { ssmSecretReader } from "../../secrets/aws.js";
import type { SecretReader } from "../../secrets/service.js";
import { FRAMEWORK_SECRETS, type FrameworkSecretName } from "../../secrets/names.js";
import { dataApiDb, type DataApiClock, type DataApiTarget } from "../../sql/data-api.js";
import { assembleStage } from "../cloudflare/stage.js";
import type { Environment } from "./sdk.js";
import { awsLambdaSettings } from "./settings.js";

type Env = RuntimeEnv["Bindings"];

/**
 * A Lambda Function URL event (payload format 2.0), as far as the runtime reads it. Structural,
 * so the published declarations need no `@types/aws-lambda`; its `APIGatewayProxyEventV2` fits.
 */
export interface FunctionUrlEvent {
  readonly version: string;
  readonly rawPath: string;
  readonly rawQueryString: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly cookies?: readonly string[];
  readonly body?: string;
  readonly isBase64Encoded: boolean;
  readonly requestContext: { readonly http: { readonly method: string } };
}

/** The Function URL response: several `Set-Cookie` headers come back as `cookies` (AWS-AC-006). */
export interface FunctionUrlResult {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly cookies?: string[];
  readonly body: string;
  readonly isBase64Encoded: boolean;
}

/** The HTTP Lambda's handler: one Function URL event and its Lambda context in, the response out. */
export type AwsLambdaHandler = (event: FunctionUrlEvent, context?: unknown) => Promise<FunctionUrlResult>;

/** What the runtime runs on: the Lambda's environment and clients, or test fakes. */
export interface AwsRuntimeDependencies {
  /** The function's environment (`process.env` in Lambda). */
  readonly env: Environment;
  /** The Data API client, created once per cold start. */
  readonly dataApi: () => RDSDataClient;
  /** The SSM client, created once per cold start in the given region. */
  readonly ssm: (region: string) => Pick<SSMClient, "send">;
  /** The fetch S3 requests (files, log writes) are sent with; default the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** The Data API retry loop's clock (tests). */
  readonly clock?: DataApiClock;
  /** The authentication mock: test stages only. */
  readonly mock?: AuthMock;
  /** The stage's login provider (GOOGLE), when it has one. */
  readonly provider?: LoginProvider;
}

/** Records every value a reader returns, for redaction (DEC-PENDING-g-05-4). */
function recording(read: SecretReader, seen: Set<string>): SecretReader {
  return async (name) => {
    const value = await read(name);
    if (value !== undefined && value !== "") seen.add(value);
    return value;
  };
}

/** A store created on its first call, so a missing bucket setting fails only file operations. */
function lazyStore(make: () => FilesStore): FilesStore {
  let store: FilesStore | undefined;
  const get = () => (store ??= make());
  return {
    put: async (key, value, options) => get().put(key, value, options),
    get: async (key) => get().get(key),
    head: async (key) => get().head(key),
    delete: async (key) => get().delete(key),
    list: async (options) => get().list(options),
  };
}

function lazyTickets(make: () => TicketIssuer): TicketIssuer {
  return {
    upload: async (name, contentType) => make().upload(name, contentType),
    download: async (name) => make().download(name),
  };
}

/** Builds the Lambda handler for `app` over `deps`. Never throws for misconfiguration (checked on use). */
export function createAwsLambdaRuntime<C extends ConfigDeclaration, S extends string>(
  app: DefinedApp<C, S>,
  resolved: ResolvedConfig,
  deps: AwsRuntimeDependencies,
): AwsLambdaHandler {
  const { deployment } = resolved;
  const settings = awsLambdaSettings(deps.env);
  const production = !deployment.isTestStage;
  const required: FrameworkSecretName[] = [FRAMEWORK_SECRETS.sessionKey];
  if (production) required.push(FRAMEWORK_SECRETS.googleClientSecret);

  // Per cold start: the SSM client and the secret values read so far (for redaction).
  let ssm: Pick<SSMClient, "send"> | undefined;
  const ssmClient = () => (ssm ??= deps.ssm(settings.region));
  const secretValues = new Set<string>();
  const scope = { app: deployment.app, stage: deployment.stage };
  const readSecret = recording((name) => ssmSecretReader(ssmClient(), scope)(name), secretValues);

  // Per invocation: the pending log writes, keyed by the env object the outer handler creates.
  const invocations = new WeakMap<object, PendingWrites>();
  const pendingOf = (env: Env): PendingWrites => {
    let pending = invocations.get(env);
    if (pending === undefined) {
      pending = createPendingWrites();
      invocations.set(env, pending);
    }
    return pending;
  };

  const filesLocation = (): S3BucketLocation => ({ bucket: settings.filesBucket, region: settings.region, accountId: settings.accountId });
  const credentials = () => lambdaSessionCredentials(deps.env);
  const s3Fetch = deps.fetch === undefined ? {} : { fetch: deps.fetch };

  const stage = assembleStage(app, {
    resolved,
    sink: workerOutputSink(),
    requestSink: (c: RuntimeContext) => s3LogSink({ bucket: settings.logBucket, pending: pendingOf(c.env), ...s3Fetch }),
    publicOrigin: () => settings.publicOrigin,
    sql: (_env, log) => {
      const db = settings.database;
      const target: DataApiTarget = { resourceArn: db.clusterArn, secretArn: db.secretArn, database: db.name };
      const clock = deps.clock === undefined ? {} : { clock: deps.clock };
      const client = deps.dataApi();
      return { sql: dataApiDb(client, target, { log, ...clock }), kv: dataApiDb(client, target, clock) };
    },
    store: () => lazyStore(() => createS3FilesStore({ location: filesLocation(), credentials, ...s3Fetch })),
    tickets: () => lazyTickets(() => createAwsTicketIssuer({ location: filesLocation(), credentials })),
    readSecret: () => readSecret,
    readFrameworkSecret: () => readSecret,
    secretValues: () => secretValues,
    requiredFrameworkSecrets: required,
    ...(deps.provider === undefined ? {} : { provider: deps.provider }),
    ...(deps.mock === undefined ? {} : { mock: deps.mock }),
  });

  // The outer app gives each invocation its own env object (and so its own pending writes),
  // and returns only after those writes have settled, or PAR-260 has passed.
  const outer = new Hono<RuntimeEnv>();
  outer.all("*", async (c) => {
    const env: Env = { ...c.env };
    try {
      return await stage.fetch(c.req.raw, env);
    } finally {
      await pendingOf(env).settle();
    }
  });
  const lambda = handle(outer);
  // One boundary cast: Hono's event types require fields Function URL events leave out
  // (`body`, `requestContext.authorizer`/`authentication`; DEC-PENDING-g-s1-3).
  return async (event, context) => (await lambda(event as unknown as LambdaEvent, context as LambdaContext | undefined)) as unknown as FunctionUrlResult;
}
