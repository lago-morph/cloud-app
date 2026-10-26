/**
 * The local `dev` capture: the Worker's marked mail lines and `dev`'s `.mail/<timestamp>-<id>.json`
 * files (mail.md §2 "Local `dev`"; MAIL-REQ-002). Unit evidence only.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMailCapture, fileTimestamp, latestMailTo, mailFilePath, parseMailLine } from "./capture.js";
import { asMailMessage, createDevMailCapture, latestLocalMail } from "./local-files.js";
import { formatMailLine, MAIL_LINE_MARKER, workerOutputMailSender } from "./local.js";

const TO = "someone@example.test";
const MESSAGE = { to: TO, subject: "Verify", text: "Open\nthe link", html: "<p>Open</p>" };
const AT = new Date("2026-10-25T10:11:12.123Z");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mail-capture-"));
  dirs.push(dir);
  return dir;
}

async function workerLines(count = 1, at = AT): Promise<string[]> {
  const lines: string[] = [];
  const sender = workerOutputMailSender({ senderName: "Demo", print: (l) => void lines.push(l), now: () => at });
  for (let i = 0; i < count; i++) await sender.send(MESSAGE);
  return lines;
}

describe("the local Worker's sender", () => {
  it("prints one marked line per message with line breaks escaped", async () => {
    const lines = await workerLines(2);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.startsWith(MAIL_LINE_MARKER)).toBe(true);
      expect(line).not.toContain("\n");
    }
    const parsed = parseMailLine(lines[0] ?? "");
    expect(parsed?.message).toEqual({ ...MESSAGE, time: AT.toISOString() });
    expect(parsed?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(parseMailLine(lines[1] ?? "")?.id).not.toBe(parsed?.id);
  });
});

describe("parseMailLine", () => {
  it("finds the marker after a prefix (Wrangler may prefix Worker output)", async () => {
    const [line] = await workerLines();
    expect(parseMailLine(`[wrangler:info] ${line ?? ""}`)?.message.to).toBe(TO);
  });

  it("ignores ordinary lines, log lines and malformed mail lines", () => {
    expect(parseMailLine("Ready on http://127.0.0.1:8787")).toBeUndefined();
    expect(parseMailLine('[prototype-framework:log] {"time":"x"}')).toBeUndefined();
    expect(parseMailLine(`${MAIL_LINE_MARKER}{not json`)).toBeUndefined();
    expect(parseMailLine(`${MAIL_LINE_MARKER}${JSON.stringify({ id: "../x", message: { ...MESSAGE, time: AT.toISOString() } })}`)).toBeUndefined();
    expect(parseMailLine(`${MAIL_LINE_MARKER}${JSON.stringify({ id: "ab", message: { to: TO } })}`)).toBeUndefined();
  });
});

describe("file names", () => {
  it("are .mail/<sortable UTC timestamp>-<id>.json", () => {
    expect(fileTimestamp(AT.toISOString())).toBe("20261025T101112123Z");
    expect(mailFilePath({ id: "abc123", message: { ...MESSAGE, time: AT.toISOString() } })).toBe(".mail/20261025T101112123Z-abc123.json");
  });
});

describe("createMailCapture", () => {
  it("writes mail lines as files and passes every other line on", async () => {
    const written: [string, string][] = [];
    const other: string[] = [];
    const handle = createMailCapture({ write: (p, t) => void written.push([p, t]), other: (l) => void other.push(l) });
    const [line] = await workerLines();
    handle("starting");
    handle(line ?? "");
    expect(other).toEqual(["starting"]);
    expect(written).toHaveLength(1);
    expect(written[0]?.[0]).toMatch(/^\.mail\/20261025T101112123Z-[0-9a-f]{16}\.json$/);
    expect(JSON.parse(written[0]?.[1] ?? "")).toEqual({ ...MESSAGE, time: AT.toISOString() });
  });
});

describe("the app's .mail/ directory", () => {
  it("dev's capture writes one file per message, and latestLocalMail reads the latest to an address", async () => {
    const app = tempDir();
    const other: string[] = [];
    const handle = createDevMailCapture(app, (l) => void other.push(l));
    for (const line of await workerLines(1, new Date("2026-10-25T10:00:00.000Z"))) handle(line);
    const later = workerOutputMailSender({ senderName: "Demo", print: handle, now: () => new Date("2026-10-25T11:00:00.000Z") });
    await later.send({ ...MESSAGE, subject: "Reset" });
    await later.send({ ...MESSAGE, to: "other@example.test", subject: "Other" });
    expect(readdirSync(join(app, ".mail"))).toHaveLength(3);
    expect(other).toEqual([]);
    const latest = latestLocalMail(app, TO);
    expect(latest?.subject).toBe("Reset");
    expect(latest === undefined ? undefined : asMailMessage(latest)).toEqual({ ...MESSAGE, subject: "Reset", from: "no-reply@localhost", sentAt: "2026-10-25T11:00:00.000Z" });
    expect(latestLocalMail(app, "nobody@example.test")).toBeUndefined();
  });

  it("latestLocalMail is undefined without .mail/, and ignores files that are not captured mail", () => {
    const app = tempDir();
    expect(latestLocalMail(app, TO)).toBeUndefined();
    mkdirSync(join(app, ".mail"));
    writeFileSync(join(app, ".mail", "notes.json"), JSON.stringify({ ...MESSAGE, time: AT.toISOString() }));
    writeFileSync(join(app, ".mail", "20261025T101112123Z-ab.json"), "{broken");
    expect(latestLocalMail(app, TO)).toBeUndefined();
    expect(readFileSync(join(app, ".mail", "notes.json"), "utf8")).toContain(TO);
  });

  it("latestMailTo breaks a time tie by file name", () => {
    const content = (subject: string) => JSON.stringify({ ...MESSAGE, subject, time: AT.toISOString() });
    const files = [
      { name: "20261025T101112123Z-bb.json", content: content("second") },
      { name: "20261025T101112123Z-aa.json", content: content("first") },
    ];
    expect(latestMailTo(files, TO)?.subject).toBe("second");
  });

  it("formatMailLine round-trips through parseMailLine", () => {
    const line = { id: "0f", message: { ...MESSAGE, time: AT.toISOString() } };
    expect(parseMailLine(formatMailLine(line))).toEqual(line);
  });
});
