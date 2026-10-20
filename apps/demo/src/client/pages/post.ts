import { api, downloadUrl, uploadFile, type CurrentUser, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { Photo, PostDetail, PostSummary, ShareLink } from "../../shared/types";
import { button, describeError, el, section, when } from "../dom";

type Detail = PostDetail<DownloadTicket>;

/** The post's title, text and photos; all user text is set as text, never HTML (DEMO-REQ-001, -003). */
function render(post: Detail): HTMLElement {
  const article = el("article");
  article.append(el("h2", post.title));
  const meta = el("p", `${post.status === "draft" ? "Draft" : "Published"} · created ${when(post.createdAt)} · by ${post.authorId}`);
  meta.className = "meta";
  article.append(meta, el("p", post.body));
  for (const photo of post.photos) {
    const img = el("img");
    img.src = downloadUrl(photo.ticket);
    img.alt = `Photo of ${post.title}`;
    img.style.maxWidth = "100%";
    article.append(img);
  }
  return article;
}

/** The author's controls on their own draft: edit, add photos, share, delete. */
function authorControls(post: Detail): HTMLElement {
  const box = section("Edit draft");
  const message = el("p");
  const title = el("input");
  title.value = post.title;
  title.maxLength = 120;
  const body = el("textarea");
  body.value = post.body;
  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/jpeg,image/png";
  const shareOut = el("p");
  box.append(
    title,
    body,
    button("Save", message, async () => {
      await api<PostSummary>(`/posts/${post.id}`, { method: "PATCH", body: { title: title.value, body: body.value } });
      window.location.reload();
    }),
    el("h3", "Photos (JPEG or PNG)"),
    picker,
    button("Upload photo", message, async () => {
      const file = picker.files?.[0];
      if (file === undefined) {
        message.textContent = "Choose a photo first.";
        return;
      }
      const { photoId, ticket } = await api<{ photoId: string; ticket: UploadTicket }>(`/posts/${post.id}/photos/upload-ticket`, {
        method: "POST",
        body: { contentType: file.type },
      });
      await uploadFile(ticket, file, {
        onProgress: (p) => {
          message.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
        },
      });
      await api<Photo<DownloadTicket>>(`/posts/${post.id}/photos/finalize`, { method: "POST", body: { photoId } });
      window.location.reload();
    }),
    el("h3", "Share"),
    button("Create share link", message, async () => {
      const link = await api<ShareLink>(`/posts/${post.id}/share`, { method: "POST" });
      shareOut.textContent = `${window.location.origin}${link.path} (valid until ${when(link.expiresAt)})`;
    }),
    shareOut,
    message,
  );
  return box;
}

/** One post: published ones for everyone, drafts for their author and admins. */
export function postPage(id: string, user: CurrentUser): HTMLElement {
  const page = el("div");
  const message = el("p");
  page.append(message);
  void api<Detail>(`/posts/${id}`)
    .then((post) => {
      page.replaceChildren(render(post));
      const controls = el("p");
      const isAuthor = user.level !== "anonymous" && user.id === post.authorId;
      if (isAuthor && post.status === "draft") page.append(authorControls(post));
      if (user.level === "admin") {
        const action = post.status === "draft" ? "publish" : "unpublish";
        controls.append(
          button(action === "publish" ? "Publish" : "Unpublish", message, async () => {
            await api<PostSummary>(`/posts/${post.id}/${action}`, { method: "POST" });
            window.location.reload();
          }),
        );
      }
      if (user.level === "admin" || (isAuthor && post.status === "draft")) {
        controls.append(
          button("Delete post", message, async () => {
            await api(`/posts/${post.id}`, { method: "DELETE" });
            window.location.assign("/");
          }),
        );
      }
      page.append(controls, message);
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}

/** A draft opened through a share link: anyone with a valid link may view it (DEMO-REQ-007). */
export function sharedPostPage(token: string): HTMLElement {
  const page = el("div");
  const message = el("p");
  page.append(message);
  void api<Detail>(`/shared/${encodeURIComponent(token)}`)
    .then((post) => {
      page.replaceChildren(render(post));
    })
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });
  return page;
}
