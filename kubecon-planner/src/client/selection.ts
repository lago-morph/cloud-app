import { api } from "@lago-morph/prototype-framework/client";

/** Adds a session to (or removes it from) the signed-in user's schedule. */
export async function setSelected(sessionId: string, selected: boolean): Promise<void> {
  await api(`/my-schedule/${encodeURIComponent(sessionId)}`, { method: selected ? "PUT" : "DELETE" });
}

type Listener = (sessionId: string, selected: boolean) => void;
const listeners = new Set<Listener>();

/** Tells every view that a session's selection changed, so open views stay in step. */
export function announceSelection(sessionId: string, selected: boolean): void {
  for (const listener of listeners) listener(sessionId, selected);
}

export function onSelection(listener: Listener): void {
  listeners.add(listener);
}
