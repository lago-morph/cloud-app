/**
 * Known secret values for the scans of E2E-013 and E2E-014. Values are only compared, never
 * printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComplianceClient } from "../../harness/index.js";
import { prerequisiteMissing } from "../../harness/index.js";

/** The values in an app's local `.dev.vars` (`NAME=value` lines; quotes removed), of at least 8 characters. */
export function localDevVarValues(appDir: string): string[] {
  const path = join(appDir, ".dev.vars");
  if (!existsSync(path)) return [];
  const out: string[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[2] === undefined) continue;
    let value = m[2];
    if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value.charAt(0))) {
      value = value.slice(1, -1);
      if (m[2].startsWith('"')) value = value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    if (value.length >= 8) out.push(value);
  }
  return out;
}

/** The SHA-256 the reference app reports for its secret `apiKey` (`GET /api/ref/secret`); blocked when it is not set. */
export async function apiKeyDigest(api: ComplianceClient): Promise<string> {
  const response = await api.get("/api/ref/secret");
  if (response.status === 500 && response.errorCode === "SEC.MISSING") {
    return prerequisiteMissing("the reference app's secret apiKey has no value on this target (set it with `secrets set apiKey`)");
  }
  api.expectStatus(response, 200);
  const { sha256 } = response.json<{ sha256: string }>();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("GET /api/ref/secret did not return a lower-case hex SHA-256");
  return sha256;
}
