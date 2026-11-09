import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { el } from "../dom";

/** Who is signed in, with sign-in and sign-out buttons. */
export function accountPage(user: CurrentUser): HTMLElement {
  const box = el("div");
  box.className = "account";
  if (user.level === "anonymous") {
    box.append(el("p", "Sign in to build your schedule."));
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    box.append(button);
    return box;
  }
  box.append(el("span", `Signed in as ${user.displayName ?? user.id}`));
  const button = el("button", "Log out");
  button.addEventListener("click", () => {
    void logout().then(() => window.location.reload());
  });
  box.append(button);
  return box;
}
