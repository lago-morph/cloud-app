import { api, getCurrentUser, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { Site } from "../shared/types";
import { describeError, el, link } from "./dom";
import { accountPage } from "./pages/account";
import { adminPage } from "./pages/admin";
import { boardPage } from "./pages/board";
import { draftsPage } from "./pages/drafts";
import { postPage, sharedPostPage } from "./pages/post";

/** Chooses the page from the path; every path outside /api serves this client. */
function route(path: string, user: CurrentUser, site: Site): HTMLElement {
  const post = /^\/post\/([0-9a-f-]{36})$/.exec(path);
  if (post?.[1] !== undefined) return postPage(post[1], user);
  const share = /^\/share\/([^/]+)$/.exec(path);
  if (share?.[1] !== undefined) return sharedPostPage(decodeURIComponent(share[1]));
  if (path === "/account") return accountPage(user);
  if (path === "/drafts" && user.level !== "anonymous") return draftsPage(site);
  if (path === "/admin" && user.level === "admin") return adminPage(site);
  return boardPage(user);
}

async function start(root: HTMLElement): Promise<void> {
  const [site, user] = await Promise.all([api<Site>("/site"), getCurrentUser()]);
  document.title = site.title;
  const header = el("header");
  header.append(el("h1", site.title));
  if (site.banner !== null) {
    const banner = el("p", site.banner);
    banner.className = "banner";
    header.append(banner);
  }
  const nav = el("nav");
  nav.append(link("/", "Board"), " · ");
  if (user.level !== "anonymous") nav.append(link("/drafts", "My drafts"), " · ");
  if (user.level === "admin") nav.append(link("/admin", "Admin"), " · ");
  nav.append(link("/account", user.level === "anonymous" ? "Log in" : "Account"));
  header.append(nav);
  root.replaceChildren(header, route(window.location.pathname, user, site));
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
