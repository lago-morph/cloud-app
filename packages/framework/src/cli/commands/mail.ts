/**
 * `mail last --to <address> [--target local|cloudflare]` (cli.md §2; mail.md §2 "Reading mail";
 * MAIL-AC-003): prints the latest framework email sent to an address as JSON. Locally (the
 * default) it reads the app's `.mail/`, which `dev` writes. On Cloudflare it reads the account's
 * mail sink, for an address under `t.<emailDomain>` only; that reader is part of the sink's
 * provisioning and is passed in as `cloud`. Exit 1 when there is no such message.
 */
import { parseOptions, UsageError } from "../args.js";
import { EXIT, type Command } from "../io.js";
import { latestLocalMail } from "../../mail/local-files.js";

export interface MailCommandDeps {
  /** The latest message in the Cloudflare mail sink to `address` (mail.md §2), when available. */
  readonly cloud?: (address: string, cwd: string) => Promise<unknown>;
}

export function mailCommand(deps: MailCommandDeps = {}): Command {
  return async (args, io) => {
    const [action, ...rest] = args;
    if (action !== "last") throw new UsageError("usage: mail last --to <address> [--target local|cloudflare]");
    const options = parseOptions(rest, ["to", "target"]);
    const to = options.get("to");
    if (to === undefined) throw new UsageError("--to is missing");
    const target = options.get("target") ?? "local";
    if (target !== "local" && target !== "cloudflare") throw new UsageError("--target must be one of: local, cloudflare");
    let message: unknown;
    if (target === "local") {
      message = latestLocalMail(io.cwd, to);
    } else {
      if (deps.cloud === undefined) {
        io.stderr("mail: reading the Cloudflare mail sink is not available in this version of the framework\n");
        return EXIT.failed;
      }
      message = await deps.cloud(to, io.cwd);
    }
    if (message === undefined) {
      io.stderr(target === "local" ? "mail: no captured message to that address in .mail/\n" : "mail: no message to that address in the mail sink\n");
      return EXIT.failed;
    }
    io.stdout(`${JSON.stringify(message, null, 2)}\n`);
    return EXIT.ok;
  };
}
