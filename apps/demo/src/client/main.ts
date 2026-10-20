import { api, getCurrentUser, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { Site } from "../shared/types";
import { describeError, el, link } from "./dom";
import { accountPage, sessionControls } from "./pages/account";
import { adminPage } from "./pages/admin";
import { postPage, sharedPage } from "./pages/post";
import { draftsPage, homePage } from "./pages/posts";

/** Picks the page for the current path; any path outside /api serves this client. */
function route(path: string, user: CurrentUser, site: Site): HTMLElement {
  const post = /^\/posts\/([^/]+)$/.exec(path);
  if (post?.[1] !== undefined) return postPage(decodeURIComponent(post[1]), site);
  const shared = /^\/shared\/([^/]+)$/.exec(path);
  if (shared?.[1] !== undefined) return sharedPage(decodeURIComponent(shared[1]), site);
  if (path === "/account") return accountPage(user);
  if (path === "/drafts" && user.level !== "anonymous") return draftsPage();
  if (path === "/admin" && user.level === "admin") return adminPage(site);
  return homePage(user);
}

async function start(root: HTMLElement): Promise<void> {
  const [site, user] = await Promise.all([api<Site>("/site"), getCurrentUser()]);
  document.title = site.title;
  const header = el("header");
  header.append(el("h1", site.title));
  if (site.banner !== null) {
    const banner = el("p", site.banner);
    banner.id = "banner";
    banner.style.padding = "0.5em";
    banner.style.background = "#fff3c4";
    header.append(banner);
  }
  const nav = el("nav");
  nav.append(link("Posts", "/"), el("span", " · "));
  if (user.level !== "anonymous") nav.append(link("My drafts", "/drafts"), el("span", " · "));
  if (user.level === "admin") nav.append(link("Banner", "/admin"), el("span", " · "));
  nav.append(link("Account", "/account"), el("span", " · "), sessionControls(user));
  header.append(nav);

  const authError = new URLSearchParams(window.location.search).get("authError");
  const notices: HTMLElement[] = [];
  if (authError !== null) {
    const requestId = new URLSearchParams(window.location.search).get("requestId");
    notices.push(el("p", `Login failed (${authError})${requestId === null ? "" : `, request ${requestId}`}.`));
  }
  root.replaceChildren(header, ...notices, route(window.location.pathname, user, site));
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
