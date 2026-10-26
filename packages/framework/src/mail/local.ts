/**
 * The local `dev` capture sender (mail.md §2 "Senders"; MAIL-REQ-002, LOCAL-REQ-002, DEC-0518).
 * Worker code cannot write files under workerd, so, like the local log (DEC-0066), the Worker
 * prints each message as one marked line on its output; `dev` picks those lines out
 * (`capture.ts`) and writes each message to `.mail/<timestamp>-<id>.json`. Nothing is sent and
 * no `send_email` binding is used. The sender is `no-reply@localhost`. Workers-compatible.
 */
import { capturedMessage, formatFrom, LOCAL_SENDER_ADDRESS, messageId, type MailSender } from "./sender.js";

/** Starts every mail line on the Worker's output. Printable, and unlikely in app output. */
export const MAIL_LINE_MARKER = "[prototype-framework:mail] ";

/** What one marked line carries: the file's ID and the `.mail/` file's content. */
export interface MailLine {
  readonly id: string;
  readonly message: MailFile;
}

/** The content of one `.mail/<timestamp>-<id>.json` file: exactly `{ to, subject, text, html, time }` (mail.md §2). */
export interface MailFile {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** ISO 8601 UTC time the message was handed to the sender. */
  readonly time: string;
}

/** One marked line: the marker, then the JSON (JSON escapes line breaks). */
export function formatMailLine(line: MailLine): string {
  return MAIL_LINE_MARKER + JSON.stringify(line);
}

export interface WorkerOutputMailOptions {
  /** `framework.email.senderName`, defaulting to the app name. */
  readonly senderName: string;
  readonly print?: (line: string) => void;
  readonly now?: () => Date;
}

/** The `from` the local sender uses. */
export function localFrom(senderName: string): string {
  return formatFrom(senderName, LOCAL_SENDER_ADDRESS);
}

/** The local Worker's sender: prints each message as a marked line (default `console.log`). */
export function workerOutputMailSender(options: WorkerOutputMailOptions): MailSender {
  const print = options.print ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  return {
    send(input) {
      const m = capturedMessage(input, localFrom(options.senderName), now());
      print(formatMailLine({ id: messageId(), message: { to: m.to, subject: m.subject, text: m.text, html: m.html, time: m.sentAt } }));
      return Promise.resolve();
    },
  };
}
