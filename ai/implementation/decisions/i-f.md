# I-F — email provisioning and the test mail sink: decisions and live calls

Implementer's note for item I-F (plan-auth.md §6), 2026-10-25. Nothing live was created, changed or deleted. 17 read-only GETs were sent to confirm the API shapes below. No token, account ID or zone ID was printed.

## Live calls `setup-account --target cloudflare --email-domain <domain>` makes

Each call is in order. `<z>` is the zone ID, `<a>` the account ID and `<t>` = `t.<domain>`. Writes are **bold**; each runs only when the read before it finds the thing absent or different. The current shareplay.com state (2026-10-25) is in brackets.

0. The existing calls, unchanged: shared buckets, subdomain, `tokens/verify`, the record `framework/account.json` (PUT only when the domain changes).
1. Preflight, before any change (reads only):
   - `GET /zones?name=<domain>&account.id=<a>`;
   - `GET /accounts/<a>/tokens/verify`, then `GET /accounts/<a>/tokens/<own id>`, to read its policies.
   - Each missing permission is named, and the run stops having changed nothing. The permissions are DEC-0515's six, plus "Workers Scripts Write" and "Workers R2 Storage Write" for the sink.
2. Email Sending:
   - `GET /zones/<z>/email/sending/subdomains` [entry `shareplay.com` exists, `enabled: true`];
   - **`POST` the same path `{"name":"<domain>"}`** only when it is absent;
   - `GET …/subdomains/<id>`, polled every 5 s for up to 120 s, only while `enabled` is not true. [Expect no POST and no poll.]
3. The sink bucket:
   - `GET /accounts/<a>/r2/buckets/prototype-mailsink`;
   - **`POST /accounts/<a>/r2/buckets {"name":"prototype-mailsink"}`** when it is absent;
   - `GET …/prototype-mailsink/lifecycle`;
   - **`PUT …/lifecycle`**, keeping any other rule (R2's default multipart-abort rule) and adding `{id:"framework-mailsink-retention", enabled:true, conditions:{prefix:""}, deleteObjectsTransition:{condition:{type:"Age", maxAge:86400}}}` (PAR-241).
4. The sink Worker:
   - `GET /accounts/<a>/workers/scripts/prototype-mailsink/settings`;
   - **`PUT /accounts/<a>/workers/scripts/prototype-mailsink`** (multipart) when the Worker is absent or lacks the tag `framework-mailsink-<16 hex>`. The upload has:
     - metadata `{main_module:"mailsink.js", compatibility_date:"2026-10-01", bindings:[{type:"r2_bucket", name:"MAILSINK", bucket_name:"prototype-mailsink"}], tags:[…]}`;
     - the module `src/mail/sink-worker.ts` `MAIL_SINK_SOURCE`, which has only an `email` handler.
5. Email Routing on `<t>` only:
   - `GET /zones/<z>/email/routing/dns?subdomain=<t>` [today: `errors` lists 3 MX (`route1/2/3.mx.cloudflare.net`) and an SPF TXT as missing];
   - **`POST /zones/<z>/email/routing/dns {"name":"<t>"}`**;
   - the same GET, polled until `errors` is empty.
   - The apex is never enabled: no `/email/routing/enable` and no catch-all call.
6. Subaddressing:
   - `GET /zones/<z>/email/routing` [`support_subaddress: false`];
   - **`PATCH /zones/<z>/email/routing {"support_subaddress":true}`**.
7. The routing rule:
   - `GET /zones/<z>/email/routing/rules?per_page=50&page=1` [only the disabled catch-all drop rule];
   - **`POST /zones/<z>/email/routing/rules`** with `{name:"framework mail sink (prototype-mailsink)", enabled:true, matchers:[{type:"literal", field:"to", value:"sink@<t>"}], actions:[{type:"worker", value:["prototype-mailsink"]}]}`. This is a `PUT …/rules/<id>` instead if a rule for that address exists but is disabled or points elsewhere.

**Expected first live run on shareplay.com:** POST bucket, PUT lifecycle, PUT Worker, POST routing/dns, PATCH routing, POST rule (6 writes; Sending is already onboarded). **The second run should send only GETs** (about 12, plus the existing shared-resource reads).

**`mail last --to <addr> --target cloudflare`** sends only reads:
- `GET …/sst-state/objects/framework%2Faccount.json`;
- `GET …/r2/buckets/prototype-mailsink/objects?prefix=<addr>/&per_page=1000`;
- `GET …/objects/<key>` for the newest key.

## Decisions to record (draft entries)

1. **No catch-all for `*@t.<domain>`; one literal rule plus subaddressing instead.** Cloudflare's Email Routing docs (setup/subdomains) say "Catch-all rules are only available for the apex domain", and a subdomain gets literal rules only. So the sink receives `sink@t.<domain>`, and with `support_subaddress` on, every `sink+<tag>@t.<domain>`. The sink stores mail under the envelope recipient, so `sink+<runid>@…` keeps runs apart. This amends mail.md §2, cloudflare.md `setupAccount`, plan-auth.md §3 ("catch-all") and DEC-0512 ("a fresh address under `t.<domain>`"). `check-login` (I-G) must use `sinkAddress(domain, runId)` from `provision/cloudflare/email.ts`. `support_subaddress` is a zone setting; with apex routing off, it affects nothing else.
2. **Enabling routing on a subdomain:** `POST /zones/<z>/email/routing/dns` with `{"name":"t.<domain>"}`. The API reference lists only `name` ("Domain of your zone"), and the dashboard's Subdomains form is the documented path. Whether this POST enables only the subdomain is **not verified live**. After step 5, the orchestrator should confirm that `GET /zones/<z>/email/routing` still shows the apex `enabled: false` and that no apex MX was added. The GET with `?subdomain=` is marked deprecated, but it answered live with `{errors:[{code,missing}], records}`, which the code relies on.
3. **"Verified" for Email Sending** means the entry's `enabled: true`. The entry has no other status field (seen live). The required records are under `cf-bounce.<domain>` and `_dmarc`, and on Cloudflare DNS the onboarding writes them itself.
4. **Permission check** reads the token's own policies (account-owned token, "Account API Tokens Read"). The names are those the live token lists. "Zone Write" also counts as "Zone Read". A `deny` policy removes a grant.
5. **Sink Worker idempotency** uses a Worker tag carrying the source hash. **Not verified live:** that upload metadata `tags` is accepted and returned by `…/settings`, because no Worker existed to read. If the second live run re-uploads the Worker, the tag is not returned and the comparison needs another field.
6. **Account-resource rule:** a stage whose fixed names equal an account resource's (only app `prototype`, stage `mailsink`, named Worker `prototype-mailsink`) is refused by deploy, `listStageResources` and `removeStage`. So removal can never delete the sink. The compliance probe `sharedResources()` now also records the sink's bucket and Worker, so the removal and setup-account criteria compare them.
7. **Not done here:** the spec text (mail.md, cloudflare.md) still says "catch-all". It needs the decision-log entry of item 1 first.
