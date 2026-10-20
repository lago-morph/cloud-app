import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { children, parents } from "./server/evolution";
import { caseRoutes } from "./server/routes/cases";
import { errorRoutes } from "./server/routes/errors";
import { fileRoutes } from "./server/routes/files";
import { fixtureRoutes } from "./server/routes/fixture";
import { kvRoutes } from "./server/routes/kv";
import { levelRoutes } from "./server/routes/levels";
import { refRoutes } from "./server/routes/ref";
import { authors, blobs, posts, tags } from "./server/schema";

/** The compliance reference app (COMPL §2). Its routes are listed in ROUTES.md. */
export const app = defineApp({
  name: "reference",
  config,
  secrets,
  tables: { authors, posts, tags, blobs, parents, children },
  routes: (api) => {
    refRoutes(api);
    levelRoutes(api);
    errorRoutes(api);
    kvRoutes(api);
    fileRoutes(api);
    fixtureRoutes(api);
    caseRoutes(api);
  },
});

export default app;
