import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { children, parents } from "./server/evolution";
import { errorRoutes } from "./server/routes/errors";
import { fileRoutes } from "./server/routes/files";
import { kvRoutes } from "./server/routes/kv";
import { levelRoutes } from "./server/routes/levels";
import { refRoutes } from "./server/routes/ref";
import { authors, blobs, posts, tags } from "./server/schema";

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
  },
});

export default app;
