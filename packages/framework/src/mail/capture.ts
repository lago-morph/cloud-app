/**
 * Reading the local Worker's marked mail lines (mail.md §2 "Local `dev`"; MAIL-REQ-002). The
 * CLI's `dev` command feeds Wrangler's output through `createMailCapture` and supplies the file
 * write; `mail last` reads the files back (`latestMailTo`). This module does no I/O.
 */
import { MAIL_LINE_MARKER, type MailFile, type MailLine } from "./local.js";

/** The app-relative directory of captured mail (git-ignored). */
export const MAIL_DIR = ".mail";

const ID = /^[0-9a-f]{1,64}$/;

function isString(v: unknown): v is string {
  return typeof v === "string";
}

export function isMailFile(value: unknown): value is MailFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isString(v.to) && isString(v.from) && isString(v.subject) && isString(v.text) && isString(v.html) && isString(v.time) && !Number.isNaN(Date.parse(v.time));
}

/** The message in a marked output line, or undefined for any other line. */
export function parseMailLine(line: string): MailLine | undefined {
  const at = line.indexOf(MAIL_LINE_MARKER);
  if (at < 0) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line.slice(at + MAIL_LINE_MARKER.length).trimEnd());
  } catch {
    return undefined;
  }
  const v = value as { id?: unknown; message?: unknown } | null;
  if (typeof v !== "object" || v === null || !isString(v.id) || !ID.test(v.id) || !isMailFile(v.message)) return undefined;
  const { to, from, subject, text, html, time } = v.message;
  return { id: v.id, message: { to, from, subject, text, html, time } };
}

/** `20261025T101112123Z`: the message time, safe in a file name and sorting like the time. */
export function fileTimestamp(time: string): string {
  return new Date(time).toISOString().replace(/[-:.]/g, "");
}

/** The app-relative file of one captured message: `.mail/<timestamp>-<id>.json`. */
export function mailFilePath(line: MailLine): string {
  return `${MAIL_DIR}/${fileTimestamp(line.message.time)}-${line.id}.json`;
}

export interface MailCaptureIo {
  /** Writes `text` to the app-relative file `path` (creating `.mail/` as needed). */
  write(path: string, text: string): void;
  /** Receives every line that is not a mail line. */
  other(line: string): void;
}

/** A line handler: mail lines become files, every other line is passed on. */
export function createMailCapture(io: MailCaptureIo): (line: string) => void {
  return (line) => {
    const parsed = parseMailLine(line);
    if (parsed === undefined) io.other(line);
    else io.write(mailFilePath(parsed), `${JSON.stringify(parsed.message, null, 2)}\n`);
  };
}

/** The file name pattern of captured mail. */
const MAIL_FILE = /^\d{8}T\d{9}Z-[0-9a-f]+\.json$/;

/**
 * The latest captured message to `address` among `files` (name and content of each file in
 * `.mail/`), by message time, then file name. Files that are not captured mail are ignored.
 */
export function latestMailTo(files: Iterable<{ readonly name: string; readonly content: string }>, address: string): MailFile | undefined {
  let best: { name: string; file: MailFile } | undefined;
  for (const { name, content } of files) {
    if (!MAIL_FILE.test(name)) continue;
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      continue;
    }
    if (!isMailFile(value) || value.to !== address) continue;
    const later = best === undefined || value.time > best.file.time || (value.time === best.file.time && name > best.name);
    if (later) best = { name, file: value };
  }
  return best?.file;
}
