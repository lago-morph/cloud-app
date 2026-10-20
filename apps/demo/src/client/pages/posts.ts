import { api, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { Created, DraftList, PostPage, PostSummary, Preferences } from "../../shared/types";
import { button, describeError, el, formatTime, link, section } from "../dom";

const PER_PAGE_CHOICES = [5, 10, 20, 50];

function postItem(post: PostSummary): HTMLLIElement {
  const item = el("li");
  item.append(link(post.title, `/posts/${encodeURIComponent(post.id)}`), el("span", ` by ${post.authorName ?? "someone"}, ${formatTime(post.createdAt)}`));
  return item;
}

/** Published posts, newest first, a page at a time (DEMO-REQ-001), with the posts-per-page choice (DEMO-REQ-005). */
export function homePage(user: CurrentUser): HTMLElement {
  const page = section("Posts");
  const message = el("p");
  const list = el("ul");
  const nav = el("p");
  let current = 1;

  async function show(n: number): Promise<void> {
    const result = await api<PostPage>("/posts", { query: { page: String(n) } });
    current = result.page;
    list.replaceChildren(...result.posts.map(postItem));
    if (result.posts.length === 0) list.append(el("li", "No posts yet."));
    const prev = button("Newer", message, () => show(current - 1));
    prev.disabled = current <= 1;
    const next = button("Older", message, () => show(current + 1));
    next.disabled = !result.hasMore;
    nav.replaceChildren(prev, el("span", ` Page ${String(current)} `), next);
  }

  if (user.level !== "anonymous") {
    const label = el("label", "Posts per page: ");
    const select = el("select");
    for (const n of PER_PAGE_CHOICES) {
      const option = el("option", String(n));
      option.value = String(n);
      select.append(option);
    }
    label.append(select);
    select.addEventListener("change", () => {
      void api<Preferences>("/preferences", { method: "PUT", body: { perPage: Number(select.value) } })
        .then(() => show(1))
        .catch((error: unknown) => {
          message.textContent = describeError(error);
        });
    });
    void api<Preferences>("/preferences")
      .then(({ perPage }) => {
        if (!PER_PAGE_CHOICES.includes(perPage)) {
          const option = el("option", String(perPage));
          option.value = String(perPage);
          select.append(option);
        }
        select.value = String(perPage);
      })
      .catch((error: unknown) => {
        message.textContent = describeError(error);
      });
    page.append(label);
  }

  page.append(message, list, nav);
  void show(1).catch((error: unknown) => {
    message.textContent = describeError(error);
  });
  return page;
}

/** The user's drafts and a form for a new one (DEMO-REQ-002). */
export function draftsPage(): HTMLElement {
  const page = section("My drafts");
  const message = el("p");
  const list = el("ul");
  const titleInput = el("input");
  titleInput.placeholder = "Title";
  titleInput.maxLength = 120;
  const bodyInput = el("textarea");
  bodyInput.placeholder = "Text";
  bodyInput.rows = 5;
  const create = button("Create draft", message, async () => {
    const { id } = await api<Created>("/posts", { method: "POST", body: { title: titleInput.value, body: bodyInput.value } });
    window.location.assign(`/posts/${encodeURIComponent(id)}`);
  });
  const form = el("div");
  form.append(el("h3", "New draft"), titleInput, el("br"), bodyInput, el("br"), create);
  page.append(message, list, form);
  void api<DraftList>("/my/drafts")
    .then(({ posts }) => {
      list.replaceChildren(...posts.map(postItem));
      if (posts.length === 0) list.append(el("li", "No drafts."));
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
