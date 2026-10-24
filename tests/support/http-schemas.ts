/**
 * Pure schema checks for docs/contracts/http/framework.openapi.yaml, shared by the framework's
 * in-process AUTH suite (packages/framework/test/integration/auth) and the compliance criteria
 * that run over HTTP against a target (tests/compliance/criteria/auth). No in-process
 * dependency: only the error catalogue, itself a plain transcription of
 * docs/contracts/ts/errors.d.ts (fix-auth005; root cause
 * 2026-10-24-pass1c-E2E-004-AUTH-AC-005-no-cloud-test, Review change 1).
 */
import { ERROR_CATALOGUE } from "../../packages/framework/src/core/errors.js";

export { ERROR_CATALOGUE };
export type ErrorCode = keyof typeof ERROR_CATALOGUE;

/**
 * `ErrorResponse` of framework.openapi.yaml: `{ error: { code, message, requestId } }`, all
 * strings, no other properties at either level, and a code from the catalogue.
 */
export function isErrorResponse(body: unknown): boolean {
  if (!isPlainObject(body) || !hasExactKeys(body, ["error"], [])) return false;
  const error = body["error"];
  if (!isPlainObject(error) || !hasExactKeys(error, ["code", "message", "requestId"], [])) return false;
  return (
    typeof error["code"] === "string" &&
    Object.hasOwn(ERROR_CATALOGUE, error["code"]) &&
    typeof error["message"] === "string" &&
    typeof error["requestId"] === "string" &&
    error["requestId"] !== ""
  );
}

/**
 * `CurrentUser` of framework.openapi.yaml (oneOf): `{ level: "anonymous", unlistedId? }` or
 * `{ level: "user" | "admin", id, displayName: string | null }`, no additional properties.
 */
export function isCurrentUserResponse(body: unknown): boolean {
  if (!isPlainObject(body)) return false;
  if (body["level"] === "anonymous") {
    return hasExactKeys(body, ["level"], ["unlistedId"]) && (body["unlistedId"] === undefined || typeof body["unlistedId"] === "string");
  }
  if (body["level"] === "user" || body["level"] === "admin") {
    return (
      hasExactKeys(body, ["level", "id", "displayName"], []) &&
      typeof body["id"] === "string" &&
      (body["displayName"] === null || typeof body["displayName"] === "string")
    );
  }
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function hasExactKeys(obj: Record<string, unknown>, required: string[], optional: string[]): boolean {
  const keys = Object.keys(obj);
  return required.every((k) => keys.includes(k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}
