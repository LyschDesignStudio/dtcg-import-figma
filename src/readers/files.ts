/* Which files of the folder are read and what each holds: tokens, a resolver,
   Tokens Studio's themes and metadata, or nothing to read. */

import type { Issue } from "../model";
import { hasTokens, isObject, parseJsonSafely } from "../tokens";

/** Every .json under the folder, except packages, builds, dot-folders and generated permutations. */
export function isCandidate(path: string): boolean {
  if (!path.toLowerCase().endsWith(".json")) return false;
  const parts = path.split("/");
  const name = parts.at(-1)!;
  if (parts.slice(0, -1).some((d) => d === "node_modules" || d === "dist" || d === "build" || d.startsWith("."))) return false;
  if (/^package(-lock)?\.json$|^package\..*\.json$|^tsconfig.*\.json$/i.test(name)) return false;
  if (/\.resolved\.json$/i.test(name)) return false;
  if (name.startsWith(".")) return false;
  return true;
}

export const isResolverFile = (path: string) => /\.resolver\.json$/i.test(path);
export const isThemesFile = (path: string) => path.split("/").at(-1) === "$themes.json";
export const isMetadataFile = (path: string) => path.split("/").at(-1) === "$metadata.json";

export interface FolderFiles {
  /** Every file that parsed, by path relative to the folder. */
  json: Record<string, unknown>;
  /** Files that didn't parse, and why. */
  broken: Record<string, string>;
  /** Files holding at least one token. */
  tokenFiles: string[];
  resolvers: string[];
  /** Tokens Studio's `$themes.json` (or a single file holding `$themes`). */
  themes: string[];
  issues: Issue[];
}

/** The candidates' texts → what each holds. A file with no token and no role is skipped quietly; a broken one is an issue. */
export function readFolder(texts: Record<string, string>): FolderFiles {
  const out: FolderFiles = { json: {}, broken: {}, tokenFiles: [], resolvers: [], themes: [], issues: [] };
  for (const path of Object.keys(texts).filter(isCandidate).sort()) {
    let json: unknown;
    const dropped = { count: 0 };
    try {
      json = parseJsonSafely(texts[path], dropped);
    } catch (e) {
      out.broken[path] = (e as Error).message;
      out.issues.push({ level: "error", file: path, message: `${path} isn't valid JSON (${(e as Error).message}); it was skipped.` });
      continue;
    }
    if (dropped.count) out.issues.push({ level: "warning", file: path, message: `${path} has keys named __proto__, constructor or prototype; they were ignored.` });
    if (isResolverFile(path)) {
      out.json[path] = json;
      out.resolvers.push(path);
    } else if (isThemesFile(path) || isMetadataFile(path)) {
      out.json[path] = json;
      if (isThemesFile(path)) out.themes.push(path);
    } else if (hasTokens(json)) {
      out.json[path] = json;
      out.tokenFiles.push(path);
      if (isObject(json) && Array.isArray(json.$themes)) out.themes.push(path);
    } else if (isObject(json)) {
      /* No token (yet): skipped quietly, but kept for a resolver that points at it. */
      out.json[path] = json;
    }
  }
  return out;
}
