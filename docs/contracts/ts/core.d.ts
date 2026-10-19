/**
 * App contract (CORE). Services and context shapes passed to app code, the app
 * definition, and deployment identity. Behavior: docs/components/core.md.
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { PortableDb, TableDefinitions } from "./sql";
import type { KvService } from "./kv";
import type { FilesService } from "./files";
import type { ConfigDeclaration, ConfigService } from "./config";
import type { SecretsService } from "./secrets";
import type { LogService } from "./log";
import type { CurrentUser } from "./auth";

export type Target = "local" | "cloudflare" | "aws";

/** Who and where this code is running as. Never derived from request data. */
export interface DeploymentIdentity {
  readonly app: string;
  readonly stage: string;
  readonly target: Target;
  /** True locally and in stages explicitly marked as test stages. */
  readonly isTestStage: boolean;
}

/** Named context shape: the capabilities available to server-side app code. */
export interface Services<C extends ConfigDeclaration = ConfigDeclaration, S extends string = string> {
  readonly sql: PortableDb;
  readonly kv: KvService;
  readonly files: FilesService;
  readonly config: ConfigService<C>;
  readonly secrets: SecretsService<S>;
  readonly log: LogService;
}

/** Named context shape: everything an HTTP handler sees as `c.var`. */
export interface RequestVars<C extends ConfigDeclaration = ConfigDeclaration, S extends string = string>
  extends Services<C, S> {
  readonly user: CurrentUser;
  readonly deployment: DeploymentIdentity;
  /** Also returned in error responses and written with log entries. */
  readonly requestId: string;
}

/** Hono environment type for app routes. */
export interface AppEnv<C extends ConfigDeclaration = ConfigDeclaration, S extends string = string> {
  Variables: RequestVars<C, S>;
}

export interface AppDefinition<C extends ConfigDeclaration, S extends string> {
  /** Lowercase letters, digits, hyphens; 1–32 characters. Used in resource and log names. */
  readonly name: string;
  /** Non-secret configuration keys the app reads (see config.d.ts). */
  readonly config: C;
  /** Logical names of secrets the app reads. */
  readonly secrets: readonly S[];
  /** App tables (see sql.d.ts). Framework tables are added by the framework. */
  readonly tables: TableDefinitions;
  /** Registers app API routes. All routes are mounted under `/api`. */
  readonly routes: (api: Hono<AppEnv<C, S>>) => void;
}

/** The value an app's entry module exports. Target entry points are generated from it. */
export interface DefinedApp<C extends ConfigDeclaration, S extends string> {
  readonly definition: AppDefinition<C, S>;
}

export declare function defineApp<C extends ConfigDeclaration, S extends string>(
  definition: AppDefinition<C, S>,
): DefinedApp<C, S>;

export type { MiddlewareHandler };
