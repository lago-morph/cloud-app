/**
 * MAIL's sender interface (mail.md §2 "Interface", "Failures"; MAIL-REQ-001, DEC-0518, DEC-0519).
 * Framework-internal: apps cannot send email in release 1.
 *
 * `MailSender.send` returns a promise that the caller (PWD) hands to the request's background-task
 * mechanism (`waitUntil`), so neither the response nor its timing depends on the send. A sender
 * wrapped with `withFailureLog` never rejects: a failed send becomes one LOG entry, component
 * `MAIL`, `mail send failed: <code>`, naming only the provider's error code (or `unknown`), never
 * the recipient's address. Workers-compatible: no Node APIs.
 */
import type { LogService } from "../log/public.js";

/** What a caller asks to send. */
export interface MailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** One message as a capture keeps it (testing.d.ts `MailMessage`). */
export interface MailMessage extends MailInput {
  /** `"<sender name> <no-reply@...>"`. */
  readonly from: string;
  /** ISO 8601 time the message was handed to the sender. */
  readonly sentAt: string;
}

export interface MailSender {
  send(message: MailInput): Promise<void>;
}

/** The LOG component of MAIL's entries. */
export const MAIL_COMPONENT = "MAIL";

/** The local part of every framework sender address (DEC-0511). */
export const SENDER_LOCAL_PART = "no-reply";

/** The sender address where there is no account (local `dev`, `createTestApp`; DEC-0514). */
export const LOCAL_SENDER_ADDRESS = `${SENDER_LOCAL_PART}@localhost`;

/** A display name as it may appear in a `From` header: no quotes, angle brackets or line breaks. */
export function cleanDisplayName(name: string): string {
  return name.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
}

/** `"<senderName> <address>"`, or the bare address when the name is empty. */
export function formatFrom(senderName: string, address: string): string {
  const name = cleanDisplayName(senderName);
  return name === "" ? address : `${name} <${address}>`;
}

/** Only codes of this shape are logged (Email Service's `E_SENDER_NOT_VERIFIED`, ...). */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The provider's error code of a rejected send, or `unknown`; never any other text of the error. */
export function mailErrorCode(thrown: unknown): string {
  const code = typeof thrown === "object" && thrown !== null ? (thrown as { code?: unknown }).code : undefined;
  return typeof code === "string" && ERROR_CODE.test(code) ? code : "unknown";
}

/** The one log message of a failed send (mail.md §2 "Failures"). */
export function sendFailedMessage(thrown: unknown): string {
  return `mail send failed: ${mailErrorCode(thrown)}`;
}

/** `sender` whose sends never reject: a failure is one `MAIL` error entry without the address. */
export function withFailureLog(sender: MailSender, log: LogService): MailSender {
  return {
    async send(message) {
      try {
        await sender.send(message);
      } catch (thrown) {
        log.write(MAIL_COMPONENT, "error", sendFailedMessage(thrown));
      }
    },
  };
}

/** The part of a request context that runs background work (`c.executionCtx`). */
export interface BackgroundTasks {
  waitUntil(pending: Promise<unknown>): void;
}

/** The request's background tasks (`c.executionCtx`), or undefined where there are none. */
export function backgroundTasksOf(c: { readonly executionCtx: BackgroundTasks }): BackgroundTasks | undefined {
  try {
    return c.executionCtx;
  } catch {
    // Hono throws when the request was dispatched without an execution context.
    return undefined;
  }
}

/**
 * Starts `message` after the response, in the request's `waitUntil` (MAIL-REQ-001). The send is
 * wrapped with `withFailureLog`, so it never rejects and never fails the request.
 */
export function sendInBackground(tasks: BackgroundTasks | undefined, sender: MailSender, log: LogService, message: MailInput): void {
  const pending = withFailureLog(sender, log).send(message);
  if (tasks === undefined) return;
  try {
    tasks.waitUntil(pending);
  } catch {
    // No usable background-task mechanism: the send still runs to completion on its own.
  }
}

/** A random message ID (16 hex characters), as the captures use. */
export function messageId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A capture's copy of `input`, with its `from` and the time it was handed over. */
export function capturedMessage(input: MailInput, from: string, now: Date = new Date()): MailMessage {
  return { to: input.to, from, subject: input.subject, text: input.text, html: input.html, sentAt: now.toISOString() };
}
