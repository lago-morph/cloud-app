/**
 * `dev`'s side of the local log (LOG-REQ-003, DEC-0066): Wrangler's output goes through LOG's
 * `createLogCapture`; marked entries are appended to `<app>/.logs/<UTC day>.log`, every other
 * line is passed on.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createLogCapture, type LogCapture } from "../../log/capture.js";

export function createDevLogCapture(appDir: string, other: (line: string) => void): LogCapture {
  return createLogCapture({
    append(path, text) {
      const file = join(appDir, path);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, text);
    },
    other,
  });
}
