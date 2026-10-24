// Child process of proxy-probe.mjs: one S3 ListBuckets (or a fetch) to <endpoint> using one
// way of configuring the proxy. Prints one JSON line. Never given an AWS endpoint.
import https from "node:https";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const [variant, endpoint] = process.argv.slice(2);
if (!endpoint || /amazonaws\.com|\.on\.aws|cloudfront/i.test(endpoint)) throw new Error(`refusing endpoint ${endpoint}`);

function s3(requestHandler) {
  return new S3Client({
    region: "us-east-1",
    endpoint,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: "AKIDSPIKE", secretAccessKey: "spike" },
    ...(requestHandler ? { requestHandler } : {}),
  });
}

async function run() {
  switch (variant) {
    case "sdk-default":
      return s3().send(new ListBucketsCommand({}));
    case "sdk-agent-proxyEnv":
      // Node >= 22.21 / 24.5: an https.Agent that reads HTTPS_PROXY/NO_PROXY itself.
      return s3(new NodeHttpHandler({ httpsAgent: new https.Agent({ keepAlive: true, proxyEnv: process.env }) })).send(new ListBucketsCommand({}));
    case "sdk-globalAgent":
      // Hand the SDK Node's global agent (which NODE_USE_ENV_PROXY=1 configures).
      return s3(new NodeHttpHandler({ httpsAgent: https.globalAgent })).send(new ListBucketsCommand({}));
    case "fetch": {
      const r = await fetch(`${endpoint}/`);
      return { status: r.status };
    }
    default:
      throw new Error(`unknown variant ${variant}`);
  }
}

try {
  const out = await run();
  console.log(JSON.stringify({ variant, ok: true, buckets: out.Buckets?.length, status: out.status ?? out.$metadata?.httpStatusCode }));
} catch (e) {
  console.log(JSON.stringify({ variant, ok: false, name: e?.name, code: e?.code ?? e?.cause?.code, status: e?.$metadata?.httpStatusCode, message: String(e?.message).slice(0, 160) }));
}
