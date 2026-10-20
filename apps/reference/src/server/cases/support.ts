import { FrameworkError, z } from "@lago-morph/prototype-framework";

/**
 * Helpers shared by C-T2's case sets. Every case takes `{ ns }`: a namespace chosen by the
 * test (random per run), so cases running at the same time on a shared stage never see each
 * other's rows or keys. Cases remove what they create.
 */
const nsInput = z.object({ ns: z.string().min(8).max(64) });

export function namespace(input: unknown): string {
  return nsInput.parse(input).ns;
}

/** What one operation did: its value, `undefined`, or the catalogue code it was rejected with. */
export type Outcome<T> = { readonly ok: T } | { readonly undefined: true } | { readonly code: string };

/**
 * Runs `fn` and records how it ended. A `FrameworkError` is recorded by its code; any other
 * error is recorded as `not-a-framework-error: <name>`, which no expectation accepts
 * (SQL-REQ-006: driver errors must not reach app code).
 */
export async function outcome<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    const value = await fn();
    return value === undefined ? { undefined: true } : { ok: value };
  } catch (error) {
    if (error instanceof FrameworkError) return { code: error.code };
    return { code: `not-a-framework-error: ${error instanceof Error ? error.name : typeof error}` };
  }
}

/** Like `outcome`, for operations whose value is not part of the expectation. */
export async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  const o = await outcome(fn);
  return "code" in o ? o.code : "ok";
}

/** UTF-8 byte length. */
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `prefix` padded with `fill` (one code point) to exactly `bytes` UTF-8 bytes; throws when it cannot be. */
export function padToBytes(prefix: string, bytes: number, fill = "a"): string {
  const unit = utf8Length(fill);
  let out = prefix;
  while (utf8Length(out) + unit <= bytes) out += fill;
  while (utf8Length(out) < bytes) out += "a";
  if (utf8Length(out) !== bytes) throw new Error(`cannot pad to ${String(bytes)} bytes`);
  return out;
}
