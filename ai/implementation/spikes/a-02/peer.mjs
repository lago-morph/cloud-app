// Usage: node peer.mjs <url> — plain node:https GET (ignores HTTPS_PROXY); prints the TCP peer and TLS issuer.
import https from "node:https";
import dns from "node:dns/promises";

const url = new URL(process.argv[2]);
try {
  console.log("dns:", JSON.stringify(await dns.lookup(url.hostname, { all: true })));
} catch (e) {
  console.log("dns error:", e.code);
}
const req = https.get(url, { timeout: 30_000 }, (res) => {
  const cert = res.socket.getPeerCertificate();
  console.log(`peer=${res.socket.remoteAddress}:${res.socket.remotePort} status=${res.statusCode} issuer=${cert.issuer?.O}/${cert.issuer?.CN}`);
  res.resume();
});
req.on("error", (e) => console.log("error:", e.code, e.message));
req.on("timeout", () => req.destroy(new Error("timeout")));
