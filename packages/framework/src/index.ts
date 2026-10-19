/**
 * Hub for `.` (CORE-REQ-005): the server-side app API, exactly the names of
 * docs/contracts/ts/index.d.ts. Re-exports only; each name lives in its component's public.ts.
 */
export { defineApp } from "./core/public.js";
export type { AppDefinition, AppEnv, DefinedApp, DeploymentIdentity, RequestVars, Services } from "./core/public.js";

export { FrameworkError, ERROR_CATALOGUE } from "./core/public.js";
export type { ErrorCode, ErrorResponseBody } from "./core/public.js";

export { jsonBody, queryParams, z } from "./http/public.js";

export {
  defineTable, id, text, integer, number, timestamp, boolean, ref, newId, now, atomic,
  eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between,
  count, countDistinct, min, max, sum, avg, asc, desc, containsText,
} from "./sql/public.js";
export type {
  AnyTable, AtomicResults, Column, ColumnBuilder, ColumnBuilders, PortableDb, PortableQueryResult, WriteDb, WriteStep, Table, TableDefinitions, TableOptions,
} from "./sql/public.js";

export type { KvService, KvListOptions, KvListPage } from "./kv/public.js";
export type {
  FilesService, FileInfo, FileContent, FilesListOptions, FilesListPage, UploadTicket, UploadTicketOptions, DownloadTicket,
} from "./files/public.js";
export { configString, configInteger, configBoolean, configStringList } from "./config/public.js";
export type { ConfigDeclaration, ConfigKey, ConfigService } from "./config/public.js";
export type { SecretsService } from "./secrets/public.js";
export type { LogService, Severity } from "./log/public.js";
export { requireUser, requireAdmin, requireCurrentUser } from "./auth/public.js";
export type { AccessLevel, CurrentUser, LoggedInUser } from "./auth/public.js";
