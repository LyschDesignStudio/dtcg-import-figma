/* Which layout a folder holds, and the one entry that reads a folder in a chosen layout into a plan. */

import type { Format, Mapping, Plan, ReadResult } from "./model";
import { planFromLayers } from "./plan";
import { readFolder, type FolderFiles } from "./readers/files";
import { readMapped, suggestMapping } from "./readers/mapped";
import { readResolver } from "./readers/resolver";
import { readTokensStudio } from "./readers/tokens-studio";

export interface Detection {
  /** What fits, the suggestion first. */
  candidates: Format[];
  suggested: Format | null;
  resolvers: string[];
  tokenFiles: number;
}

/** From the folder's paths and what its files hold. */
export function detect(paths: string[], files?: FolderFiles): Detection {
  const candidates: Format[] = [];
  const resolvers = (files?.resolvers ?? paths.filter((p) => /\.resolver\.json$/i.test(p))).sort();
  if (resolvers.length) candidates.push("resolver");
  if ((files?.themes.length ?? 0) > 0 || paths.some((p) => p.split("/").at(-1) === "$themes.json")) candidates.push("tokens-studio");
  const tokenFiles = files?.tokenFiles.length ?? 0;
  if (tokenFiles) candidates.push("mapped");
  /* One resolver is unambiguous; several are a choice to make. */
  const suggested = resolvers.length === 1 ? "resolver" : candidates.includes("tokens-studio") ? "tokens-studio" : candidates.length === 1 && candidates[0] === "mapped" ? "mapped" : null;
  return { candidates, suggested, resolvers, tokenFiles };
}

/** True when the designer has to choose: more than one layout fits, or none does. */
export const needsChoice = (d: Detection) => d.suggested === null || d.candidates.length > 1;

export interface ReadInput {
  format: Format;
  resolver?: string;
  mapping?: Mapping;
  remBase?: number;
  name?: string;
}

/** The folder's texts → its layers in a layout → the plan. Throws a ReadError when the layout can't be read (with its path). */
export function readAndPlan(texts: Record<string, string>, input: ReadInput): { files: FolderFiles; read: ReadResult; plan: Plan } {
  const files = readFolder(texts);
  let read: ReadResult;
  if (input.format === "resolver") {
    const path = input.resolver ?? files.resolvers[0];
    if (!path) throw new Error("There is no *.resolver.json in the folder.");
    read = readResolver(files, path);
  } else if (input.format === "tokens-studio") read = readTokensStudio(files);
  else read = readMapped(files, input.mapping ?? suggestMapping(files));
  return { files, read, plan: planFromLayers(read, { remBase: input.remBase, name: input.name }) };
}

export interface TokenFolder {
  /** Relative to the repository's root; "" for the root. */
  folder: string;
  kind: Format;
}

const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const SKIP = /(^|\/)(node_modules|dist|build|\.[^/]+)(\/|$)/;
const RANK: Record<Format, number> = { resolver: 0, "tokens-studio": 1, mapped: 2 };

/**
 * The folders of a repository that hold tokens, from its paths alone: a
 * resolver, Tokens Studio's themes, or plain token files. A folder inside one already found is part of it.
 */
export function findTokenFolders(paths: string[]): TokenFolder[] {
  const found: TokenFolder[] = [];
  const add = (folder: string, kind: Format) => found.push({ folder, kind });
  for (const p of paths) {
    if (SKIP.test(p)) continue;
    if (/\.resolver\.json$/i.test(p)) add(dir(p), "resolver");
    else if (p.split("/").at(-1) === "$themes.json") add(dir(p), "tokens-studio");
    else if (/\.tokens\.json$/i.test(p)) add(dir(p), "mapped");
  }
  const sorted = found.sort((a, b) => a.folder.length - b.folder.length || RANK[a.kind] - RANK[b.kind]);
  const out: TokenFolder[] = [];
  for (const f of sorted) {
    /* Plain token files inside a folder already found are part of it (a resolver's modes/, a mapped folder's subfolders). */
    const inside = out.some((o) => o.folder === f.folder || (f.kind === "mapped" && (o.folder === "" || f.folder.startsWith(`${o.folder}/`))));
    if (!inside) out.push(f);
    else {
      /* The same folder, found as a stronger kind: that one wins. */
      const same = out.find((o) => o.folder === f.folder);
      if (same && RANK[f.kind] < RANK[same.kind]) same.kind = f.kind;
    }
  }
  return out.sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.folder.localeCompare(b.folder));
}
