import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: here,
  // One drizzle instance for the framework sources and the aws-data-api driver.
  resolve: { dedupe: ["drizzle-orm"] },
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
