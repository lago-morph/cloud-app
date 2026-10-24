import { api, downloadUrl, uploadFile, type DownloadTicket, type UploadTicket } from "@lago-morph/prototype-framework/client";
import type { FilePage } from "../../shared/types";
import { describeError, el, section } from "../dom";

function testId<T extends HTMLElement>(node: T, id: string): T {
  node.dataset["testid"] = id;
  return node;
}

/**
 * Photos (E2E-009, FILES-AC-003): upload through `uploadFile`, view and download through
 * `downloadUrl`. Files go under `photos/<user id>/`.
 */
export function filesPage(userId: string): HTMLElement {
  const folder = `photos/${userId}/`;
  const page = testId(section("Photos"), "files");
  const picker = testId(el("input"), "file-input");
  picker.type = "file";
  const upload = testId(el("button", "Upload"), "upload");
  const status = testId(el("p"), "upload-status");
  const list = testId(el("ul"), "files-list");
  page.append(picker, upload, status, list);

  async function item(name: string, size: number): Promise<HTMLElement> {
    const { ticket } = await api<{ ticket: DownloadTicket }>("/files/download-ticket", { method: "POST", body: { name } });
    const url = downloadUrl(ticket);
    const node = testId(el("li", `${name.slice(folder.length)} (${size} bytes) `), "file");
    const preview = testId(el("img"), "preview");
    preview.src = url;
    preview.alt = name.slice(folder.length);
    preview.width = 160;
    const link = testId(el("a", "Download"), "download");
    link.href = url;
    link.download = name.slice(folder.length);
    node.append(link, el("br"), preview);
    return node;
  }

  async function refresh(): Promise<void> {
    const { items } = await api<FilePage>("/files/list", { query: { prefix: folder } });
    list.replaceChildren(...(await Promise.all(items.map((f) => item(f.name, f.size)))));
  }

  upload.addEventListener("click", () => {
    const file = picker.files?.[0];
    if (file === undefined) {
      status.textContent = "Choose a file first.";
      return;
    }
    status.textContent = "Uploading…";
    const contentType = file.type === "" ? "application/octet-stream" : file.type;
    void api<{ ticket: UploadTicket }>("/files/upload-ticket", { method: "POST", body: { name: folder + file.name, contentType } })
      .then(({ ticket }) =>
        uploadFile(ticket, file, {
          onProgress: (p) => {
            status.textContent = `Uploading… ${p.loaded} of ${p.total} bytes`;
          },
        }),
      )
      .then(refresh)
      .then(() => {
        status.textContent = "Uploaded.";
      })
      .catch((error: unknown) => {
        status.textContent = describeError(error);
      });
  });

  void refresh().catch((error: unknown) => {
    status.textContent = describeError(error);
  });
  return page;
}
