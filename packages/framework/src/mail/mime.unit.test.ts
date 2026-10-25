/** The sink reader's MIME parsing (mail.md §2 "Reading mail"). No network. */
import { describe, expect, it } from "vitest";
import { decodeHeader, parseMime, sinkMailMessage } from "./mime.js";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** A message shaped like an Email Service delivery forwarded by Email Routing (extra trace headers, nested multipart). */
const DELIVERED = [
  "Received: from mail.example.test by mx.example.test; Sun, 25 Oct 2026 10:00:02 +0000",
  "ARC-Seal: i=1; a=rsa-sha256; d=example.test;",
  "\tcv=none; b=AAAA",
  `From: =?utf-8?B?${b64("Démo")}?= <no-reply@example.test>`,
  "To: <sink+run1@t.example.test>",
  "Subject: =?utf-8?Q?V=C3=A9rifiez?= =?utf-8?Q?_votre_adresse?=",
  "Date: Sun, 25 Oct 2026 10:00:01 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="outer"',
  "",
  "This is a multi-part message in MIME format.",
  "--outer",
  "Content-Type: multipart/alternative; boundary=inner",
  "",
  "--inner",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Bonjour Ren=C3=A9, open https://notes-prod.example.test/api/auth/password/verify?token=3Dabc=",
  "def to verify.",
  "--inner",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  ...(b64('<p>Bonjour René, <a href="https://notes-prod.example.test/api/auth/password/verify?token=abcdef">verify</a></p>').match(/.{1,76}/g) ?? []),
  "--inner--",
  "--outer",
  "Content-Type: text/plain",
  "Content-Disposition: attachment; filename=x.txt",
  "",
  "not the body",
  "--outer--",
  "",
].join("\r\n");

describe("parseMime", () => {
  it("reads the headers, folded lines and encoded words, and the first text and html parts of nested multiparts", () => {
    const parsed = parseMime(DELIVERED);
    expect(parsed.from).toBe("Démo <no-reply@example.test>");
    expect(parsed.to).toBe("sink+run1@t.example.test");
    expect(parsed.subject).toBe("Vérifiez votre adresse");
    expect(parsed.date).toBe("2026-10-25T10:00:01.000Z");
    expect(parsed.text).toBe("Bonjour René, open https://notes-prod.example.test/api/auth/password/verify?token=abcdef to verify.");
    expect(parsed.html).toBe('<p>Bonjour René, <a href="https://notes-prod.example.test/api/auth/password/verify?token=abcdef">verify</a></p>');
  });

  it("a single-part message, 8-bit text and a missing part", () => {
    const parsed = parseMime(["From: no-reply@example.test", "Subject: Reset", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", "Réinitialiser: https://x.example.test/r", ""].join("\n"));
    expect(parsed).toEqual({ from: "no-reply@example.test", to: "", subject: "Reset", text: "Réinitialiser: https://x.example.test/r\n", html: "" });
  });

  it("decodes Q and B encoded words in other charsets", () => {
    expect(decodeHeader("=?iso-8859-1?Q?caf=E9?=")).toBe("café");
    expect(decodeHeader(`plain =?UTF-8?b?${b64("✓ ok")}?= end`)).toBe("plain ✓ ok end");
  });
});

describe("sinkMailMessage", () => {
  it("is testing.d.ts's MailMessage: the stored recipient, and the Date header or else the sink's time", () => {
    expect(sinkMailMessage(DELIVERED, "sink+run1@t.example.test", "2026-10-25T10:00:03.000Z")).toEqual({
      to: "sink+run1@t.example.test",
      from: "Démo <no-reply@example.test>",
      subject: "Vérifiez votre adresse",
      text: expect.stringContaining("token=abcdef"),
      html: expect.stringContaining("token=abcdef"),
      sentAt: "2026-10-25T10:00:01.000Z",
    });
    expect(sinkMailMessage("Subject: x\n\nbody", "a@t.example.test", "2026-10-25T10:00:03.000Z").sentAt).toBe("2026-10-25T10:00:03.000Z");
  });
});
