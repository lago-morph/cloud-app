/**
 * `reset-local` (CLI-REQ-001, LOCAL-REQ-002): clears the local state `dev` persists — local D1
 * (SQL and KV) and R2 under Wrangler's `.wrangler/`, the local log `.logs/` and the captured mail
 * `.mail/` (MAIL). Sources, configuration, migrations and `.dev.vars` (the owner's local
 * secrets) are kept.
 */
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseOptions } from "../args.js";
import { EXIT, type Command } from "../io.js";

/** App-relative directories `reset-local` removes. */
export const LOCAL_STATE_DIRS: readonly string[] = [".wrangler", ".logs", ".mail"];

export function resetLocalCommand(): Command {
  return async (args, io) => {
    parseOptions(args, []);
    const removed = LOCAL_STATE_DIRS.filter((d) => existsSync(join(io.cwd, d)));
    for (const d of removed) rmSync(join(io.cwd, d), { recursive: true, force: true });
    io.stdout(removed.length === 0 ? "no local state to clear\n" : `cleared local state: ${removed.map((d) => `${d}/`).join(", ")}\n`);
    return EXIT.ok;
  };
}
