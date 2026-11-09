import { getCurrentUser } from "@lago-morph/prototype-framework/client";
import { describeError, el } from "./dom";
import { accountPage } from "./pages/account";
import { browsePage } from "./pages/browse";
import { myScheduleView } from "./pages/my-schedule";
import { onSelection } from "./selection";

type View = "browse" | "mine";

function viewFromHash(): View {
  return window.location.hash === "#my-schedule" ? "mine" : "browse";
}

async function start(root: HTMLElement): Promise<void> {
  const user = await getCurrentUser();
  const header = el("header");
  header.append(el("h1", "KubeCon planner"), el("p", "KubeCon + CloudNativeCon North America 2026 · Salt Lake City · Nov 8–12"), accountPage(user));
  root.replaceChildren(header);
  if (user.level === "anonymous") return;

  const nav = el("nav");
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Views");
  const browseTab = el("button", "Browse sessions");
  const mineTab = el("button", "My schedule");
  for (const tab of [browseTab, mineTab]) tab.setAttribute("role", "tab");
  nav.append(browseTab, mineTab);

  const browse = browsePage();
  const mine = myScheduleView();
  let stale = true;
  onSelection(() => {
    stale = true;
  });

  const show = (view: View): void => {
    browseTab.setAttribute("aria-selected", String(view === "browse"));
    mineTab.setAttribute("aria-selected", String(view === "mine"));
    browse.hidden = view !== "browse";
    mine.element.hidden = view !== "mine";
    if (view === "mine" && stale) {
      stale = false;
      mine.refresh();
    }
  };
  browseTab.addEventListener("click", () => {
    window.location.hash = "browse";
  });
  mineTab.addEventListener("click", () => {
    window.location.hash = "my-schedule";
  });
  window.addEventListener("hashchange", () => show(viewFromHash()));

  root.append(nav, browse, mine.element);
  show(viewFromHash());
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
