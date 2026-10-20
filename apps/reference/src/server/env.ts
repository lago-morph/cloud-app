import { configBoolean, configInteger, configString, configStringList, type AppDefinition, type AppEnv } from "@lago-morph/prototype-framework";

/** Non-secret configuration keys; values per stage are in `config/`. */
export const config = {
  greeting: configString({ default: "Hello" }),
  pageSize: configInteger({ default: 20 }),
  featureOn: configBoolean({ default: false }),
  tags: configStringList({ default: [] }),
};

/** Secret names; values are set with `secrets set <name>`, never committed. `apiKey` is the compliance test secret. */
export const secrets = ["apiKey"] as const;

export type Secret = (typeof secrets)[number];

/** The Hono environment every route module's handlers see. */
export type Env = AppEnv<typeof config, Secret>;

/** The `/api` router each route module registers on (the `Hono<Env>` that `routes` receives). */
export type Api = Parameters<AppDefinition<typeof config, Secret>["routes"]>[0];
