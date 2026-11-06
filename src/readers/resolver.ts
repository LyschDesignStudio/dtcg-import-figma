/* DTCG with a resolver (the standard's Resolver Module, 2025.10): `sets`
   with `sources`, `modifiers` with `contexts` and `default`, and
   `resolutionOrder`. The sets in order are the base; each modifier is an
   axis. Only what 2025.10 defines is read; anything else is refused with
   its path, never guessed. */

import type { Axis, Issue, ReadResult, Source, Tree } from "../model";
import { isObject } from "../tokens";
import type { FolderFiles } from "./files";

export class ReadError extends Error {
  constructor(message: string, public path?: string) {
    super(message);
  }
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

/** A path relative to `from`'s folder, normalized; null when it leaves the folder. */
function join(from: string, rel: string): string | null {
  const parts = (dirOf(from) + rel).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (!out.length) return null;
      out.pop();
    } else out.push(p);
  }
  return out.join("/");
}

const decode = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");

function at(doc: unknown, pointer: string): unknown {
  let node = doc;
  for (const part of pointer.split("/").filter(Boolean).map(decode)) {
    if (Array.isArray(node)) node = node[Number(part)];
    else if (isObject(node)) node = node[part];
    else return undefined;
  }
  return node;
}

export function readResolver(files: FolderFiles, resolverPath: string): ReadResult {
  const issues: Issue[] = [...files.issues.filter((i) => !i.file || i.file !== resolverPath)];
  const doc = files.json[resolverPath];
  if (files.broken[resolverPath]) throw new ReadError(`${resolverPath} isn't valid JSON: ${files.broken[resolverPath]}`, resolverPath);
  if (!isObject(doc)) throw new ReadError(`${resolverPath} isn't a resolver document.`, resolverPath);
  if (doc.version !== "2025.10") throw new ReadError(`${resolverPath} is version ${JSON.stringify(doc.version ?? null)}; the plugin reads resolvers of version 2025.10.`, resolverPath);
  const used = new Set<string>();

  /** The sources a `$ref` or an inline item stands for, with cycles and escapes refused. */
  const expand = (item: unknown, where: string, seen: string[]): Source[] => {
    if (!isObject(item)) throw new ReadError(`${resolverPath} ${where}: a source must be an object ({ "$ref": … } or tokens).`, resolverPath);
    if (typeof item.$ref !== "string") {
      /* Inline tokens, read like a file. */
      return [{ origin: { file: resolverPath, pointer: where }, tree: item, syntax: "dtcg" }];
    }
    const ref = item.$ref;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("//")) throw new ReadError(`${resolverPath} ${where}: "${ref}" is a URL; the plugin reads only files of the folder.`, resolverPath);
    const [filePart, frag = ""] = ref.split("#");
    const key = `${filePart}#${frag}`;
    if (seen.includes(key)) throw new ReadError(`${resolverPath} ${where}: "${ref}" makes a cycle (${[...seen, key].join(" → ")}).`, resolverPath);
    if (!filePart) {
      /* Inside the document: a set or a modifier's context, or tokens. */
      const target = at(doc, frag);
      if (target === undefined) throw new ReadError(`${resolverPath} ${where}: "${ref}" points at nothing.`, resolverPath);
      const parts = frag.split("/").filter(Boolean);
      if (parts[0] === "sets" && parts.length === 2) return sourcesOf(target, `/${parts.join("/")}`, [...seen, key]);
      if (Array.isArray(target)) return target.flatMap((t, i) => expand(t, `${frag}/${i}`, [...seen, key]));
      if (isObject(target)) return [{ origin: { file: resolverPath, pointer: frag }, tree: target, syntax: "dtcg" }];
      throw new ReadError(`${resolverPath} ${where}: "${ref}" isn't a set or tokens.`, resolverPath);
    }
    const file = join(resolverPath, filePart);
    if (file === null) throw new ReadError(`${resolverPath} ${where}: "${ref}" leaves the folder.`, resolverPath);
    if (files.broken[file]) throw new ReadError(`${file}, which the resolver points at, isn't valid JSON: ${files.broken[file]}`, file);
    const json = files.json[file];
    if (json === undefined) throw new ReadError(`${file}, which the resolver points at, isn't in the folder.`, file);
    used.add(file);
    const tree = frag ? at(json, frag) : json;
    if (!isObject(tree)) throw new ReadError(`${resolverPath} ${where}: "${ref}" isn't a group of tokens.`, resolverPath);
    return [{ origin: frag ? { file, pointer: frag } : { file }, tree: tree as Tree, syntax: "dtcg" }];
  };

  const sourcesOf = (set: unknown, where: string, seen: string[] = []): Source[] => {
    if (!isObject(set) || !Array.isArray(set.sources)) throw new ReadError(`${resolverPath} ${where}: a set needs "sources".`, resolverPath);
    return set.sources.flatMap((s, i) => expand(s, `${where}/sources/${i}`, seen));
  };

  const axisOf = (name: string, m: unknown, where: string): Axis => {
    if (!isObject(m) || !isObject(m.contexts)) throw new ReadError(`${resolverPath} ${where}: a modifier needs "contexts".`, resolverPath);
    const names = Object.keys(m.contexts);
    if (names.length < 2) throw new ReadError(`${resolverPath} ${where}: the modifier "${name}" has ${names.length} context${names.length === 1 ? "" : "s"}; it needs at least two.`, resolverPath);
    const def = m.default === undefined ? names[0] : m.default;
    if (typeof def !== "string" || !names.includes(def)) throw new ReadError(`${resolverPath} ${where}: the default "${String(def)}" of "${name}" isn't one of its contexts (${names.join(", ")}).`, resolverPath);
    return {
      name,
      default: def,
      contexts: names.map((c) => {
        const list = (m.contexts as Tree)[c];
        if (!Array.isArray(list)) throw new ReadError(`${resolverPath} ${where}/contexts/${c}: a context is a list of sources.`, resolverPath);
        return { name: c, sources: list.flatMap((s, i) => expand(s, `${where}/contexts/${c}/${i}`, [])) };
      }),
    };
  };

  const sets = isObject(doc.sets) ? doc.sets : {};
  const modifiers = isObject(doc.modifiers) ? doc.modifiers : {};
  const order: unknown[] = Array.isArray(doc.resolutionOrder)
    ? doc.resolutionOrder
    : [...Object.keys(sets).map((s) => ({ $ref: `#/sets/${s}` })), ...Object.keys(modifiers).map((m) => ({ $ref: `#/modifiers/${m}` }))];

  const base: Source[] = [];
  const axes: Axis[] = [];
  order.forEach((item, i) => {
    const where = `/resolutionOrder/${i}`;
    if (!isObject(item)) throw new ReadError(`${resolverPath} ${where}: an item must be an object.`, resolverPath);
    if (typeof item.$ref === "string") {
      const m = item.$ref.match(/^#\/(sets|modifiers)\/([^/]+)$/);
      if (!m) throw new ReadError(`${resolverPath} ${where}: "${item.$ref}" isn't a set or a modifier of the document.`, resolverPath);
      const name = decode(m[2]);
      if (m[1] === "sets") {
        if (!(name in sets)) throw new ReadError(`${resolverPath} ${where}: there is no set "${name}".`, resolverPath);
        base.push(...sourcesOf(sets[name], `/sets/${name}`));
      } else {
        if (!(name in modifiers)) throw new ReadError(`${resolverPath} ${where}: there is no modifier "${name}".`, resolverPath);
        axes.push(axisOf(name, modifiers[name], `/modifiers/${name}`));
      }
      return;
    }
    /* Inline: a set ({ type: "set", sources }) or a modifier ({ type: "modifier", contexts }). */
    const name = typeof item.name === "string" ? item.name : `item ${i}`;
    if (item.type === "modifier" || isObject(item.contexts)) axes.push(axisOf(name, item, where));
    else base.push(...sourcesOf(item, where));
  });
  const names = axes.map((a) => a.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new ReadError(`${resolverPath}: the modifier "${dup}" is in the resolution order twice.`, resolverPath);

  for (const f of Object.keys(files.json)) {
    if (f !== resolverPath && !used.has(f) && files.tokenFiles.includes(f)) issues.push({ level: "warning", file: f, message: `${f} holds tokens, but the resolver doesn't point at it: it was left out.` });
  }
  return { format: "resolver", layers: { base, axes }, issues, files: [...used] };
}
