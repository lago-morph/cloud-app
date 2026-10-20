import { api, downloadUrl, uploadFile, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { Photo, PostDetail, ShareLink, Site } from "../../shared/types";
import { button, describeError, el, formatTime, link, section } from "../dom";

const PHOTO_TYPES = ["image/jpeg", "image/png"];

async function photoView(photo: Photo, share: string | null): Promise<HTMLElement> {
  const figure = el("figure");
  const { ticket } = await api<{ ticket: DownloadTicket }>(`/photos/${encodeURIComponent(photo.id)}/download-ticket`, {
    method: "POST",
    body: share === null ? {} : { share },
  });
  const img = el("img");
  img.src = downloadUrl(ticket);
  img.alt = photo.name;
  img.style.maxWidth = "100%";
  figure.append(img, el("figcaption", `${photo.name} (${String(photo.size)} bytes)`));
  return figure;
}

/** One post with its photos (DEMO-REQ-001, DEMO-REQ-003); with `share`, as seen through a share link (DEMO-REQ-007). */
function render(page: HTMLElement, post: PostDetail, site: Site, share: string | null, reload: () => Promise<void>): void {
  const message = el("p");
  const head = el("h2", post.title);
  const meta = el("p", `${post.status === "draft" ? "Draft" : "Published"} · by ${post.authorName ?? "someone"} · created ${formatTime(post.createdAt)} · updated ${formatTime(post.updatedAt)}`);
  const body = el("p", post.body);
  body.style.whiteSpace = "pre-wrap";
  const gallery = el("div");
  page.replaceChildren(head, meta, message, body, gallery);
  void Promise.all(post.photos.map((p) => photoView(p, share)))
    .then((views) => gallery.replaceChildren(...views))
    .catch((error: unknown) => {
      message.textContent = describeError(error);
    });

  const path = `/posts/${encodeURIComponent(post.id)}`;
  const actions = el("div");

  if (post.canEdit) {
    const titleInput = el("input");
    titleInput.value = post.title;
    titleInput.maxLength = 120;
    const bodyInput = el("textarea");
    bodyInput.value = post.body;
    bodyInput.rows = 5;
    const save = button("Save", message, async () => {
      await api<PostDetail>(path, { method: "PATCH", body: { title: titleInput.value, body: bodyInput.value } });
      await reload();
    });
    actions.append(el("h3", "Edit"), titleInput, el("br"), bodyInput, el("br"), save);

    const picker = el("input");
    picker.type = "file";
    picker.accept = PHOTO_TYPES.join(",");
    const progress = el("p");
    const upload = button("Upload photo", message, async () => {
      const file = picker.files?.[0];
      if (file === undefined) throw new Error("Choose a JPEG or PNG file first.");
      if (!PHOTO_TYPES.includes(file.type)) throw new Error("Only JPEG and PNG photos are accepted.");
      const { id, ticket } = await api<{ id: string; ticket: UploadTicket }>(`${path}/photos/upload-ticket`, { method: "POST", body: { contentType: file.type } });
      await uploadFile(ticket, file, {
        onProgress: (p) => {
          progress.textContent = `Uploading… ${String(p.loaded)} of ${String(p.total)} bytes`;
        },
      });
      await api<Photo>(`${path}/photos/finalize`, { method: "POST", body: { id, name: file.name } });
      progress.textContent = "Uploaded.";
      await reload();
    });
    actions.append(el("h3", `Photos (${String(post.photos.length)} of at most ${String(site.maxPhotosPerPost)})`), picker, upload, progress);

    const shareOut = el("p");
    const shareButton = button("Create share link", message, async () => {
      const { token, expiresAt } = await api<ShareLink>(`${path}/share`, { method: "POST" });
      const url = `${window.location.origin}/shared/${encodeURIComponent(token)}`;
      shareOut.replaceChildren(link(url, url), el("span", ` (valid until ${formatTime(expiresAt)})`));
    });
    actions.append(el("h3", "Share"), shareButton, shareOut);
  }

  if (post.canModerate) {
    const action = post.status === "draft" ? "publish" : "unpublish";
    actions.append(
      el("h3", "Moderation"),
      button(action === "publish" ? "Publish" : "Unpublish", message, async () => {
        await api<PostDetail>(`${path}/${action}`, { method: "POST" });
        await reload();
      }),
    );
  }

  if (post.canDelete) {
    actions.append(
      el("h3", "Delete"),
      button("Delete post", message, async () => {
        if (!window.confirm("Delete this post and its photos?")) return;
        await api(path, { method: "DELETE" });
        window.location.assign("/");
      }),
    );
  }

  page.append(actions, el("p"), link("Back to posts", "/"));
}

export function postPage(id: string, site: Site): HTMLElement {
  const page = section("Post");
  const load = async (): Promise<void> => {
    render(page, await api<PostDetail>(`/posts/${encodeURIComponent(id)}`), site, null, load);
  };
  void load().catch((error: unknown) => {
    page.replaceChildren(el("p", describeError(error)), link("Back to posts", "/"));
  });
  return page;
}

export function sharedPage(token: string, site: Site): HTMLElement {
  const page = section("Shared post");
  const load = async (): Promise<void> => {
    render(page, await api<PostDetail>(`/shared/${encodeURIComponent(token)}`), site, token, load);
  };
  void load().catch((error: unknown) => {
    page.replaceChildren(el("p", describeError(error)), link("Back to posts", "/"));
  });
  return page;
}
