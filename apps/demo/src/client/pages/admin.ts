import { api } from "@lago-morph/prototype-framework/client";
import type { Banner, Site } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** Admins only: set or clear the site banner (DEMO-REQ-004). The server guard is the protection. */
export function adminPage(site: Site): HTMLElement {
  const page = section("Site banner");
  const input = el("input");
  input.maxLength = 200;
  input.value = site.banner ?? "";
  const set = el("button", "Set banner");
  const clear = el("button", "Clear banner");
  const message = el("p");
  page.append(input, set, clear, message);

  const save = (value: string | null): void => {
    void api<Banner>("/banner", { method: "PUT", body: { message: value } })
      .then(() => window.location.reload())
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  };
  set.addEventListener("click", () => save(input.value));
  clear.addEventListener("click", () => save(null));
  return page;
}
