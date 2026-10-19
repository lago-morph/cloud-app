/**
 * CORE public names (contract: docs/contracts/ts/core.d.ts, errors.d.ts).
 * Stub written by B-01; implemented by B-02.
 */
import type { Hono, MiddlewareHandler } from "hono";
import type { PortableDb, TableDefinitions } from "../sql/public.js";
import type { KvService } from "../kv/public.js";
import type { FilesService } from "../files/public.js";
import type { ConfigDeclaration, ConfigService } from "../config/public.js";
import type { SecretsService } from "../secrets/public.js";
import type { LogService } from "../log/public.js";
import type { CurrentUser } from "../auth/public.js";

export { ERROR_CATALOGUE, FrameworkError } from "./errors.js";
export type { ErrorCatalogueEntry, ErrorCode, ErrorResponseBody } from "./errors.js";

/**
 * Which app and stage this code is running as. Never derived from request data.
 * Deliberately omits the target and the test-stage flag (CORE-REQ-003).
 */
export interface DeploymentIdentity {
  readonly app: string;
  readonly stage: string;
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

/** Hono environment type for app routes. `Bindings` is empty so platform bindings are not visible. */
export interface AppEnv<C extends ConfigDeclaration = ConfigDeclaration, S extends string = string> {
  Bindings: Record<never, never>;
  Variables: RequestVars<C, S>;
}

export interface AppDefinition<C extends ConfigDeclaration, S extends string> {
  /** Lowercase letters and digits only, no hyphens, at most PAR-290 characters. */
  readonly name: string;
  /** Non-secret configuration keys the app reads. */
  readonly config: C;
  /** Logical names of secrets the app reads. */
  readonly secrets: readonly S[];
  /** App tables. Framework tables are added by the framework. */
  readonly tables: TableDefinitions;
  /** Registers app API routes. All routes are mounted under `/api`. */
  readonly routes: (api: Hono<AppEnv<C, S>>) => void;
}

/** The value an app's entry module exports. Target entry points are generated from it. */
export interface DefinedApp<C extends ConfigDeclaration, S extends string> {
  readonly definition: AppDefinition<C, S>;
}

export function defineApp<C extends ConfigDeclaration, S extends string>(
  definition: AppDefinition<C, S>,
): DefinedApp<C, S> {
  return { definition };
}

export type { MiddlewareHandler };
