/**
 * FILES server operations against local R2 (createTestApp, DEC-0105). The FILES-AC-001/-002
 * cases live in server-operations.cases.ts, shared with the AWS pre-check.
 * FILES-AC-001 (FILES-REQ-001), FILES-AC-002 (FILES-REQ-002), FILES-AC-006 server part
 * (FILES-REQ-006: unreachable storage → FILES.UNAVAILABLE). docs/components/files.md;
 * PAR-230 (1,024 UTF-8 bytes), PAR-231 (default page 100), PAR-232 (max page 1,000).
 */
import { afterEach, describe, expect, it } from "vitest";
import { ERROR_CATALOGUE, FrameworkError, type FilesService } from "../../../src/index.js";
import { tag } from "../../../../../tests/support/tags.js";
import { defineFilesServerCases } from "./server-operations.cases.js";
import { disposeAll, errorOf, newFilesApp, withFiles } from "./support.js";

afterEach(disposeAll);

function expectFrameworkError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(FrameworkError);
  expect((error as FrameworkError).code).toBe(code);
}

defineFilesServerCases({ newApp: () => newFilesApp(), withFiles, errorOf }, { t: tag, suffix: "" });

describe("FILES unavailable", () => {
  it(tag("FILES-AC-006", "server part: with storage unreachable, every server operation fails with FILES.UNAVAILABLE"), async () => {
    const app = await newFilesApp({ unavailable: ["files"] });
    const ops: ((files: FilesService) => Promise<unknown>)[] = [
      (f) => f.put("x", new Uint8Array([1])),
      (f) => f.get("x"),
      (f) => f.head("x"),
      (f) => f.delete("x"),
      (f) => f.list(""),
      (f) => f.createUploadTicket("x"),
      (f) => f.createDownloadTicket("x"),
    ];
    for (const op of ops) expectFrameworkError(await errorOf(app, op), "FILES.UNAVAILABLE");
  });

  it(tag("FILES-AC-006", "server part: uncaught in a route, FILES.UNAVAILABLE becomes a 503 ErrorResponse"), async () => {
    const app = await newFilesApp({ unavailable: ["files"] });
    const res = await app.request("/api/head-uncaught?name=x");
    expect(res.status).toBe(ERROR_CATALOGUE["FILES.UNAVAILABLE"].status);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("FILES.UNAVAILABLE");
    expect(typeof body.error.requestId).toBe("string");
  });
});
