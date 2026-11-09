import { api, getCurrentUser } from "@lago-morph/prototype-framework/client";
import type { Greeting } from "../shared/types";
import { describeError, el } from "./dom";
import { accountPage } from "./pages/account";
import { adminPage } from "./pages/admin";
import { filesPage } from "./pages/files";
import { notesPage } from "./pages/notes";
import { statusPage } from "./pages/status";

async function start(root: HTMLElement): Promise<void> {
  const [{ greeting }, user] = await Promise.all([api<Greeting>("/hello"), getCurrentUser()]);
  root.replaceChildren(el("h1", greeting), accountPage(user));
  if (user.level === "anonymous") return;
  root.append(notesPage(), statusPage(), filesPage());
  if (user.level === "admin") root.append(adminPage());
}

const root = document.querySelector<HTMLElement>("#app");
if (root !== null) {
  void start(root).catch((error: unknown) => {
    root.replaceChildren(el("p", describeError(error)));
  });
}
