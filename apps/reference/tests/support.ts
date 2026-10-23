import { createTestApp, type TestApp, type TestAppOptions } from "@lago-morph/prototype-framework/testing";
import { afterEach } from "vitest";
import app from "../src/app";

/** A JSON request init. */
export function json(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

let opened: TestApp[] = [];

/** Opens an in-process reference app, disposed after the test. */
export async function open(options?: TestAppOptions): Promise<TestApp> {
  const t = await createTestApp(app, options);
  opened.push(t);
  return t;
}

afterEach(async () => {
  await Promise.all(opened.map((t) => t.dispose()));
  opened = [];
});

/** The error body of a framework error response. */
export interface ErrorBody {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}
