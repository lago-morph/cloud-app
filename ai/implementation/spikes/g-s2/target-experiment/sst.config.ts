/// <reference path="./.sst/platform/config.d.ts" />
export default $config({
  app() {
    return { name: "gs2tgt", removal: "remove", home: "local", providers: { random: "4.16.6" } };
  },
  async run() {
    const v = (k: string) => process.env[k] ?? "1";
    // Long-lived "Files": a resource with a child.
    const files = new random.RandomPet("Files", { keepers: { v: v("V_FILES") } });
    new random.RandomPet("FilesChild", { keepers: { v: v("V_FILES_CHILD") } }, { parent: files });
    // Long-lived "Database": a component resource with a child (like sst.aws.Aurora).
    const db = new $util.ComponentResource("gs2:test:Db", "Database", {}, {});
    const cluster = new random.RandomString("DatabaseCluster", { length: 8, special: false, keepers: { v: v("V_DB") } }, { parent: db });
    // App code that depends on a long-lived output (edge) ...
    new random.RandomString("FnEdge", { length: 8, special: false, keepers: { files: files.id, cluster: cluster.result, code: v("V_CODE") } });
    // ... and app code that names them by literal strings only (no edge).
    new random.RandomString("FnLiteral", { length: 8, special: false, keepers: { files: "files-literal", code: v("V_CODE") } });
    // Code that depends on a non-targeted resource (like the Function on the Router).
    const router = new random.RandomPet("Router", { keepers: { v: v("V_ROUTER") } });
    new random.RandomString("FnRouter", { length: 8, special: false, keepers: { origin: router.id, code: v("V_CODE") } });
    return {};
  },
});
