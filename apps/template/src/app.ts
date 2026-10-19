import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { adminRoutes } from "./server/routes/admin";
import { fileRoutes } from "./server/routes/files";
import { helloRoutes } from "./server/routes/hello";
import { noteRoutes } from "./server/routes/notes";
import { statusRoutes } from "./server/routes/status";
import { notes } from "./server/schema";

export const app = defineApp({
  name: "template",
  config,
  secrets,
  tables: { notes },
  routes: (api) => {
    helloRoutes(api);
    noteRoutes(api);
    statusRoutes(api);
    fileRoutes(api);
    adminRoutes(api);
  },
});

export default app;
