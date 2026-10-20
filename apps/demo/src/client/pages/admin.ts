import { api } from "@lago-morph/prototype-framework/client";
import type { Banner, Site } from "../../shared/types";
import { button, el, section } from "../dom";

/** Admins only: set or clear the site banner (DEMO-REQ-004). The server guard is the protection. */
export function adminPage(site: Site): HTMLElement {
  const page = section("Admin");
  const input = el("input");
  input.placeholder = "Banner message";
  input.maxLength = 500;
  input.value = site.banner ?? "";
  const message = el("p");
  page.append(
    el("h3", "Site banner"),
    input,
    button("Save banner", message, async () => {
      await api<Banner>("/banner", { method: "PUT", body: { banner: input.value } });
      window.location.reload();
    }),
    button("Clear banner", message, async () => {
      await api<Banner>("/banner", { method: "PUT", body: { banner: null } });
      window.location.reload();
    }),
    message,
  );
  return page;
}
