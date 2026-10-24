/** What every command gets from its process, and the exit statuses (CLI-REQ-003). */

/** What a command may use of its process: output streams, standard input, the app directory. */
export interface CliIo {
  /** The app directory (the working directory). */
  readonly cwd: string;
  stdout(text: string): void;
  stderr(text: string): void;
  readonly stdin: AsyncIterable<string | Uint8Array>;
}

/** 0 success, 1 failure (including partial failures), 2 usage error. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

/** One command: its arguments after the command name, and the process's io. Resolves to the exit status. */
export type Command = (args: readonly string[], io: CliIo) => Promise<number>;
