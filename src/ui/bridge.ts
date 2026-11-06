/* Calls into main (src/main.ts) by name, as promises. */

import type { Progress } from "../apply";
import type { MainMethods, MainToUi, MethodName, UiToMain } from "../shared/protocol";

let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const progressListeners = new Set<(p: Progress) => void>();

window.addEventListener("message", (e: MessageEvent<{ pluginMessage?: MainToUi }>) => {
  const msg = e.data?.pluginMessage;
  if (!msg) return;
  if (msg.type === "progress") progressListeners.forEach((l) => l(msg.progress));
  if (msg.type === "reply") {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error));
  }
});

export function call<M extends MethodName>(method: M, ...params: MainMethods[M][0] extends void ? [] : [MainMethods[M][0]]): Promise<MainMethods[M][1]> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    parent.postMessage({ pluginMessage: { type: "call", id, method, params: params[0] } satisfies UiToMain }, "*");
  });
}

export function onProgress(listener: (p: Progress) => void) {
  progressListeners.add(listener);
  return () => {
    progressListeners.delete(listener);
  };
}
