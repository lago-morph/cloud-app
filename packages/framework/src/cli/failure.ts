/** A failure's text for the owner: its message only (no stack; no argument is ever echoed). */
export function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
