/* Tokens Studio: token sets (files in folders, or keys of one file), with
   `$themes.json` and `$metadata.json`. Each theme group is an axis and each
   theme in it a context. A set enabled in every theme is base; one enabled in
   only some themes of a group belongs to those contexts; a `source` set only
   resolves references; a `disabled` one is ignored. */

import type { Axis, FigmaRefs, Issue, ReadResult, Source, Tree } from "../model";
import { isObject } from "../tokens";
import type { FolderFiles } from "./files";
import { ReadError } from "./resolver";

interface Theme {
  id?: string;
  name: string;
  group?: string;
  selectedTokenSets?: Record<string, string>;
  $figmaCollectionId?: string;
  $figmaModeId?: string;
  $figmaVariableReferences?: Record<string, string>;
}

export function readTokensStudio(files: FolderFiles): ReadResult {
  const issues: Issue[] = [...files.issues];
  const themesPath = files.themes[0];
  if (!themesPath) throw new ReadError("There is no $themes.json in the folder.");
  const single = !themesPath.endsWith("$themes.json");
  const doc = files.json[themesPath];
  const rawThemes = single ? (doc as Tree).$themes : doc;
  if (!Array.isArray(rawThemes)) throw new ReadError(`${themesPath}: the themes must be a list.`, themesPath);
  const themes = rawThemes.filter((t): t is Theme => isObject(t) && typeof t.name === "string");
  const dir = themesPath.includes("/") ? themesPath.slice(0, themesPath.lastIndexOf("/") + 1) : "";

  /* The sets: one file each (folder/name.json), or the keys of one file. */
  const sets = new Map<string, Source>();
  if (single) {
    for (const [name, tree] of Object.entries(doc as Tree)) {
      if (name.startsWith("$") || !isObject(tree)) continue;
      sets.set(name, { origin: { file: themesPath, set: name, pointer: `/${name.replace(/~/g, "~0").replace(/\//g, "~1")}` }, tree, syntax: "tokens-studio" });
    }
  } else {
    for (const path of files.tokenFiles) {
      if (!path.startsWith(dir)) continue;
      const name = path.slice(dir.length).replace(/\.json$/i, "");
      sets.set(name, { origin: { file: path, set: name }, tree: files.json[path] as Tree, syntax: "tokens-studio" });
    }
  }
  const metaPath = `${dir}$metadata.json`;
  const meta = single ? (doc as Tree).$metadata : files.json[metaPath];
  const order = isObject(meta) && Array.isArray(meta.tokenSetOrder) ? (meta.tokenSetOrder as string[]) : [...sets.keys()];
  const ordered = [...order.filter((s) => sets.has(s)), ...[...sets.keys()].filter((s) => !order.includes(s))];
  for (const s of order) if (!sets.has(s)) issues.push({ level: "warning", message: `$metadata.json lists the set "${s}", which isn't in the folder.` });

  /* The groups, in the order their first theme appears. */
  const groups: string[] = [];
  for (const t of themes) {
    const g = t.group || "theme";
    if (!groups.includes(g)) groups.push(g);
  }
  const themesOf = (g: string) => themes.filter((t) => (t.group || "theme") === g);
  const status = (t: Theme, set: string) => t.selectedTokenSets?.[set] ?? "disabled";

  const base: Source[] = [];
  const resolveOnly: Source[] = [];
  const inContext = new Map<string, Map<string, Source[]>>(groups.map((g) => [g, new Map(themesOf(g).map((t) => [t.name, []]))]));
  for (const name of ordered) {
    const src = sets.get(name)!;
    if (!themes.length) {
      base.push(src);
      continue;
    }
    const partial: string[] = [];
    let everywhere = true;
    let anywhere = false;
    for (const g of groups) {
      const on = themesOf(g).filter((t) => status(t, name) === "enabled");
      if (on.length) anywhere = true;
      if (on.length !== themesOf(g).length) everywhere = false;
      if (on.length && on.length < themesOf(g).length) partial.push(g);
    }
    if (everywhere) base.push(src);
    else if (partial.length > 1) issues.push({ level: "error", file: src.origin.file, message: `The set "${name}" is enabled in only some themes of ${partial.join(" and ")}: a set can vary on one group. It was left out.` });
    else if (partial.length === 1) {
      for (const t of themesOf(partial[0])) if (status(t, name) === "enabled") inContext.get(partial[0])!.get(t.name)!.push(src);
    } else if (anywhere) base.push(src);
    else if (themes.some((t) => status(t, name) === "source")) resolveOnly.push(src);
  }

  const axes: Axis[] = groups.map((g) => {
    const list = themesOf(g);
    if (list.length < 2) issues.push({ level: "warning", message: `The theme group "${g}" has one theme: it is read, but it makes no choice.` });
    return { name: g, default: list[0].name, contexts: list.map((t) => ({ name: t.name, sources: inContext.get(g)!.get(t.name)! })) };
  });

  const figmaRefs: FigmaRefs = { collections: [], variables: {} };
  for (const t of themes) {
    if (t.$figmaCollectionId || t.$figmaModeId) figmaRefs.collections.push({ axis: t.group || "theme", context: t.name, collectionId: t.$figmaCollectionId, modeId: t.$figmaModeId });
    if (isObject(t.$figmaVariableReferences)) Object.assign(figmaRefs.variables, t.$figmaVariableReferences);
  }

  const used = [...base, ...resolveOnly, ...[...inContext.values()].flatMap((m) => [...m.values()].flat())].map((s) => s.origin.file);
  return { format: "tokens-studio", layers: { base, axes, resolveOnly }, issues, files: [...new Set(used)], figmaRefs };
}
