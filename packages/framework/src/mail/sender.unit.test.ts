/**
 * MAIL's sender interface and failure logging (mail.md §2 "Interface", "Failures"; DEC-0519).
 * Unit evidence only; the criteria's evidence is the test authors'.
 */
import { describe, expect, it } from "vitest";
import type { LogService, Severity } from "../log/public.js";
import { capturedMessage, cleanDisplayName, formatFrom, mailErrorCode, MAIL_COMPONENT, messageId, sendFailedMessage, sendInBackground, withFailureLog, backgroundTasksOf, type MailSender } from "./sender.js";

const TO = "someone@example.test";
const MESSAGE = { to: TO, subject: "Verify", text: "Open the link", html: "<p>Open the link</p>" };

function recordingLog(): LogService & { entries: { component: string; severity: Severity; message: string }[] } {
  const entries: { component: string; severity: Severity; message: string }[] = [];
  return { entries, write: (component, severity, message) => void entries.push({ component, severity, message }) };
}

function codeError(code: unknown, message = `failed for ${TO}`): Error {
  return Object.assign(new Error(message), { code });
}

describe("formatFrom", () => {
  it("is '<name> <address>', or the bare address for an empty name", () => {
    expect(formatFrom("Demo", "no-reply@localhost")).toBe("Demo <no-reply@localhost>");
    expect(formatFrom("  ", "no-reply@localhost")).toBe("no-reply@localhost");
  });

  it("drops quotes, angle brackets and line breaks from the display name", () => {
    expect(cleanDisplayName('Evil"\r\nBcc: x <y>')).toBe("Evil Bcc: x y");
  });
});

describe("mailErrorCode", () => {
  it("is the provider's error code, or unknown", () => {
    expect(mailErrorCode(codeError("E_SENDER_NOT_VERIFIED"))).toBe("E_SENDER_NOT_VERIFIED");
    expect(mailErrorCode(new Error("x"))).toBe("unknown");
    expect(mailErrorCode("E_STRING")).toBe("unknown");
    expect(mailErrorCode(undefined)).toBe("unknown");
  });

  it("never passes on a code that could carry an address or free text", () => {
    expect(mailErrorCode(codeError(TO))).toBe("unknown");
    expect(mailErrorCode(codeError("E bad code"))).toBe("unknown");
    expect(mailErrorCode(codeError(42))).toBe("unknown");
    expect(sendFailedMessage(codeError("E_RATE_LIMITED"))).toBe("mail send failed: E_RATE_LIMITED");
  });
});

describe("withFailureLog", () => {
  it("passes a successful send through and logs nothing", async () => {
    const log = recordingLog();
    const sent: unknown[] = [];
    await withFailureLog({ send: async (m) => void sent.push(m) }, log).send(MESSAGE);
    expect(sent).toEqual([MESSAGE]);
    expect(log.entries).toEqual([]);
  });

  it("turns a rejected send into one MAIL error entry naming the code and not the address", async () => {
    const log = recordingLog();
    const failing: MailSender = { send: () => Promise.reject(codeError("E_SENDER_NOT_VERIFIED")) };
    await expect(withFailureLog(failing, log).send(MESSAGE)).resolves.toBeUndefined();
    expect(log.entries).toEqual([{ component: MAIL_COMPONENT, severity: "error", message: "mail send failed: E_SENDER_NOT_VERIFIED" }]);
    expect(JSON.stringify(log.entries)).not.toContain(TO);
  });

  it("a sender that throws synchronously is logged as unknown", async () => {
    const log = recordingLog();
    const throwing: MailSender = {
      send: () => {
        throw new Error(`bad ${TO}`);
      },
    };
    await withFailureLog(throwing, log).send(MESSAGE);
    expect(log.entries.map((e) => e.message)).toEqual(["mail send failed: unknown"]);
  });
});

describe("sendInBackground", () => {
  it("hands the send to waitUntil and returns at once, even for a send that never completes", () => {
    const pending: Promise<unknown>[] = [];
    const never: MailSender = { send: () => new Promise(() => undefined) };
    sendInBackground({ waitUntil: (p) => void pending.push(p) }, never, recordingLog(), MESSAGE);
    expect(pending).toHaveLength(1);
  });

  it("a failed send in the background is logged, never thrown", async () => {
    const log = recordingLog();
    const pending: Promise<unknown>[] = [];
    sendInBackground({ waitUntil: (p) => void pending.push(p) }, { send: () => Promise.reject(codeError("E_X")) }, log, MESSAGE);
    await Promise.all(pending);
    expect(log.entries.map((e) => e.message)).toEqual(["mail send failed: E_X"]);
  });

  it("works without a background-task mechanism, or with one that throws", async () => {
    const sent: unknown[] = [];
    const sender: MailSender = { send: async (m) => void sent.push(m) };
    sendInBackground(undefined, sender, recordingLog(), MESSAGE);
    sendInBackground(
      {
        waitUntil: () => {
          throw new Error("no context");
        },
      },
      sender,
      recordingLog(),
      MESSAGE,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(sent).toHaveLength(2);
  });

  it("backgroundTasksOf is undefined when the context has no execution context", () => {
    const missing = {
      get executionCtx(): never {
        throw new Error("This context has no ExecutionContext");
      },
    };
    expect(backgroundTasksOf(missing)).toBeUndefined();
    const ctx = { waitUntil: () => undefined };
    expect(backgroundTasksOf({ executionCtx: ctx })).toBe(ctx);
  });
});

describe("captured messages", () => {
  it("carry the from and the time handed over; IDs are random hex", () => {
    const at = new Date("2026-10-25T10:11:12.123Z");
    expect(capturedMessage(MESSAGE, "Demo <no-reply@localhost>", at)).toEqual({ ...MESSAGE, from: "Demo <no-reply@localhost>", sentAt: "2026-10-25T10:11:12.123Z" });
    expect(messageId()).toMatch(/^[0-9a-f]{16}$/);
    expect(messageId()).not.toBe(messageId());
  });
});
