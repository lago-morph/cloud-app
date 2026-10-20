// `node tests/compliance/tools/report.mjs traceability|release [--commit <sha>] [--out <file>]` (report.ts).
import { launch } from "../harness/launch.mjs";

await launch("tests/compliance/tools/report.ts");
