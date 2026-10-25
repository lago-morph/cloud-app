/**
 * `createTestApp`'s in-memory outbox (mail.md §2 "Senders"; testing.d.ts `TestApp.mail`,
 * `mailSender`). Nothing is ever delivered. Also the two senders the framework's own MAIL tests
 * select with `mailSender: "failing" | "never-completing"`. Test-only; never part of a Worker bundle.
 */
import { capturedMessage, formatFrom, LOCAL_SENDER_ADDRESS, type MailMessage, type MailSender } from "./sender.js";

/** testing.d.ts `TestMail`. */
export interface TestMail {
  lastTo(address: string): Promise<MailMessage | undefined>;
  all(): Promise<readonly MailMessage[]>;
}

export interface Outbox extends TestMail {
  readonly sender: MailSender;
}

export function createOutbox(options: { readonly senderName: string; readonly now?: () => Date }): Outbox {
  const messages: MailMessage[] = [];
  const from = formatFrom(options.senderName, LOCAL_SENDER_ADDRESS);
  const now = options.now ?? (() => new Date());
  return {
    sender: {
      send(input) {
        messages.push(capturedMessage(input, from, now()));
        return Promise.resolve();
      },
    },
    lastTo: (address) => Promise.resolve(messages.findLast((m) => m.to === address)),
    all: () => Promise.resolve([...messages]),
  };
}

/** The error a failing test sender rejects with (code as Email Service would give it). */
export class TestSendError extends Error {
  override readonly name = "TestSendError";
  readonly code = "E_TEST_SEND_FAILED";
}

/** Every send rejects (MAIL-AC-002). */
export function failingMailSender(): MailSender {
  return { send: () => Promise.reject(new TestSendError("the test mail sender fails every send")) };
}

/** No send ever settles (MAIL-AC-001, PWD-AC-005). */
export function neverCompletingMailSender(): MailSender {
  return { send: () => new Promise<void>(() => undefined) };
}
