/**
 * The sender's display name (mail.md §2 "Interface"; MAIL-REQ-003): `framework.email.senderName`
 * from the stage configuration, defaulting to the app name. The stage configuration holds no
 * address or domain. Workers-compatible.
 */
import type { ResolvedConfig } from "../config/resolve.js";

export function mailSenderName(resolved: ResolvedConfig): string {
  // `email` joins ResolvedConfig with the stage-config Zod mirror (item I-E); read it when present.
  const email = (resolved as { readonly email?: { readonly senderName?: unknown } }).email;
  const name = email?.senderName;
  return typeof name === "string" && name.trim() !== "" ? name : resolved.deployment.app;
}
