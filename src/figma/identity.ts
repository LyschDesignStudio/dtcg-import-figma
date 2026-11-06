/* How the plugin recognizes what is its own in a file: shared plugin data
   under one namespace. Names can change in Figma; these marks don't. */

export const NS = "dtcg_import";

export const KEYS = {
  /** figma.root: the file's link to its repository. */
  link: "link",
  /** a variable collection: the planned collection's key. */
  collection: "collection",
  /** a variable: { v: 1, path } */
  token: "token",
  /** a variable collection: { [modeId]: mode key } */
  modes: "modes",
  /** a text or effect style: its id (the token's or the group's path) */
  style: "style",
  /** a variable, style, collection or mode list the repository no longer has: "1" */
  removed: "removed",
} as const;

type Data = { getSharedPluginData(ns: string, key: string): string; setSharedPluginData(ns: string, key: string, value: string): void };

export const getData = (node: Data, key: string) => node.getSharedPluginData(NS, key);
export const setData = (node: Data, key: string, value: string) => node.setSharedPluginData(NS, key, value);

export function getJson<T>(node: Data, key: string): T | null {
  const raw = getData(node, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
