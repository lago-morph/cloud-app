import { getCurrentUser } from "@lago-morph/prototype-framework/client";
import { describeError, el } from "./dom";
import { accountPage } from "./pages/account";
import { filesPage } from "./pages/files";

/** The reference app's page: the account and, for a logged-in user, photos (ROUTES.md "Client"). */
async function start(root: HTMLElement): Promise<void> {
  const user = await getCurrentUser();
  root.replaceChildren(el("h1", "Reference app"), accountPage(user));
  if (user.level !== "anonymous") root.append(filesPage(user.id));
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
