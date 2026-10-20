import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { photoRoutes } from "./server/routes/photos";
import { postRoutes } from "./server/routes/posts";
import { siteRoutes } from "./server/routes/site";
import { photos, posts } from "./server/schema";

export const app = defineApp({
  name: "demo",
  config,
  secrets,
  tables: { posts, photos },
  routes: (api) => {
    siteRoutes(api);
    postRoutes(api);
    photoRoutes(api);
  },
});

export default app;
