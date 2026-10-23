import { login, logout, type CurrentUser } from "@lago-morph/prototype-framework/client";
import { el, section } from "../dom";

/** Login and logout, and the user's ID with a copy button so the owner can list it (DEMO-REQ-009). */
export function accountPage(user: CurrentUser): HTMLElement {
  const page = section("Account");
  if (user.level === "anonymous") {
    page.append(el("p", "You are not logged in."));
    const button = el("button", "Log in");
    button.addEventListener("click", () => login());
    page.append(button);
    return page;
  }
  page.append(el("p", `Logged in as ${user.displayName ?? user.id} (${user.level}).`));
  const idLine = el("p", "Your user ID: ");
  const id = el("code", user.id);
  id.id = "user-id";
  const copy = el("button", "Copy ID");
  const copied = el("span");
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(user.id).then(
      () => {
        copied.textContent = " Copied.";
      },
      () => {
        copied.textContent = " Could not copy; select the ID instead.";
      },
    );
  });
  idLine.append(id, " ", copy, copied);
  const out = el("button", "Log out");
  out.addEventListener("click", () => {
    void logout().then(() => window.location.reload());
  });
  page.append(idLine, out);
  return page;
}
