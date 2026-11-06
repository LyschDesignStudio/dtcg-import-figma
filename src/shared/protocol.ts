/* The messages between the UI (the iframe, which does all the networking)
   and main (the Figma sandbox, which does everything in the document).
   The UI calls main's methods by name; main answers each call by its id
   and streams progress while it works. */

import type { Progress } from "../apply";
import type { Handlers } from "../handlers";

/** What main does, by name: the parameter, and what it answers. */
export type MainMethods = { [K in keyof Handlers]: [Parameters<Handlers[K]>[0] extends undefined ? void : Parameters<Handlers[K]>[0], Awaited<ReturnType<Handlers[K]>>] };
export type MethodName = keyof MainMethods;

export type UiToMain = { type: "call"; id: number; method: MethodName; params: unknown };

export type MainToUi =
  | { type: "reply"; id: number; ok: true; data: unknown }
  | { type: "reply"; id: number; ok: false; error: string }
  | { type: "progress"; progress: Progress };
