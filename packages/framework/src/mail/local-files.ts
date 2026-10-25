/**
 * The app's `.mail/` directory on disk (mail.md §2 "Local `dev`", "Reading mail"; MAIL-AC-003):
 * `dev` writes captured messages there, and `mail last` and a local `connectTestStage` read them
 * back. Node only; never part of a Worker bundle.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createMailCapture, latestMailTo, MAIL_DIR } from "./capture.js";
import type { MailFile } from "./local.js";
import { LOCAL_SENDER_ADDRESS, type MailMessage } from "./sender.js";

/** A line handler for `dev`: mail lines become `<appDir>/.mail/<timestamp>-<id>.json`, others go to `other`. */
export function createDevMailCapture(appDir: string, other: (line: string) => void): (line: string) => void {
  return createMailCapture({
    write(path, text) {
      const file = join(appDir, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    },
    other,
  });
}

/** The latest message to `address` in `<appDir>/.mail/`, or undefined. */
export function latestLocalMail(appDir: string, address: string): MailFile | undefined {
  const dir = join(appDir, MAIL_DIR);
  if (!existsSync(dir)) return undefined;
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => ({ name: e.name, content: readFileSync(join(dir, e.name), "utf8") }));
  return latestMailTo(files, address);
}

/**
 * A `.mail/` file as testing.d.ts's `MailMessage`. The file holds no sender (mail.md §2), so
 * `from` is the local sender address without the display name.
 */
export function asMailMessage(file: MailFile): MailMessage {
  return { to: file.to, from: LOCAL_SENDER_ADDRESS, subject: file.subject, text: file.text, html: file.html, sentAt: file.time };
}
