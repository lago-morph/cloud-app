import { api, type CurrentUser } from "@lago-morph/prototype-framework/client";
import type { PostPage, PostSummary, Preferences } from "../../shared/types";
import { describeError, el, section } from "../dom";

/** A link to a post, its title shown as text. */
export function postLink(post: PostSummary): HTMLElement {
  const item = el("li");
  const link = el("a", post.title);
  link.href = `/?post=${encodeURIComponent(post.id)}`;
  item.append(link, ` (${post.status}, ${new Date(post.createdAt).toLocaleString()})`);
  return item;
}

/** Published posts, newest first, with pages; logged-in users choose the page size (DEMO-REQ-001, DEMO-REQ-005). */
export function postListPage(user: CurrentUser): HTMLElement {
  const page = section("Posts");
  const message = el("p");
  const list = el("ul");
  const prev = el("button", "Newer");
  const next = el("button", "Older");
  const position = el("span");
  page.append(list, prev, position, next, message);
  let current = 1;

  async function show(n: number): Promise<void> {
    const body = await api<PostPage>("/posts", { query: { page: String(n) } });
    current = body.page;
    list.replaceChildren(...body.posts.map(postLink));
    if (body.posts.length === 0) list.append(el("li", "No posts yet."));
    position.textContent = ` Page ${body.page} `;
    prev.disabled = body.page <= 1;
    next.disabled = !body.hasMore;
  }
  const report = (error: unknown): void => {
    message.textContent = describeError(error);
  };
  prev.addEventListener("click", () => void show(current - 1).catch(report));
  next.addEventListener("click", () => void show(current + 1).catch(report));

  if (user.level !== "anonymous") {
    const label = el("label", "Posts per page: ");
    const size = el("select");
    for (const n of [5, 10, 20, 50]) {
      const option = el("option", String(n));
      option.value = String(n);
      size.append(option);
    }
    label.append(size);
    page.append(label);
    void api<Preferences>("/preferences")
      .then(({ pageSize }) => {
        size.value = String(pageSize);
      })
      .catch(report);
    size.addEventListener("change", () => {
      void api<Preferences>("/preferences", { method: "PUT", body: { pageSize: Number(size.value) } })
        .then(() => show(1))
        .catch(report);
    });
  }

  void show(1).catch(report);
  return page;
}
