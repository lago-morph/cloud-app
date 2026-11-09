import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { ImportResult } from "../../../src/shared/types";

/** Signs `request` in as a mock user, by default a fresh one (local data is kept between runs), and returns its ID. */
export async function signIn(request: APIRequestContext, id = `e2e-${crypto.randomUUID()}`): Promise<string> {
  const res = await request.post("/api/auth/mock-login", { data: { level: "user", id } });
  expect(res.status()).toBe(204);
  return id;
}

export async function errorCode(res: APIResponse): Promise<string | undefined> {
  const body: { error?: { code?: string } } = await res.json();
  return body.error?.code;
}

/** Imports the schedule from Sessionize if the local database has none yet. */
export async function ensureImported(request: APIRequestContext): Promise<ImportResult> {
  const res = await request.post("/api/schedule/refresh", { data: { onlyIfEmpty: true }, timeout: 90_000 });
  expect(res.status()).toBe(200);
  return res.json();
}
