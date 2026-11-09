import { defineApp } from "@lago-morph/prototype-framework";
import { config, secrets } from "./server/env";
import { myScheduleRoutes } from "./server/routes/my-schedule";
import { scheduleRoutes } from "./server/routes/schedule";
import { selections, sessions } from "./server/schema";

export const app = defineApp({
  name: "kubeconplanner",
  config,
  secrets,
  tables: { sessions, selections },
  routes: (api) => {
    scheduleRoutes(api);
    myScheduleRoutes(api);
  },
});

export default app;
