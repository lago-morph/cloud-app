import { FrameworkError, requireUser } from "@lago-morph/prototype-framework";
import type { FileDump, FixtureDump } from "../../shared/types";
import { readAll, sha256Hex } from "../encoding";
import type { Api } from "../env";
import { dumpEvolution, evolutionLoaded, loadEvolution, SCHEMA_VERSION } from "../evolution";
import { FIXTURE_CHILDREN, FIXTURE_FILES, FIXTURE_PARENTS } from "../fixture-data";

const FIXTURE_PREFIX = "fixture/";

/** The migration data fixture (ROUTES.md "Migration data fixture"). */
export function fixtureRoutes(api: Api): void {
  api.post("/fixture/load", requireUser(), async (c) => {
    if (await evolutionLoaded(c.var.sql)) throw new FrameworkError("HTTP.CONFLICT", "the data fixture is already loaded");
    await loadEvolution(c.var.sql, FIXTURE_PARENTS, FIXTURE_CHILDREN);
    for (const f of FIXTURE_FILES) await c.var.files.put(f.name, f.bytes(), { contentType: f.contentType });
    return c.json({ parents: FIXTURE_PARENTS.length, children: FIXTURE_CHILDREN.length, files: FIXTURE_FILES.length }, 201);
  });

  api.get("/fixture/dump", requireUser(), async (c) => {
    const rows = await dumpEvolution(c.var.sql);
    const files: FileDump[] = [];
    const page = await c.var.files.list(FIXTURE_PREFIX);
    for (const info of page.items) {
      const content = await c.var.files.get(info.name);
      if (content === null) continue;
      files.push({ name: info.name, size: info.size, contentType: info.contentType, sha256: await sha256Hex(await readAll(content.body)) });
    }
    const body: FixtureDump = { version: SCHEMA_VERSION, parents: rows.parents, children: rows.children, files };
    return c.json(body);
  });
}
