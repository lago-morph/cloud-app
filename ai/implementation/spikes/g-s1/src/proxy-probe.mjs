// Q5: how does AWS SDK v3 (and Node fetch) reach an HTTPS proxy on Node 22.22?
// Fully local: a TLS server for the made-up host spike-s3.example.test (self-signed cert made
// at run time), and a logging CONNECT proxy on 127.0.0.1 that tunnels only that host to the
// TLS server. Each variant runs in a child with HTTPS_PROXY pointing at the local proxy.
// The host does not resolve in DNS, so a client that ignores the proxy fails with ENOTFOUND.
//
// usage: node src/proxy-probe.mjs <scratch-dir>
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOST = "spike-s3.example.test";
const scratch = mkdtempSync(join(process.argv[2] ?? "/tmp", "g-s1-proxy-"));
const key = join(scratch, "key.pem");
const cert = join(scratch, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", `/CN=${HOST}`, "-addext", `subjectAltName=DNS:${HOST}`], { stdio: "ignore" });

const tls = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  res.writeHead(200, { "content-type": "application/xml" });
  res.end('<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Owner><ID>spike</ID></Owner><Buckets><Bucket><Name>spike-bucket</Name><CreationDate>2026-10-24T00:00:00.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>');
});
await new Promise((r) => tls.listen(0, "127.0.0.1", r));
const tlsPort = tls.address().port;

const connects = [];
const proxy = http.createServer((req, res) => {
  connects.push(`PLAIN ${req.method} ${req.url}`);
  res.writeHead(502).end();
});
proxy.on("connect", (req, socket, head) => {
  connects.push(`CONNECT ${req.url}`);
  const [host, port] = req.url.split(":");
  if (host !== HOST) {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const upstream = net.connect(tlsPort, "127.0.0.1", () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  void port;
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

const client = fileURLToPath(new URL("./proxy-client.mjs", import.meta.url));
const endpoint = `https://${HOST}:${tlsPort}`;
const cases = [
  ["sdk-default", {}],
  ["sdk-default", { NODE_USE_ENV_PROXY: "1" }],
  ["sdk-globalAgent", { NODE_USE_ENV_PROXY: "1" }],
  ["sdk-agent-proxyEnv", {}],
  // No proxy configured (as in Lambda): the proxyEnv agent connects directly.
  ["sdk-agent-proxyEnv", { HTTPS_PROXY: undefined, https_proxy: undefined }],
  // Host listed in NO_PROXY: the proxyEnv agent bypasses the proxy.
  ["sdk-agent-proxyEnv", { NO_PROXY: `localhost,127.0.0.1,${HOST}`, no_proxy: `localhost,127.0.0.1,${HOST}` }],
  ["fetch", {}],
  ["fetch", { NODE_USE_ENV_PROXY: "1" }],
];
const results = [];
for (const [variant, extra] of cases) {
  connects.length = 0;
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    HTTPS_PROXY: proxyUrl,
    https_proxy: proxyUrl,
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
    NODE_EXTRA_CA_CERTS: cert,
    AWS_EC2_METADATA_DISABLED: "true",
    ...extra,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];
  const run = await new Promise((resolve) => {
    // async spawn so this process keeps serving the proxy and TLS server meanwhile
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(process.execPath, [client, variant, endpoint], { env, cwd: fileURLToPath(new URL("..", import.meta.url)) });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("close", () => resolve({ out, err }));
    });
  });
  const line = run.out.trim().split("\n").pop() ?? "";
  results.push({ env: Object.keys(extra).map((k) => (extra[k] === undefined ? `unset ${k}` : `${k}=${extra[k]}`)).join(" ") || "(none)", ...JSON.parse(line || "{}"), proxySaw: [...connects], stderr: run.err.trim().slice(0, 200) || undefined });
}
for (const r of results) console.log(JSON.stringify(r));
proxy.close();
tls.close();
void spawnSync;
