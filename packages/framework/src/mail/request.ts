/**
 * The stage's mail sender for one request, as framework code (PWD) reaches it (mail.md §2). The
 * stage runtime binds the target's sender factory to each request it serves (`bindRequestMail`);
 * `requestMail` returns that request's sender, wrapped so that a send runs in the request's
 * `waitUntil` and a failure is logged without the address (MAIL-REQ-001). Never app-facing.
 * Workers-compatible.
 */
import type { RuntimeContext } from "../core/assemble.js";
import { backgroundTasksOf, sendInBackground, type MailInput, type MailSender } from "./sender.js";

const factories = new WeakMap<Request, () => MailSender>();

/** Binds `factory` (called at most once, on the first send) to the request of `c`. */
export function bindRequestMail(c: RuntimeContext, factory: (c: RuntimeContext) => MailSender): void {
  let sender: MailSender | undefined;
  factories.set(c.req.raw, () => (sender ??= factory(c)));
}

/** The raw sender bound to this request, or undefined when the stage has none. */
export function requestMailSender(c: RuntimeContext): MailSender | undefined {
  return factories.get(c.req.raw)?.();
}

/**
 * Sends `message` after the response through this request's sender (MAIL-REQ-001). Returns at
 * once; never throws for a failed send. Throws only when the stage has no sender (a wiring bug).
 */
export function sendRequestMail(c: RuntimeContext, message: MailInput): void {
  const sender = requestMailSender(c);
  if (sender === undefined) throw new Error("this stage has no mail sender");
  sendInBackground(backgroundTasksOf(c), sender, c.var.log, message);
}
