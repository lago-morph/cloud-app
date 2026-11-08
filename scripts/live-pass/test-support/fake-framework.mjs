// Test support for scripts/live-pass/run.unit.test.ts: a stand-in for the framework CLI
// (`prototype-framework`) that changes the fake world (fake-world.mjs) the way the real commands
// change a Cloudflare account, and prints the lines the live-pass steps look for.
import { randomUUID } from "node:crypto";
import { addEvent, load, save } from "./fake-world.mjs";

const [cmd, ...args] = process.argv.slice(2);
const w = load();
const arg = (n) => args[args.indexOf(n) + 1];
const env = process.env;
const say = (t) => process.stdout.write(`${t}\n`);
const done = (code) => {
  save(w);
  process.exit(code);
};
// What each command was given (names only, and whether the account is the test Cloudflare account's).
// `tokenEnv`: every variable whose value is a token of the world (by its ID) or the sandbox's own token
// ("primary"), whatever the variable's name: which token reached the command, not only which name.
const tokenEnv = {};
for (const [k, v] of Object.entries(env)) {
  if (k === "FAKE_PRIMARY_TOKEN" || !v) continue;
  const t = w.tokens.find((x) => x.value === v);
  if (t) tokenEnv[k] = t.id;
  else if (v === env.FAKE_PRIMARY_TOKEN) tokenEnv[k] = "primary";
}
w.frameworkCalls = [...(w.frameworkCalls ?? []), { cmd, args, accountIsTest: env.CLOUDFLARE_ACCOUNT_ID === w.accountId, tokens: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_BOOTSTRAP_TOKEN"].filter((n) => env[n] !== undefined), tokenEnv }];

if (cmd === "cloudflare-setup") {
  const boot = env.CLOUDFLARE_BOOTSTRAP_TOKEN;
  // The container is lost in the middle of a bootstrap: the runner dies before the command ends.
  if (w.loseContainerOnBootstrap && boot !== undefined && w.tokens.some((x) => x.value === boot)) {
    delete w.loseContainerOnBootstrap;
    save(w);
    process.kill(process.ppid, "SIGKILL");
    process.exit(137);
  }
  if (boot !== undefined) {
    const t = w.tokens.find((x) => x.value === boot && x.status === "active");
    if (!t) {
      say("CLOUDFLARE_BOOTSTRAP_TOKEN: Cloudflare does not accept this value as a token. Make one here: https://dash.cloudflare.com/?to=/:account/api-tokens");
      done(1);
    }
    if (t.expires_on === null || Date.parse(t.expires_on) - Date.now() > 86_400_000) {
      w.tokens = w.tokens.filter((x) => x !== t);
      say("CLOUDFLARE_BOOTSTRAP_TOKEN: it has no expiry, and a bootstrap token may live 1 day at most. Setup deleted it at once and used it for nothing else. https://dash.cloudflare.com/?to=/:account/api-tokens");
      done(1);
    }
    w.subdomain ??= "fake-sub";
    const kept = w.oauthClients.length === 2;
    if (!kept) {
      w.oauthClients = [
        { client_id: "cid-admin", name: "prototype-framework-admin", redirect_uris: [`https://prototype-admin.${w.subdomain}.workers.dev/callback`] },
        { client_id: "cid-signin", name: "prototype-framework-sign-in", redirect_uris: [`https://prototype-auth.${w.subdomain}.workers.dev/callback`] },
      ];
      w.stores = [{ id: "store1", name: "prototype-framework", secrets: [
        { id: "s1", name: "PROTOTYPE_ADMIN_CLIENT_ID", comment: "cid-admin" }, { id: "s2", name: "PROTOTYPE_ADMIN_CLIENT_SECRET", comment: "cid-admin" },
        { id: "s3", name: "PROTOTYPE_SIGNIN_CLIENT_ID", comment: "cid-signin" }, { id: "s4", name: "PROTOTYPE_SIGNIN_CLIENT_SECRET", comment: "cid-signin" },
      ] }];
    }
    w.workers["prototype-admin"] = {
      created_on: "2026-11-03T00:00:00Z", modified_on: new Date().toISOString(), compatibility_flags: ["nodejs_compat"], observability: null, secrets: [],
      bindings: [{ type: "secrets_store_secret", name: "ADMIN_CLIENT_ID", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_ID" }, { type: "secrets_store_secret", name: "ADMIN_CLIENT_SECRET", store_id: "store1", secret_name: "PROTOTYPE_ADMIN_CLIENT_SECRET" }, { type: "plain_text", name: "ADMIN_ACCOUNT_ID" }, { type: "plain_text", name: "ADMIN_APP_ORIGIN" }],
    };
    w.tokens = w.tokens.filter((x) => x !== t);
    say(kept ? "OAuth clients: prototype-framework-admin and prototype-framework-sign-in already exist, with their secrets in Secrets Store" : "OAuth clients: created prototype-framework-admin and prototype-framework-sign-in; their IDs and secrets are in Secrets Store");
    say("admin app: deployed (Worker prototype-admin), bound to the admin client's ID and secret in Secrets Store");
    say("the bootstrap token deleted itself");
    say("In a cloud session, delete the environment variable: it is already invalid.");
    say("The Cloudflare bootstrap is complete.");
    say(`  admin app: https://prototype-admin.${w.subdomain}.workers.dev`);
    done(0);
  }
  const t = w.tokens.find((x) => x.value === env.CLOUDFLARE_API_TOKEN);
  if (!t) {
    say("CLOUDFLARE_API_TOKEN is not a valid token");
    done(1);
  }
  say("Everything is already set up and current: nothing to do.");
  say("  account setup: current (setup version 2)");
  say("  everyday token: passed the quick check (4 permissions)");
  say("Next step: deploy a test stage: npm run deploy -- --target cloudflare --stage test-first");
  done(0);
}

const stage = arg("--stage");
const app = "livepass";
const name = `${app}-${stage}`;

if (cmd === "deploy") {
  if (!w.workers[name]) {
    w.workers[name] = { created_on: new Date().toISOString(), modified_on: new Date().toISOString(), compatibility_flags: ["nodejs_compat"], observability: null, secrets: [], bindings: [] };
    w.d1.push({ uuid: randomUUID(), name: `${name}-db` });
    w.buckets[`${name}-files`] = { objects: {}, lifecycle: null };
  }
  if (!w.stageSecrets[name]) {
    say(`deploy stopped: set the secret apiKey with: npm run secrets -- set apiKey --target cloudflare --stage ${stage}`);
    done(1);
  }
  if (!stage.startsWith("test-")) {
    w.workers[name].bindings = [{ type: "service", name: "AUTH", service: "prototype-auth", entrypoint: "AuthApp" }];
    const db = w.d1.find((d) => d.name === "prototype-auth").uuid;
    w.d1Rows[db].registry.push({ app: name, return_url: `https://${name}.${w.subdomain}.workers.dev/api/auth/callback` });
  }
  say(`deployed https://${name}.${w.subdomain}.workers.dev`);
  done(0);
}

if (cmd === "secrets") {
  let input = "";
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    w.stageSecrets[name] = input.length > 0;
    say(`set apiKey on ${name}`);
    done(0);
  });
} else if (cmd === "remove") {
  if (!stage.startsWith("test-")) {
    if (arg("--confirm-production") !== stage) done(2);
    w.buckets["prototype-backups"].objects[`${app}/${stage}/20261103T000000Z/manifest.json`] = { body: "{}", type: "application/json" };
    say(`backup: prototype-backups/${app}/${stage}/20261103T000000Z/`);
    const db = w.d1.find((d) => d.name === "prototype-auth").uuid;
    w.d1Rows[db].registry = w.d1Rows[db].registry.filter((r) => r.app !== name);
  }
  delete w.workers[name];
  w.d1 = w.d1.filter((d) => d.name !== `${name}-db`);
  delete w.buckets[`${name}-files`];
  addEvent(w, name, "removed");
  say(`removed ${name}`);
  done(0);
} else if (cmd !== "deploy" && cmd !== "cloudflare-setup") {
  say(`fake framework: unknown command ${cmd}`);
  done(2);
}
