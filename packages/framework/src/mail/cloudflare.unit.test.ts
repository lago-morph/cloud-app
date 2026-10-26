/**
 * The production sender over Email Service's `send_email` binding (mail.md §2 "Senders";
 * DEC-0514): the address comes only from `FRAMEWORK_MAIL_FROM`. Unit evidence only.
 */
import { describe, expect, it } from "vitest";
import { emailServiceSender, MAIL_BINDINGS, MailNotConfiguredError, workerEmailSender, type EmailServiceBinding } from "./cloudflare.js";
import { mailErrorCode } from "./sender.js";

const FROM = "no-reply@mail.example.test";
const MESSAGE = { to: "someone@example.test", subject: "Verify", text: "t", html: "<p>h</p>" };

function fakeBinding(result: () => Promise<unknown> = async () => ({ messageId: "m-1" })): EmailServiceBinding & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    send: (message) => {
      calls.push(message);
      return result();
    },
  };
}

describe("emailServiceSender", () => {
  it("sends through the binding from the configured address with the display name", async () => {
    const binding = fakeBinding();
    await emailServiceSender({ binding, address: FROM, senderName: "Demo" }).send(MESSAGE);
    expect(binding.calls).toEqual([{ from: { name: "Demo", email: FROM }, to: MESSAGE.to, subject: "Verify", text: "t", html: "<p>h</p>" }]);
  });

  it("sends from the bare address when the display name is empty", async () => {
    const binding = fakeBinding();
    await emailServiceSender({ binding, address: FROM, senderName: "" }).send(MESSAGE);
    expect((binding.calls[0] as { from: unknown }).from).toBe(FROM);
  });

  it("passes on the binding's rejection, whose code MAIL logs", async () => {
    const binding = fakeBinding(() => Promise.reject(Object.assign(new Error("sender not verified"), { code: "E_SENDER_NOT_VERIFIED" })));
    const failure = await emailServiceSender({ binding, address: FROM, senderName: "Demo" }).send(MESSAGE).catch((e: unknown) => e);
    expect(mailErrorCode(failure)).toBe("E_SENDER_NOT_VERIFIED");
  });

  it("rejects without a binding or an address, naming neither an address nor a domain", async () => {
    await expect(emailServiceSender({ binding: undefined, address: FROM, senderName: "Demo" }).send(MESSAGE)).rejects.toThrow(MailNotConfiguredError);
    const noAddress = await emailServiceSender({ binding: fakeBinding(), address: undefined, senderName: "Demo" }).send(MESSAGE).catch((e: unknown) => e);
    expect(noAddress).toBeInstanceOf(MailNotConfiguredError);
    expect(String(noAddress)).toContain(MAIL_BINDINGS.from);
  });
});

describe("workerEmailSender", () => {
  it("reads the EMAIL binding and FRAMEWORK_MAIL_FROM from the Worker env", async () => {
    const binding = fakeBinding();
    await workerEmailSender({ [MAIL_BINDINGS.email]: binding, [MAIL_BINDINGS.from]: FROM }, "Demo").send(MESSAGE);
    expect(binding.calls).toHaveLength(1);
    await expect(workerEmailSender({ [MAIL_BINDINGS.from]: FROM }, "Demo").send(MESSAGE)).rejects.toThrow(/EMAIL/);
    await expect(workerEmailSender({ [MAIL_BINDINGS.email]: binding, [MAIL_BINDINGS.from]: "" }, "Demo").send(MESSAGE)).rejects.toThrow(/FRAMEWORK_MAIL_FROM/);
  });
});
