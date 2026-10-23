/**
 * Validation of a committed per-stage values file against the stage configuration schema
 * (docs/contracts/schemas/stage-config.schema.json, CFG-REQ-002, CFG-REQ-006). The schema is
 * mirrored here in Zod; `schema.unit.test.ts` checks the two agree on every rule. An unknown
 * field anywhere is rejected, so the file has no place for secret values.
 */
import { z } from "zod";
import { FrameworkError } from "../core/errors.js";
import type { ConfigValue } from "./keys.js";

/** A validated values file. `admins` defaults to an empty list; `users` is absent unless given. */
export interface StageConfigFile {
  readonly values: Readonly<Record<string, ConfigValue>>;
  readonly framework: {
    readonly admins: readonly string[];
    readonly users?: readonly string[];
    readonly google?: { readonly clientId: string };
  };
}

const userIds = z
  .array(z.string().min(1, "user IDs must not be empty"))
  .refine((ids) => new Set(ids).size === ids.length, "user IDs must be unique");

const value = z.union([z.string(), z.number().int(), z.boolean(), z.array(z.string())], {
  error: "must be a string, an integer, a boolean, or a list of strings",
});

const stageConfig = z.strictObject({
  values: z.record(z.string(), value),
  framework: z.strictObject({
    admins: userIds.default([]),
    users: userIds.optional(),
    google: z.strictObject({ clientId: z.string().min(1, "must not be empty") }).optional(),
  }),
});

/**
 * Parses and validates the text of `file`. Throws CORE.MISCONFIGURED naming the file and every
 * problem found (the build prints it).
 */
export function parseStageConfig(text: string, file: string): StageConfigFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw invalid(file, [`not valid JSON (${err instanceof Error ? err.message : String(err)})`]);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw invalid(file, ["must be a JSON object with \"values\" and \"framework\""]);
  }
  const result = stageConfig.safeParse(data);
  if (!result.success) throw invalid(file, result.error.issues.flatMap(describeIssue));
  const { admins, users, google } = result.data.framework;
  return {
    values: result.data.values,
    framework: { admins, ...(users === undefined ? {} : { users }), ...(google === undefined ? {} : { google }) },
  };
}

function describeIssue(issue: z.core.$ZodIssue): string[] {
  const where = issue.path.map(String).join(".");
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `unknown field "${where === "" ? key : `${where}.${key}`}"`);
  }
  return [`"${where}": ${issue.message}`];
}

function invalid(file: string, problems: readonly string[]): FrameworkError {
  return new FrameworkError("CORE.MISCONFIGURED", `${file} does not match the stage configuration schema:\n- ${problems.join("\n- ")}`);
}
