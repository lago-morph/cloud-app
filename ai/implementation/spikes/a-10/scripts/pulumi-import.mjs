// Import check only: no Pulumi program runs, nothing touches the cloud.
const cf = await import("@pulumi/cloudflare");
const pulumi = await import("@pulumi/pulumi");
console.log("@pulumi/cloudflare exports Worker:", typeof cf.WorkersScript === "function" || typeof cf.Worker === "function");
console.log("@pulumi/cloudflare exports R2Bucket:", typeof cf.R2Bucket === "function");
console.log("@pulumi/cloudflare exports D1Database:", typeof cf.D1Database === "function");
console.log("@pulumi/pulumi version:", (await import("@pulumi/pulumi/package.json", { with: { type: "json" } })).default.version);
console.log("pulumi.Config:", typeof pulumi.Config === "function");
