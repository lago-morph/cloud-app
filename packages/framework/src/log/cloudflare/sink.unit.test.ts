/**
 * The Cloudflare log sink (log.md §2 "Cloudflare"): one object per entry in the shared log
 * bucket, each write handed to the request's `waitUntil` so it never delays the response, and a
 * failed write dropped (LOG-REQ-001).
 */
import { describe, expect, it } from "vitest";
import { tag } from "../../../../../tests/support/tags.js";
import type { LogEntry } from "../entry.js";
import { createLogWriter } from "../writer.js";
import { createDeployment } from "../../core/identity.js";
import { r2LogSink, type LogBucket } from "./sink.js";

const entry: LogEntry = {
  time: "2026-10-20T03:04:05.067Z",
  app: "notes",
  stage: "test-abc",
  target: "cloudflare",
  component: "CORE",
  severity: "info",
  message: "hello",
  requestId: "r-1",
};

interface Put {
  key: string;
  value: string;
  contentType: string | undefined;
}

function recordingBucket(): { bucket: LogBucket; puts: Put[] } {
  const puts: Put[] = [];
  return {
    puts,
    bucket: {
      put: async (key, value, options) => {
        puts.push({ key, value, contentType: options?.httpMetadata?.contentType });
        return {};
      },
    },
  };
}

function scheduler(): { waitUntil: (p: Promise<unknown>) => void; pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return { pending, waitUntil: (p) => void pending.push(p) };
}

describe("r2LogSink", () => {
  it(tag("LOG-AC-004", "unit: stores one JSON object per entry under the LOG-REQ-004 key"), async () => {
    const { bucket, puts } = recordingBucket();
    const s = scheduler();
    r2LogSink({ bucket, waitUntil: s.waitUntil })(entry);
    await Promise.all(s.pending);
    expect(puts).toEqual([
      { key: "notes/test-abc/2026/10/20/030405.067-info-r-1.json", value: JSON.stringify(entry), contentType: "application/json" },
    ]);
  });

  it("hands the write to waitUntil and returns without waiting for it", () => {
    let release: () => void = () => undefined;
    const bucket: LogBucket = { put: () => new Promise((resolve) => (release = () => resolve({}))) };
    const s = scheduler();
    const result = r2LogSink({ bucket, waitUntil: s.waitUntil })(entry);
    expect(result).toBeUndefined();
    expect(s.pending).toHaveLength(1);
    release();
  });

  it(tag("LOG-AC-001", "unit (Cloudflare sink): a rejected bucket write is dropped; the scheduled promise settles without rejecting"), async () => {
    const bucket: LogBucket = { put: () => Promise.reject(new Error("r2 down")) };
    const s = scheduler();
    r2LogSink({ bucket, waitUntil: s.waitUntil })(entry);
    await expect(s.pending[0]).resolves.toBeUndefined();
  });

  it(tag("LOG-AC-001", "unit (Cloudflare sink): a bucket that throws and a waitUntil that throws never reach the caller"), () => {
    const throwing: LogBucket = {
      put: () => {
        throw new Error("sync failure");
      },
    };
    const log = createLogWriter({ deployment: createDeployment({ app: "notes", stage: "test-abc", target: "cloudflare" }) }, r2LogSink({ bucket: throwing, waitUntil: () => undefined }));
    expect(() => log.write("APP", "info", "x")).not.toThrow();
    const { bucket } = recordingBucket();
    const sink = r2LogSink({
      bucket,
      waitUntil: () => {
        throw new Error("no execution context");
      },
    });
    expect(() => sink(entry)).not.toThrow();
  });

  it("without a log bucket binding, prints the entry as a marked Worker output line instead", () => {
    const lines: string[] = [];
    r2LogSink({ bucket: undefined, waitUntil: () => undefined, print: (line) => void lines.push(line) })(entry);
    expect(lines).toEqual([`[prototype-framework:log] ${JSON.stringify(entry)}`]);
  });
});
