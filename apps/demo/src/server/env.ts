import { configInteger, configString, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys (DEMO-REQ-006); values per stage are in `config/`. */
export const config = {
  siteTitle: configString({ default: "Photo board" }),
  maxPhotosPerPost: configInteger({ default: 5 }),
  shareLinkDays: configInteger({ default: 7 }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. `shareKey` signs share links (DEMO-REQ-007). */
export const secrets = ["shareKey"] as const;

/** The Hono environment every route module takes: `Hono<Env>`. */
export type Env = AppEnv<typeof config, (typeof secrets)[number]>;
