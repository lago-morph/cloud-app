import type { z } from "@lago-morph/prototype-framework";
import fc from "fast-check";

/**
 * A small fuzz helper for a JSON route, driven by the route's own zod schema (the skill's
 * reference/testing/fuzzing.md). Use it only on a route whose input sits at a trust boundary and
 * whose example tests keep missing cases, never on every route. It sends generated bodies, any
 * JSON value and changed copies of valid examples, and checks each answer against the schema:
 * - never a server error (5xx);
 * - a body the schema refuses gets 400 `HTTP.INVALID_INPUT`;
 * - a body the schema accepts never gets `HTTP.INVALID_INPUT` (the route's own rules may still
 *   refuse it, for example with 404 or 409).
 * A failure names the seed and the smallest failing body; add that body as a plain example test.
 */

/** What the helper needs from a test app: `createTestApp`'s `request`. */
export interface Requester {
  request(path: string, init?: RequestInit): Promise<Response>;
}

export interface FuzzJsonRouteOptions {
  /** The route's path, with `/api`. */
  readonly path: string;
  /** Default POST. */
  readonly method?: "POST" | "PUT" | "PATCH";
  /** The schema the route passes to `jsonBody(…)`. */
  readonly schema: z.ZodType;
  /** At least one body the schema accepts; generated bodies change these. */
  readonly examples: readonly [unknown, ...unknown[]];
  /** Runs and fixed seed: state both at the call, with a one-line reason. Keep runs small. */
  readonly numRuns: number;
  readonly seed: number;
}

/** A value for one field: any JSON value, or a string near the usual length limits. */
const fieldValue: fc.Arbitrary<unknown> = fc.oneof(
  fc.jsonValue(),
  fc.string({ unit: "grapheme", maxLength: 600 }),
  fc.nat({ max: 600 }).map((n) => " ".repeat(n)),
  fc.constantFrom("", " ", "\u00a0", "\u200b", "a".repeat(500), "a".repeat(501)),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A copy of `example` with one field replaced, removed or added; other values unchanged. */
function changed(example: unknown): fc.Arbitrary<unknown> {
  if (!isRecord(example)) return fc.oneof(fc.constant(example), fieldValue);
  const keys = Object.keys(example);
  const replaced = fc.tuple(fc.constantFrom(...keys, "extra"), fieldValue).map(([key, value]) => ({ ...example, [key]: value }));
  if (keys.length === 0) return replaced;
  const removed = fc.constantFrom(...keys).map((key) => Object.fromEntries(Object.entries(example).filter(([k]) => k !== key)));
  return fc.oneof(replaced, removed);
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body: { error?: { code?: string } } = await res.json();
    return body.error?.code;
  } catch {
    return undefined;
  }
}

export async function fuzzJsonRoute(app: Requester, options: FuzzJsonRouteOptions): Promise<void> {
  const { path, method = "POST", schema, examples, numRuns, seed } = options;
  // A wrong example would leave the "never INVALID_INPUT for an accepted body" check untested.
  for (const example of examples) {
    if (!(await schema.safeParseAsync(example)).success) throw new Error(`fuzzJsonRoute: the example ${JSON.stringify(example)} is refused by the schema; give bodies it accepts`);
  }
  const body = fc.oneof(fc.constantFrom(...examples), fc.constantFrom(...examples).chain(changed), fc.jsonValue());
  await fc.assert(
    fc.asyncProperty(body, async (value) => {
      const sent = JSON.stringify(value);
      // The route sees what JSON.parse gives back, so judge that, not the generated value.
      const accepted = (await schema.safeParseAsync(JSON.parse(sent))).success;
      const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: sent });
      if (res.status >= 500) throw new Error(`${method} ${path} answered ${String(res.status)} for ${sent}`);
      const code = await errorCode(res);
      if (!accepted && !(res.status === 400 && code === "HTTP.INVALID_INPUT")) {
        throw new Error(`${method} ${path} answered ${String(res.status)} ${code ?? ""} for a body the schema refuses: ${sent}`);
      }
      if (accepted && code === "HTTP.INVALID_INPUT") throw new Error(`${method} ${path} answered HTTP.INVALID_INPUT for a body the schema accepts: ${sent}`);
    }),
    { numRuns, seed, includeErrorInReport: true },
  );
}
