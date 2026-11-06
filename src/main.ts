/* The Figma sandbox: figma.variables, styles, the document, clientStorage.
   No network here; the UI reads the repository and hands the plan over. */

import { makeHandlers } from "./handlers";
import type { MainToUi, UiToMain } from "./shared/protocol";

/* Some readers use Array.prototype.at (ES2022); the sandbox may predate it. */
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    value(this: unknown[], i: number) {
      const n = Math.trunc(i) || 0;
      return this[n < 0 ? this.length + n : n];
    },
    configurable: true,
    writable: true,
  });
}

const post = (msg: MainToUi) => figma.ui.postMessage(msg);

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

const handlers = makeHandlers(figma, post);

figma.ui.onmessage = async (msg: UiToMain) => {
  if (msg?.type !== "call") return;
  try {
    const handler = handlers[msg.method] as (p: unknown) => unknown;
    post({ type: "reply", id: msg.id, ok: true, data: await handler(msg.params) });
  } catch (e) {
    post({ type: "reply", id: msg.id, ok: false, error: (e as Error).message ?? String(e) });
  }
};
