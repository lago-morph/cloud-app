/**
 * Admin page 2, the everyday token (v0.2.0 plan §5.2 page 2; DEC-0715). The action runs with the
 * person's grant (PAR-447 `everyday`): it creates the everyday token, or updates an existing one
 * (from 0.1.x too) in place to exactly the four groups (everyday-token.ts).
 *
 * A new token's value is **shown once, to the person, on this page**, with a copy button and where
 * to put it. It is never logged, stored or sent anywhere else; the agent never sees it. When the
 * grant could not update the old token, the page shows the new value and offers to delete the old
 * token once the person confirms they saved the new one (a second grant, action `delete:<ids>`).
 */
import { deleteOldEverydayTokens, ensureEverydayToken } from "../provision/cloudflare/everyday-token.js";
import { EVERYDAY_V2 } from "../provision/cloudflare/permissions.js";
import type { AdminPage, GrantContext, PageResult } from "./app.js";
import { esc } from "./html.js";

const SETTING = "CLOUDFLARE_API_TOKEN";

const groupList = (): string => `<ul>${EVERYDAY_V2.map((g) => `<li>${esc(g.name)}</li>`).join("")}</ul>`;

const COPY_SCRIPT = `document.getElementById("copy").addEventListener("click",function(){navigator.clipboard.writeText(document.getElementById("everyday-token").textContent).then(function(){document.getElementById("copied").textContent="Copied."})});`;

function showValue(value: string, lead: string): PageResult {
  // `lead` is a paragraph's text; the group list follows it, outside the paragraph.
  return {
    html: [
      `<p>${lead}</p>`,
      groupList(),
      `<p><strong>This is the only time the value is shown.</strong> Copy it now:</p>`,
      `<pre id="everyday-token">${esc(value)}</pre>`,
      `<p><button type="button" id="copy">Copy</button> <span id="copied"></span></p>`,
      "<p>Where it goes (keep it out of chats, commits and logs: the agent never needs to see it):</p>",
      "<ul>",
      `<li>In a Claude Code cloud session: open the environment menu, choose Edit, and add <code>${SETTING}=&lt;the value&gt;</code> under Environment variables; save, then start a new session.</li>`,
      `<li>On your own computer: add the line <code>${SETTING}=&lt;the value&gt;</code> to <code>.env.cloudflare</code> in the project folder (setup keeps that file out of git).</li>`,
      "</ul>",
      '<p>Then tell the agent: "continue prototype setup".</p>',
    ].join("\n"),
    script: COPY_SCRIPT,
  };
}

const deleteForm = (ids: readonly string[]): string =>
  `<form method="post" action="/everyday"><input type="hidden" name="action" value="delete:${esc(ids.join(","))}"><button type="submit">I have saved the new token: delete the old one</button></form>`;

async function run(ctx: GrantContext): Promise<PageResult> {
  if (ctx.action?.startsWith("delete:") === true) {
    const ids = ctx.action.slice("delete:".length).split(",").filter((s) => s !== "");
    const out = await deleteOldEverydayTokens(ctx.api, ctx.accountId, ids);
    return `<p>Deleted ${String(out.deleted.length)} old everyday token(s).${out.skipped.length > 0 ? ` ${String(out.skipped.length)} ID(s) were left alone: not an everyday token, or the last one.` : ""}</p>`;
  }
  const out = await ensureEverydayToken(ctx.api, ctx.accountId);
  switch (out.kind) {
    case "created":
      return showValue(out.value, "The everyday token <code>prototype-framework</code> was created with exactly these permissions:");
    case "replaced": {
      const r = showValue(out.value, "Cloudflare did not let this sign-in change the existing everyday token, so a new one was created with exactly these permissions:");
      return typeof r === "string" ? r : { ...r, html: `${r.html}\n<p>Once the new value is saved where it goes, delete the old token:</p>${deleteForm(out.oldIds)}` };
    }
    case "updated":
      return [
        `<p>The existing everyday token was updated in place to exactly these permissions; its value did not change, so nothing needs re-saving:</p>${groupList()}`,
        out.added.length > 0 ? `<p>Added: ${out.added.map(esc).join(", ")}.</p>` : "",
        out.removed.length > 0 ? `<p>Removed (only v0.1.x email code used them): ${out.removed.map(esc).join(", ")}.</p>` : "",
      ].join("\n");
    case "current":
      return `<p>The everyday token already holds exactly these permissions; nothing was changed:</p>${groupList()}`;
  }
}

export const everydayPage: AdminPage = {
  id: "everyday",
  title: "Everyday token",
  actions: ["delete"],
  view: () =>
    [
      "<p>The everyday token is what the agent uses for deploys and checks. This step creates it, or updates an existing one (from 0.1.x too) in place to exactly these permissions on this account:</p>",
      groupList(),
      "<p>Cloudflare will ask you to approve the permissions this step needs. Keep them all ticked. A new token's value is shown once, here, to you.</p>",
    ].join("\n"),
  run,
};
