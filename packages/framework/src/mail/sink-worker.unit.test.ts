/**
 * The mail sink Worker's `email` handler (MAIL-REQ-005, mail.md §2 "Mail sink"): the exact source
 * `setup-account` uploads, evaluated here and fed a sample message. No network.
 */
import { describe, expect, it } from "vitest";
import { MAIL_SINK_BINDING, MAIL_SINK_SOURCE, sinkPrefix } from "./sink-worker.js";

interface StoredObject {
  readonly key: string;
  readonly body: ArrayBuffer;
  readonly options: unknown;
}

/** The module's default export, evaluated from the uploaded text (its one `export default` becomes a return). */
function loadSink(): { email(message: unknown, env: unknown): Promise<void> } {
  expect(MAIL_SINK_SOURCE.match(/export default/g)).toHaveLength(1);
  expect(MAIL_SINK_SOURCE).not.toMatch(/\bimport\b/);
  return new Function(MAIL_SINK_SOURCE.replace("export default", "return"))() as { email(message: unknown, env: unknown): Promise<void> };
}

const SAMPLE = [
  "From: Demo <no-reply@example.test>",
  "To: sink+run1@t.example.test",
  "Subject: Verify your email",
  "Date: Sun, 25 Oct 2026 10:00:01 +0000",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "Open https://notes-prod.example.test/api/auth/password/verify?token=abc",
  "",
].join("\r\n");

describe("the mail sink Worker (prototype-mailsink)", () => {
  it("writes the raw message to its bucket under <recipient>/<timestamp>-<id>.eml and does nothing else", async () => {
    const stored: StoredObject[] = [];
    const bucket = { put: async (key: string, body: ArrayBuffer, options: unknown) => void stored.push({ key, body, options }) };
    const message = { from: "bounce@cf-bounce.example.test", to: "Sink+Run1@T.Example.Test", raw: new Blob([SAMPLE]).stream(), rawSize: SAMPLE.length };
    await loadSink().email(message, { [MAIL_SINK_BINDING]: bucket });
    expect(stored).toHaveLength(1);
    const [object] = stored;
    expect(object!.key).toMatch(/^sink\+run1@t\.example\.test\/\d{8}T\d{9}Z-[0-9a-f-]{36}\.eml$/);
    expect(object!.key.startsWith(sinkPrefix("sink+run1@t.example.test"))).toBe(true);
    expect(new TextDecoder().decode(object!.body)).toBe(SAMPLE);
    expect(object!.options).toEqual({ httpMetadata: { contentType: "message/rfc822" } });
  });

  it("two messages to one recipient get keys that sort in arrival order", async () => {
    const keys: string[] = [];
    const bucket = { put: async (key: string) => void keys.push(key) };
    const sink = loadSink();
    for (let i = 0; i < 2; i++) {
      await sink.email({ to: "sink+a@t.example.test", raw: new Blob([SAMPLE]).stream() }, { [MAIL_SINK_BINDING]: bucket });
      await new Promise((r) => setTimeout(r, 2));
    }
    expect([...keys].sort()).toEqual(keys);
  });
});
