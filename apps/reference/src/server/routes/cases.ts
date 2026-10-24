import { FrameworkError, jsonBody, requireUser, z } from "@lago-morph/prototype-framework";
import { caseSets } from "../case-registry";
import type { CaseSets } from "../case-types";
import type { Api } from "../env";

const runBody = z.object({ set: z.string(), name: z.string(), input: z.unknown().optional() });

/** Runs the shared case sets through HTTP (ROUTES.md "Shared case sets"). */
export function caseRoutes(api: Api, sets: CaseSets = caseSets): void {
  api.get("/cases", requireUser(), (c) => c.json({ sets: Object.fromEntries(Object.entries(sets).map(([set, cases]) => [set, Object.keys(cases)])) }));

  api.post("/cases/run", requireUser(), jsonBody(runBody), async (c) => {
    const { set, name, input } = c.req.valid("json");
    const run = Object.entries(Object.entries(sets).find(([s]) => s === set)?.[1] ?? {}).find(([n]) => n === name)?.[1];
    if (run === undefined) throw new FrameworkError("HTTP.NOT_FOUND", `no case ${set}/${name}`);
    const { sql, kv, files, log } = c.var;
    const value = await run({ sql, kv, files, log }, input);
    return c.json(value === undefined ? { outcome: "undefined" } : { outcome: "value", value });
  });
}
