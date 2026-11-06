/* Plain DTCG files, placed by the mapping the designer confirms on the
   connect screen: each file as base, as a context of an axis, or left out;
   and modes kept in a token's `$extensions` ({ "<axis>": { "<context>":
   value } }), where the token's `$value` is the default context. Both can
   be mixed. The suggestion comes from the names; nothing is applied until
   the designer confirms it. */

import type { Axis, Issue, Mapping, ReadResult, Source, Tree } from "../model";
import { isObject } from "../tokens";
import type { FolderFiles } from "./files";

/** Context names the plugin knows, and the axis each suggests. */
const KNOWN: Record<string, string> = {
  light: "mode", dark: "mode", dim: "mode", "high-contrast": "mode",
  compact: "viewport", medium: "viewport", expanded: "viewport", mobile: "viewport", tablet: "viewport", desktop: "viewport", small: "viewport", large: "viewport",
  comfortable: "density", dense: "density", spacious: "density",
  reduced: "motion", full: "motion",
};
const DEFAULT_FIRST = ["light", "compact", "mobile", "small", "regular", "full", "standard", "default"];
/** The order of the contexts the plugin knows: small to large, light to dark. */
const ORDER = ["default", "standard", "light", "dark", "dim", "high-contrast", "mobile", "small", "compact", "medium", "tablet", "expanded", "large", "desktop", "regular", "comfortable", "dense", "spacious", "full", "reduced"];
const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
/** Axis names the plugin knows: `<axis>.<context>` is a context of that axis even when it is the only one. */
const AXES = ["brand", "theme", "mode", "scheme", "viewport", "density", "motion", "platform", "contrast"];
/** The name of the context a lone context's axis gets for the base itself. */
export const IMPLICIT_DEFAULT = "default";

const stem = (path: string) => path.split("/").at(-1)!.replace(/\.tokens\.json$|\.json$/i, "");

/** Extension keys whose values have the shape of modes ({ axis: { context: value } }), with how many tokens carry each. */
export function extensionKeysOf(files: FolderFiles): Record<string, { axes: Record<string, string[]>; tokens: number }> {
  const out: Record<string, { axes: Record<string, string[]>; tokens: number }> = {};
  const walk = (node: unknown) => {
    if (!isObject(node)) return;
    if ("$value" in node) {
      const ext = node.$extensions;
      if (!isObject(ext)) return;
      for (const [key, v] of Object.entries(ext)) {
        if (!isObject(v) || !Object.values(v).length || !Object.values(v).every((ax) => isObject(ax) && Object.keys(ax).length > 0)) continue;
        /* A value per context: never a nested object of objects (that is other metadata). */
        if (Object.values(v).some((ax) => Object.values(ax as Tree).every((x) => isObject(x) && !("value" in x) && !("colorSpace" in x)))) continue;
        const entry = (out[key] ??= { axes: {}, tokens: 0 });
        entry.tokens++;
        for (const [axis, contexts] of Object.entries(v)) entry.axes[axis] = [...new Set([...(entry.axes[axis] ?? []), ...Object.keys(contexts as Tree)])];
      }
      return;
    }
    Object.values(node).forEach(walk);
  };
  for (const f of files.tokenFiles) walk(files.json[f]);
  return out;
}

/** The mapping the names suggest: `<axis>.<context>` (or a known context name) is a context; the rest is base. */
export function suggestMapping(files: FolderFiles): Mapping {
  const byFirst = new Map<string, string[]>();
  for (const f of files.tokenFiles) {
    const parts = stem(f).split(/[.\-_]/);
    if (parts.length >= 2) byFirst.set(parts[0], [...(byFirst.get(parts[0]) ?? []), parts.slice(1).join("-")]);
  }
  const mapping: Mapping = { files: {}, axes: {} };
  const place = (axis: string, context: string) => {
    const a = (mapping.axes![axis] ??= { contexts: [], default: "" });
    if (!a.contexts.includes(context)) a.contexts.push(context);
  };
  for (const f of files.tokenFiles) {
    const parts = stem(f).toLowerCase().split(/[.\-_]/);
    const known = parts.find((p) => KNOWN[p]);
    const rest = parts.slice(1).join("-");
    if (known) {
      /* tone.light → mode, light: the known word says the axis, unless the first word is an axis of its own with siblings. */
      const axis = parts.length >= 2 && (byFirst.get(parts[0])?.length ?? 0) >= 2 && !KNOWN[parts[0]] && !["tone", "color", "colors", "theme", "tokens"].includes(parts[0]) ? parts[0] : KNOWN[known];
      mapping.files[f] = { kind: "context", axis, context: known };
      place(axis, known);
    } else if (parts.length >= 2 && ((byFirst.get(parts[0])?.length ?? 0) >= 2 || AXES.includes(parts[0]))) {
      mapping.files[f] = { kind: "context", axis: parts[0], context: rest };
      place(parts[0], rest);
    } else mapping.files[f] = { kind: "base" };
  }
  const ext = Object.entries(extensionKeysOf(files)).sort((a, b) => b[1].tokens - a[1].tokens)[0];
  if (ext) {
    const defaults: Record<string, string> = {};
    for (const [axis, contexts] of Object.entries(ext[1].axes)) {
      const fileAxis = mapping.axes![axis];
      const guess = fileAxis?.contexts.find((c) => !contexts.includes(c)) ?? (contexts.includes("dark") ? "light" : "default");
      defaults[axis] = guess;
      place(axis, guess);
      for (const c of contexts) place(axis, c);
    }
    mapping.extension = { key: ext[0], defaults };
  }
  for (const a of Object.values(mapping.axes!)) {
    /* A lone context (brand.premium): the base is the axis's other context. */
    if (a.contexts.length === 1) a.contexts.unshift(IMPLICIT_DEFAULT);
    a.contexts.sort((x, y) => (DEFAULT_FIRST.includes(y) ? 1 : 0) - (DEFAULT_FIRST.includes(x) ? 1 : 0) || rank(x) - rank(y));
    a.default = a.contexts.find((c) => DEFAULT_FIRST.includes(c)) ?? a.contexts[0];
  }
  return mapping;
}

