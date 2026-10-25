/**
 * The production-stage sender on Cloudflare (mail.md §2 "Senders"; MAIL-REQ-002, MAIL-REQ-003,
 * DEC-0514, DEC-0518): Email Service's `send_email` binding `EMAIL`, sending from the address in
 * the Worker variable `FRAMEWORK_MAIL_FROM`, which `deploy` derives from the account settings
 * record (`no-reply@<emailDomain>`). No address or domain is written here. A missing binding or
 * variable rejects the send (logged as `mail send failed: unknown` by `withFailureLog`); it never
 * fails the request. Workers-compatible.
 */
import type { RuntimeEnv } from "../core/assemble.js";
import { cleanDisplayName, type MailSender } from "./sender.js";

/** The Worker binding and variable names (cloudflare.md §2). */
export const MAIL_BINDINGS = Object.freeze({
  /** Email Service `send_email` binding; production stages only. */
  email: "EMAIL",
  /** The sender address, set by `deploy` from the account settings record. */
  from: "FRAMEWORK_MAIL_FROM",
} as const);

/** The part of Email Service's `SendEmail` binding the sender uses (workers-types `EmailMessageBuilder`). */
export interface EmailServiceBinding {
  send(message: {
    readonly from: { readonly name: string; readonly email: string } | string;
    readonly to: string;
    readonly subject: string;
    readonly text: string;
    readonly html: string;
  }): Promise<unknown>;
}

/** The sender address from the Worker variable, or undefined when unset. */
export function workerMailFrom(env: RuntimeEnv["Bindings"]): string | undefined {
  const value = env[MAIL_BINDINGS.from];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** The `EMAIL` binding, or undefined when the Worker has none. */
export function workerEmailBinding(env: RuntimeEnv["Bindings"]): EmailServiceBinding | undefined {
  const value = env[MAIL_BINDINGS.email] as Partial<EmailServiceBinding> | undefined | null;
  return value !== undefined && value !== null && typeof value.send === "function" ? (value as EmailServiceBinding) : undefined;
}

/** Thrown when the Worker is missing its binding or sender variable; its message names neither address nor domain. */
export class MailNotConfiguredError extends Error {
  override readonly name = "MailNotConfiguredError";
}

export interface EmailServiceSenderOptions {
  readonly binding: EmailServiceBinding | undefined;
  /** `FRAMEWORK_MAIL_FROM`. */
  readonly address: string | undefined;
  /** `framework.email.senderName`, defaulting to the app name. */
  readonly senderName: string;
}

export function emailServiceSender(options: EmailServiceSenderOptions): MailSender {
  return {
    async send(message) {
      const { binding, address } = options;
      if (binding === undefined) throw new MailNotConfiguredError(`the Worker has no ${MAIL_BINDINGS.email} binding`);
      if (address === undefined) throw new MailNotConfiguredError(`the Worker variable ${MAIL_BINDINGS.from} is not set`);
      const name = cleanDisplayName(options.senderName);
      await binding.send({
        from: name === "" ? address : { name, email: address },
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

/** The sender for a production Worker's `env`. */
export function workerEmailSender(env: RuntimeEnv["Bindings"], senderName: string): MailSender {
  return emailServiceSender({ binding: workerEmailBinding(env), address: workerMailFrom(env), senderName });
}
