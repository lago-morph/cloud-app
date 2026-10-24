// `npm run compliance -- --target <local|cloudflare> [--stage <s>] [--milestone] …` (cli.ts).
import { launch } from "./launch.mjs";

await launch("tests/compliance/harness/cli.ts");
