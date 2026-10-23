import { api } from "@lago-morph/prototype-framework/client";
import type { Created, DraftList, Site } from "../../shared/types";
import { describeError, el, section } from "../dom";
import { postLink } from "./post-list";

/** Create a draft and list your own drafts (DEMO-REQ-002). */
export function draftsPage(site: Site): HTMLElement {
  const page = section("My drafts");
  const title = el("input");
  title.placeholder = "Title";
  title.maxLength = 120;
  const body = el("textarea");
  body.placeholder = "Text";
  const create = el("button", "Create draft");
  const message = el("p");
  const list = el("ul");
  page.append(title, body, create, el("p", `Up to ${site.maxPhotosPerPost} photos per post.`), message, list);

  async function refresh(): Promise<void> {
    const { posts } = await api<DraftList>("/my/drafts");
    list.replaceChildren(...posts.map(postLink));
  }

  create.addEventListener("click", () => {
    message.textContent = "";
    void api<Created>("/posts", { method: "POST", body: { title: title.value, body: body.value } })
      .then(({ id }) => {
        window.location.assign(`/?post=${encodeURIComponent(id)}`);
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}
