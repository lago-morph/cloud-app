import { api, getCurrentUser } from "@lago-morph/prototype-framework/client";
import type { Site } from "../shared/types";
import { describeError, el } from "./dom";
import { accountPage } from "./pages/account";
import { adminPage } from "./pages/admin";
import { draftsPage } from "./pages/drafts";
import { postListPage } from "./pages/post-list";
import { postView, sharedPostView } from "./pages/post-view";

/** Routes by query string: `?post=<id>` opens a post, `?share=<token>` a shared draft, otherwise the board. */
async function start(root: HTMLElement): Promise<void> {
  const [site, user] = await Promise.all([api<Site>("/site"), getCurrentUser()]);
  document.title = site.title;
  const header = el("header");
  if (site.banner !== null) {
    const banner = el("p", site.banner);
    banner.className = "banner";
    header.append(banner);
  }
  const home = el("a", site.title);
  home.href = "/";
  const title = el("h1");
  title.append(home);
  header.append(title);
  root.replaceChildren(header);

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("authError");
  if (authError !== null) root.append(el("p", `Login failed (request ${params.get("requestId") ?? "unknown"}).`));
  const postId = params.get("post");
  const share = params.get("share");
  if (postId !== null) {
    root.append(postView(postId, user));
  } else if (share !== null) {
    root.append(sharedPostView(share));
  } else {
    root.append(postListPage(user));
    if (user.level !== "anonymous") root.append(draftsPage(site));
    if (user.level === "admin") root.append(adminPage(site));
  }
  root.append(accountPage(user));
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
