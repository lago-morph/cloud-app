import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { el, section } from "../dom";

/** Who is logged in, with login and logout buttons. */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  page.dataset["testid"] = "account";
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."));
    const button = el("button", "Log in");
    button.dataset["testid"] = "login";
    button.addEventListener("click", () => login());
    page.append(button);
    return page;
  }
  page.append(el("p", `Logged in as ${user.displayName ?? user.id} (${user.level}).`));
  const button = el("button", "Log out");
  button.dataset["testid"] = "logout";
  button.addEventListener("click", () => {
    void logout().then(() => window.location.reload());
  });
  page.append(button);
  return page;
}