/**
 * What the suggestion couldn't tell: files it made base though their name has
 * parts (brand.vip), and axes with a single context. These are the questions
 * worth asking; the rest is assumed, and shown only on request.
 */
export function mappingDoubts(files: FolderFiles, mapping: Mapping): { files: string[]; axes: string[] } {
  const doubtFiles = files.tokenFiles.filter((f) => mapping.files[f]?.kind === "base" && stem(f).split(/[.]/).length >= 2);
  const axes = Object.entries(mapping.axes ?? {}).filter(([, a]) => a.contexts.length < 2).map(([n]) => n);
  return { files: doubtFiles, axes };
}

/** Token files no mapping places: they stay out until the designer maps them, or marks them as left out. */
export const unmappedOf = (files: FolderFiles, mapping: Mapping) => files.tokenFiles.filter((f) => !mapping.files[f]);

/** The layers a confirmed mapping makes. */
export function readMapped(files: FolderFiles, mapping: Mapping): ReadResult {
  const issues: Issue[] = [...files.issues];
  const base: Source[] = [];
  const axes = new Map<string, Axis>();
  const axisOf = (name: string) => {
    let a = axes.get(name);
    if (!a) {
      const declared = mapping.axes?.[name];
      a = { name, default: declared?.default ?? "", contexts: (declared?.contexts ?? []).map((c) => ({ name: c, sources: [] })) };
      axes.set(name, a);
    }
    return a;
  };
  const contextOf = (a: Axis, name: string) => {
    let c = a.contexts.find((x) => x.name === name);
    if (!c) a.contexts.push((c = { name, sources: [] }));
    if (!a.default) a.default = name;
    return c;
  };
  for (const name of Object.keys(mapping.axes ?? {})) axisOf(name);
  const used: string[] = [];
  for (const f of files.tokenFiles) {
    const m = mapping.files[f];
    if (!m || m.kind === "out") continue;
    used.push(f);
    const src: Source = { origin: { file: f }, tree: files.json[f] as Tree, syntax: "dtcg" };
    if (m.kind === "base") base.push(src);
    else contextOf(axisOf(m.axis), m.context).sources.push(src);
  }
  /* Modes in $extensions: each context's values as a tree of its own, from the base files. */
  if (mapping.extension?.key) {
    const key = mapping.extension.key;
    for (const src of [...base]) {
      const byAxisCtx = new Map<string, Tree>();
      const walk = (node: unknown, path: string[]) => {
        if (!isObject(node)) return;
        if ("$value" in node) {
          const modes = isObject(node.$extensions) ? node.$extensions[key] : undefined;
          if (!isObject(modes)) return;
          for (const [axis, contexts] of Object.entries(modes)) {
            if (!isObject(contexts)) continue;
            for (const [ctx, value] of Object.entries(contexts)) {
              const k = `${axis}\u0000${ctx}`;
              const tree = byAxisCtx.get(k) ?? {};
              let at = tree;
              for (const p of path.slice(0, -1)) at = (at[p] ??= {}) as Tree;
              at[path.at(-1)!] = { $value: value, ...(node.$type ? { $type: node.$type } : {}) };
              byAxisCtx.set(k, tree);
            }
          }
          return;
        }
        for (const [k, v] of Object.entries(node)) if (!k.startsWith("$")) walk(v, [...path, k]);
      };
      walk(src.tree, []);
      for (const [k, tree] of byAxisCtx) {
        const [axis, ctx] = k.split("\u0000");
        const a = axisOf(axis);
        if (!a.default) a.default = mapping.extension.defaults[axis] ?? "default";
        contextOf(a, a.default);
        contextOf(a, ctx).sources.push({ origin: { file: src.origin.file, extension: { key, axis, context: ctx } }, tree, syntax: "dtcg" });
      }
    }
  }
  for (const a of axes.values()) {
    if (!a.default) a.default = a.contexts[0]?.name ?? "";
    if (a.contexts.length < 2) issues.push({ level: "warning", message: `The axis "${a.name}" has ${a.contexts.length} context${a.contexts.length === 1 ? "" : "s"}: it makes no choice in Figma.` });
  }
  const unmapped = unmappedOf(files, mapping);
  for (const f of unmapped) issues.push({ level: "warning", file: f, message: `${f} is new and isn't in the mapping: it stays out until you map it, or mark it as left out.` });
  return { format: "mapped", layers: { base, axes: [...axes.values()].filter((a) => a.contexts.length) }, issues, files: used, unmapped };
}
