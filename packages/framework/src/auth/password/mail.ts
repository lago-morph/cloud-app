/**
 * PWD's three messages (password.md §2 "Mail"; MAIL-REQ-004) and how they are handed to MAIL.
 *
 * - Links are built from the deployment's resolved public origin, never from request headers,
 *   and point at the framework's GET pages (`/api/auth/verify?token=`, `/api/auth/reset?token=`),
 *   whose button POSTs, so mail scanners cannot use a token up. BA's own link URLs are not used.
 * - A message holds only fixed text, the display name the person entered, and the link: never a
 *   password, a secret or the user ID.
 * - Sends run in the request's `waitUntil` (MAIL-REQ-001) and never reject: a failed send is one
 *   `MAIL` error entry naming the provider's error code, never the address.
 *
 * `MailInput` and `MailSender` are MAIL's sender interface (mail.md §2 "Interface"), structurally;
 * `src/mail/sender.ts` (I-D) declares the same shapes.
 */
import type { LogService } from "../../log/public.js";
import { RESET_LINK_SECONDS, VERIFICATION_LINK_SECONDS } from "./options.js";

/** What a caller asks MAIL to send. */
export interface MailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** MAIL's sender interface. */
export interface MailSender {
  send(message: MailInput): Promise<void>;
}

export type PasswordMailKind = "verification" | "reset" | "existing";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** The page links in mail (internal/auth-password.openapi.yaml). */
export function mailLink(publicOrigin: string, page: "verify" | "reset" | "forgot", token?: string): string {
  const url = new URL(`/api/auth/${page}`, new URL(publicOrigin).origin);
  if (token !== undefined) url.searchParams.set("token", token);
  return url.toString();
}

function hours(seconds: number): string {
  const n = Math.round(seconds / 3600);
  return n === 1 ? "1 hour" : `${n} hours`;
}

const CONTENT: Record<PasswordMailKind, { readonly subject: string; readonly lead: string; readonly action: string; readonly tail: string }> = {
  verification: {
    subject: "Confirm your email address",
    lead: "Please confirm your email address to finish creating your account.",
    action: "Confirm my email address",
    tail: `The link is valid for ${hours(VERIFICATION_LINK_SECONDS)}. If you did not create an account, ignore this message.`,
  },
  reset: {
    subject: "Reset your password",
    lead: "Someone asked to reset the password of your account.",
    action: "Choose a new password",
    tail: `The link is valid for ${hours(RESET_LINK_SECONDS)} and works once. If you did not ask for this, ignore this message; your password stays as it is.`,
  },
  existing: {
    subject: "Someone tried to register with your email address",
    lead: "Someone tried to create an account with your email address, but you already have one.",
    action: "Reset my password",
    tail: "If this was you and you have forgotten your password, use the link to reset it. Otherwise ignore this message.",
  },
};

/** One message to `to`, greeting `displayName`, with `link`. */
export function passwordMessage(kind: PasswordMailKind, to: string, displayName: string, link: string): MailInput {
  const c = CONTENT[kind];
  const text = `Hello ${displayName},\n\n${c.lead}\n\n${c.action}: ${link}\n\n${c.tail}\n`;
  const html =
    `<p>Hello ${escapeHtml(displayName)},</p>` +
    `<p>${escapeHtml(c.lead)}</p>` +
    `<p><a href="${escapeHtml(link)}">${escapeHtml(c.action)}</a></p>` +
    `<p>${escapeHtml(c.tail)}</p>`;
  return { to, subject: c.subject, text, html };
}

/** Only codes of this shape are logged (Email Service's `E_SENDER_NOT_VERIFIED`, ...). */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** Starts `message` in the background; a rejection becomes one `MAIL` entry without the address. */
export function sendLater(waitUntil: (work: Promise<unknown>) => void, sender: MailSender, log: LogService, message: MailInput): void {
  let pending: Promise<void>;
  try {
    pending = sender.send(message);
  } catch (thrown) {
    pending = Promise.reject(thrown);
  }
  const settled = pending.catch((thrown: unknown) => {
    const code = typeof thrown === "object" && thrown !== null ? (thrown as { code?: unknown }).code : undefined;
    log.write("MAIL", "error", `mail send failed: ${typeof code === "string" && ERROR_CODE.test(code) ? code : "unknown"}`);
  });
  try {
    waitUntil(settled);
  } catch {
    // No usable background-task mechanism: the send still runs to completion on its own.
  }
}
