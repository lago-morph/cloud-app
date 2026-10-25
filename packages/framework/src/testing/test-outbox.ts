/**
 * `createTestApp`'s in-memory outbox (testing.d.ts `TestApp.mail`, `mailSender`; mail.md §2
 * "Senders"), and the two senders the framework's own tests select with
 * `mailSender: "failing" | "never-completing"`. Nothing is ever delivered. Test-only; never part
 * of a Worker bundle.
 *
 * A stand-in until MAIL's own outbox (`src/mail/outbox.ts`, item I-D) is merged; same behaviour.
 */
import type { MailInput, MailSender } from "../auth/password/mail.js";

/** testing.d.ts `MailMessage`. */
export interface MailMessage extends MailInput {
  readonly from: string;
  readonly sentAt: string;
}

/** testing.d.ts `TestMail`. */
export interface TestMail {
  lastTo(address: string): Promise<MailMessage | undefined>;
  all(): Promise<readonly MailMessage[]>;
}

export interface Outbox extends TestMail {
  readonly sender: MailSender;
}

/** The sender address where there is no account (DEC-0514). */
const LOCAL_SENDER = "no-reply@localhost";

export function createOutbox(options: { readonly senderName: string }): Outbox {
  const messages: MailMessage[] = [];
  const name = options.senderName.replace(/[\r\n"<>]/g, " ").replace(/\s+/g, " ").trim();
  const from = name === "" ? LOCAL_SENDER : `${name} <${LOCAL_SENDER}>`;
  return {
    sender: {
      send(input) {
        messages.push({ to: input.to, from, subject: input.subject, text: input.text, html: input.html, sentAt: new Date().toISOString() });
        return Promise.resolve();
      },
    },
    lastTo: (address) => Promise.resolve(messages.findLast((m) => m.to === address)),
    all: () => Promise.resolve([...messages]),
  };
}

/** Every send rejects, with a code as Email Service would give it. */
export function failingMailSender(): MailSender {
  return { send: () => Promise.reject(Object.assign(new Error("the test mail sender fails every send"), { code: "E_TEST_SEND_FAILED" })) };
}

/** No send ever settles. */
export function neverCompletingMailSender(): MailSender {
  return { send: () => new Promise<void>(() => undefined) };
}
