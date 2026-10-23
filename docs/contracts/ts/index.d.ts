/**
 * Main entry point of the framework package (`<package>`): everything server-side
 * app code may import. The complete list of package subpaths and who may import them
 * is a contract stated in docs/components/core.md (CORE-REQ-005).
 */
export { defineApp } from "./core";
export type { AppDefinition, AppEnv, DefinedApp, DeploymentIdentity, RequestVars, Services } from "./core";

export { FrameworkError, ERROR_CATALOGUE } from "./errors";
export type { ErrorCode, ErrorResponseBody } from "./errors";

export { jsonBody, queryParams, z } from "./http";

export {
  defineTable, id, text, integer, number, timestamp, boolean, ref, newId, now, atomic,
  eq, ne, gt, gte, lt, lte, and, or, not, isNull, isNotNull, inArray, notInArray, between,
  count, countDistinct, min, max, sum, avg, asc, desc, containsText,
} from "./sql";
export type {
  AnyTable, AtomicResults, Column, ColumnBuilder, ColumnBuilders, PortableDb, PortableQueryResult, WriteDb, WriteStep, Table, TableDefinitions, TableOptions,
} from "./sql";

export type { KvService, KvListOptions, KvListPage } from "./kv";
export type {
  FilesService, FileInfo, FileContent, FilesListOptions, FilesListPage, UploadTicket, UploadTicketOptions, DownloadTicket,
} from "./files";
export { configString, configInteger, configBoolean, configStringList } from "./config";
export type { ConfigDeclaration, ConfigKey, ConfigService } from "./config";
export type { SecretsService } from "./secrets";
export type { LogService, Severity } from "./log";
export { requireUser, requireAdmin, requireCurrentUser } from "./auth";
export type { AccessLevel, CurrentUser, LoggedInUser } from "./auth";
