// G-S2: writes the stage program variants into out/ (tsx generate.ts).
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { awsStageProgram, type AwsStageInput } from "./program.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(join(out, "fixture/bundle"), { recursive: true });
mkdirSync(join(out, "fixture/client"), { recursive: true });
writeFileSync(join(out, "fixture/bundle/index.mjs"), "export const handler = async () => ({ statusCode: 200, body: 'ok' });\n");
writeFileSync(join(out, "fixture/client/index.html"), "<!doctype html><title>t</title>\n");

export const base: AwsStageInput = {
  app: "reference",
  stage: "test-abc",
  region: "us-east-1",
  accountId: "123456789012",
  vpc: { subnets: ["subnet-0aaa", "subnet-0bbb"], securityGroups: ["sg-0ccc"] },
  auroraVersion: "17.5",
};
export const full: AwsStageInput = {
  ...base,
  code: {
    bundle: join(out, "fixture/bundle"),
    handler: "index.handler",
    assetsDirectory: join(out, "fixture/client"),
    variables: { FRAMEWORK_STAGE: "test-abc" },
    database: "reference_test_abc_0001",
    databaseSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:reference-test-abc-database-credentials-AbCdEf",
  },
};

writeFileSync(join(out, "sst.config.ts"), awsStageProgram(full));
mkdirSync(join(out, "step3"), { recursive: true });
if (!existsSync(join(out, "step3/.sst"))) symlinkSync("../.sst", join(out, "step3/.sst"));
writeFileSync(join(out, "step3/sst.config.ts"), awsStageProgram(base));
writeFileSync(join(out, "package.json"), `${JSON.stringify({ name: "reference-sst", private: true, type: "module" }, null, 2)}\n`);
console.log("wrote out/sst.config.ts (full program) and out/step3/sst.config.ts (first-deploy step 3)");
