import { api, getCurrentUser, login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { SiteInfo } from "../shared/types";
import { describeError, el, link } from "./dom";
import { accountPage } from "./pages/account";
import { homePage } from "./pages/home";
import { postPage, sharedPage } from "./pages/post";

function header(site: SiteInfo, user: CurrentUser): HTMLElement {
  const top = el("header");
  top.append(el("h1", site.title));
  if (site.banner !== null) {
    const banner = el("p", site.banner);
    banner.className = "banner";
    banner.setAttribute("role", "status");
    top.append(banner);
  }
  const nav = el("nav");
  nav.append(link("/", "Posts"), document.createTextNode(" · "), link("/account", "Account"), document.createTextNode(" · "));
  if (user.level === "anonymous") {
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    nav.append(button);
  } else {
    nav.append(document.createTextNode(`${user.displayName ?? user.id} (${user.level}) `));
    const button = el("button", "Log out");
    button.addEventListener("click", () => {
      void logout().then(() => window.location.reload());
    });
    nav.append(button);
  }
  top.append(nav);
  return top;
}

function loginError(): HTMLElement | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("authError") === null) return null;
  return el("p", `Login failed (request ${params.get("requestId") ?? "unknown"}).`);
}

async function start(root: HTMLElement): Promise<void> {
  const [site, user] = await Promise.all([api<SiteInfo>("/site"), getCurrentUser()]);
  document.title = site.title;
  root.replaceChildren(header(site, user));
  const failed = loginError();
  if (failed !== null) root.append(failed);

  const path = window.location.pathname;
  const postMatch = /^\/posts\/([0-9a-f-]{36})$/.exec(path);
  const shareMatch = /^\/share\/([A-Za-z0-9_.-]+)$/.exec(path);
  if (path === "/account") root.append(accountPage(user));
  else if (postMatch?.[1] !== undefined) root.append(postPage(postMatch[1], user, site));
  else if (shareMatch?.[1] !== undefined) root.append(sharedPage(shareMatch[1]));
  else root.append(homePage(user));
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
