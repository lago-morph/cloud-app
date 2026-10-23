/** An in-memory `CliIo` for unit tests: collects stdout and stderr, feeds the given stdin chunks. */
import type { CliIo } from "./io.js";

export function captureIo(cwd = "/app", stdin: readonly string[] = []): CliIo & { out: string; err: string } {
  const io = {
    cwd,
    out: "",
    err: "",
    stdout(text: string) {
      io.out += text;
    },
    stderr(text: string) {
      io.err += text;
    },
    stdin: (async function* () {
      for (const s of stdin) yield s;
    })(),
  };
  return io;
}
