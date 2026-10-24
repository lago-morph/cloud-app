/**
 * Stored log entries (LOG-REQ-002, contracts/schemas/log-entry.schema.json): the framework adds
 * the time, app, stage, target and, during an HTTP request, the request ID.
 */
import type { Deployment } from "../core/identity.js";
import type { Severity } from "./public.js";

/** One stored entry, shaped as log-entry.schema.json (same shape as testing's `LogEntry`). */
export interface LogEntry {
  readonly time: string;
  readonly app: string;
  readonly stage: string;
  readonly target: string;
  readonly component: string;
  readonly severity: Severity;
  readonly message: string;
  readonly requestId?: string;
}

/** What the framework adds to each entry. */
export interface EntryContext {
  readonly deployment: Deployment;
  /** Set for a writer created during an HTTP request. */
  readonly requestId?: string;
  /** Clock; defaults to the current time. */
  readonly now?: () => Date;
}

const REQUIRED = ["time", "app", "stage", "target", "component", "severity", "message"] as const;
const ALLOWED = new Set<string>([...REQUIRED, "requestId"]);
const SEVERITIES = new Set<unknown>(["debug", "info", "warn", "error"]);
const TARGETS = new Set<unknown>(["local", "cloudflare", "aws"]);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

/** True when `value` conforms to log-entry.schema.json. */
export function isLogEntry(value: unknown): value is LogEntry {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED.has(key))) return false;
  if (REQUIRED.some((key) => typeof record[key] !== "string")) return false;
  if ("requestId" in record && typeof record.requestId !== "string") return false;
  const time = record.time as string;
  return SEVERITIES.has(record.severity) && TARGETS.has(record.target) && DATE_TIME.test(time) && !Number.isNaN(Date.parse(time));
}

export function buildEntry(context: EntryContext, component: string, severity: Severity, message: string): LogEntry {
  const time = (context.now ?? (() => new Date()))().toISOString();
  const { app, stage, target } = context.deployment;
  const entry: LogEntry = { time, app, stage, target, component, severity, message };
  return context.requestId === undefined ? entry : { ...entry, requestId: context.requestId };
}
