/* Layers → what the Figma file should hold. The same rules for every
   layout, because they read the layers, not the files. Pure: no Figma. */

import { normalizeNumber } from "./shared/stable";
import type {
  AxisOut, Bound, DtcgSnapshot, FigmaType, Issue, Listed, Origin, Plan, PlannedCollection, PlannedEffectStyle, PlannedMode, PlannedShadowLayer,
  PlannedTextStyle, PlannedValue, PlannedVariable, ReadResult, Rgba, SnapValue,
} from "./model";
import { scopesFor } from "./scopes";
import { dimensionPx, FIGMA_TYPE, flatten, hasModifier, isMath, isObject, kindOf, literalOf, refOf, snapLiteral, type Kind, type RawToken } from "./tokens";

export const PRIMITIVES = "dtcg:base:literal";
export const SEMANTIC = "dtcg:base:reference";
export const axisCollection = (axis: string) => `dtcg:axis:${axis}`;
/** Figma's limit of variables per collection. */
export const MAX_VARIABLES = 5000;

const esc = (s: string) => s.replace(/[%=|]/g, (c) => encodeURIComponent(c));
export const modeKey = (pairs: [string, string][]) => (pairs.length ? pairs.map(([a, c]) => `${esc(a)}=${esc(c)}`).join("|") : "*");
const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const figmaName = (path: string) => path.split(".").join("/");

/** The order of a type scale's roles, largest first; a role not here comes after, in the repository's order. */
export const ROLE_ORDER = ["display", "hero", "headline", "heading", "title", "subtitle", "subheading", "body", "paragraph", "text", "label", "button", "caption", "overline", "footnote", "code", "mono"];
const PREFIXES = new Set(["type", "typography", "text", "textstyle", "textstyles", "font", "fonts"]);

/** Names text styles role/size, without a prefix they all share, and sorts them by role, then by size, largest first. */
export function shapeTextStyles(styles: PlannedTextStyle[]) {
  const first = (s: PlannedTextStyle) => s.name.split("/")[0];
  const shared = styles.length > 0 && styles.every((s) => first(s) === first(styles[0]) && s.name.includes("/")) ? first(styles[0]) : null;
  if (shared && PREFIXES.has(shared.toLowerCase().replace(/[-_]/g, ""))) for (const s of styles) s.name = s.name.slice(shared.length + 1);
  const seen = styles.map(first).filter((r, i, all) => all.indexOf(r) === i);
  const rank = (r: string) => {
    const i = ROLE_ORDER.indexOf(r.toLowerCase());
    return i >= 0 ? i : ROLE_ORDER.length + seen.indexOf(r);
  };
  const order = new Map(styles.map((s, i) => [s, i]));
  styles.sort((a, b) => rank(first(a)) - rank(first(b)) || (b.size?.value ?? 0) - (a.size?.value ?? 0) || order.get(a)! - order.get(b)!);
}

export interface PlanOptions {
  /** px per rem; 16 by default. */
  remBase?: number;
  name?: string;
}

interface Cell {
  raw: unknown;
  origin: Origin;
  syntax: RawToken["syntax"];
}

interface Entry {
  path: string;
  kind: Kind;
  type: FigmaType;
  tokenType: string;
  collection: string;
  /** By mode key. */
  cells: Record<string, Cell>;
  description: string;
}

export function planFromLayers(read: ReadResult, opts: PlanOptions = {}): Plan {
  const remBase = opts.remBase ?? 16;
  const issues: Issue[] = [...read.issues];
  const notInFigma: Listed[] = [];
  const refused: Listed[] = [];
  const axesOut: AxisOut[] = [];
  const { layers } = read;

  /* 1. Tokens, by layer (a later source of a layer overrides an earlier one). */
  const merge = (sources: typeof layers.base) => {
    const m = new Map<string, RawToken>();
    for (const s of sources) for (const t of flatten(s)) m.set(t.path, t);
    return m;
  };
  const base = merge(layers.base);
  const resolveOnly = merge(layers.resolveOnly ?? []);
  const ctx = new Map(layers.axes.map((a) => [a.name, new Map(a.contexts.map((c) => [c.name, merge(c.sources)]))]));

  /** The token in the default world: the base, with each axis's default context laid over it, in resolution order. */
  const defaultOf = (path: string): RawToken | undefined => {
    let t = base.get(path);
    for (const a of layers.axes) t = ctx.get(a.name)!.get(a.default)!.get(path) ?? t;
    if (!t) for (const a of layers.axes) for (const c of a.contexts) t ??= ctx.get(a.name)!.get(c.name)!.get(path);
    return t ?? resolveOnly.get(path);
  };

  /** A token's type: its own, the base's for the same path, or the one its reference leads to. */
  const typeOf = (t: RawToken, depth = 0): string | null => {
    if (t.type) return t.type;
    const b = base.get(t.path);
    if (b?.type) return b.type;
    const r = refOf(t.value);
    if (r && "path" in r && depth < 20) {
      const target = defaultOf(r.path);
      if (target) return typeOf(target, depth + 1);
    }
    return null;
  };

  /** Why a token makes no variable (its type, or Tokens Studio's math and modifiers); null when it may. */
  const outReason = (t: RawToken): string | null => {
    const type = typeOf(t);
    const kind = kindOf(type);
    if (kind === "typography" || kind === "shadow") return null;
    if (!FIGMA_TYPE[kind]) return type ? `${type} has no Figma variable` : "it has no type";
    if (isMath(t.value)) return "Tokens Studio math has no Figma value";
    if (hasModifier(t)) return "Tokens Studio's color modifiers have no Figma value";
    const r = refOf(t.value);
    if (r && "partial" in r) return `it points into the middle of a value (${r.partial})`;
    return null;
  };
  const isStyle = (t: RawToken) => ["typography", "shadow"].includes(kindOf(typeOf(t)));
  const fits = (t: RawToken) => !outReason(t) && !isStyle(t);

  /* 2. Axes: empty, not in Figma, adding a level, or swapping roles. */
  const levelOf = new Map<string, string>();
  const swapsOf = new Map<string, string[]>();
  const listedOut = new Set<string>();
  const listOut = (t: RawToken, reason: string) => {
    if (listedOut.has(t.path)) return;
    listedOut.add(t.path);
    notInFigma.push({ path: t.path, reason });
  };
  for (const t of [...base.values()]) {
    const why = outReason(t);
    if (why) listOut(t, why);
  }
  for (const a of layers.axes) {
    const all = [...ctx.get(a.name)!.values()].flatMap((m) => [...m.values()]);
    if (!all.length) {
      axesOut.push({ name: a.name, reason: "empty", count: 0 });
      continue;
    }
    const usable = all.filter(fits);
    for (const t of all) {
      const why = outReason(t);
      if (why) listOut(t, why);
      else if (isStyle(t)) listOut(t, "styles come from the base only");
    }
    if (!usable.length) {
      axesOut.push({ name: a.name, reason: "not-in-figma", count: new Set(all.map((t) => t.path)).size });
      continue;
    }
    /* Per token: one the base has is a role this axis swaps; one it doesn't is a level this axis adds. */
    for (const p of new Set(usable.map((t) => t.path))) {
      if (base.has(p)) swapsOf.set(p, [...(swapsOf.get(p) ?? []), a.name]);
      else if (levelOf.has(p)) {
        refused.push({ path: p, reason: `it is a level "${levelOf.get(p) || "another axis"}" adds, and "${a.name}" redefines it too: a token can vary on one such axis only` });
        levelOf.set(p, "");
      } else levelOf.set(p, a.name);
    }
  }
  const refusedPaths = () => new Set(refused.map((r) => r.path));

  /* 3. Entries: each token's collection and its cells by mode. */
  const axisByName = new Map(layers.axes.map((a) => [a.name, a]));
  const order = layers.axes.map((a) => a.name);
  const entries = new Map<string, Entry>();
  /* A Figma string variable holds one family; the rest of the stack (the fallbacks code uses) is said in its description. */
  const stackOf = (t: RawToken) => {
    if (kindOf(typeOf(t) ?? "") !== "fontFamily") return "";
    const list = Array.isArray(t.value) ? t.value.map(String) : typeof t.value === "string" && !t.value.trim().startsWith("{") ? t.value.split(",") : [];
    const names = list.map((f) => f.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return names.length > 1 ? `Font stack: ${names.join(", ")}.` : "";
  };
  const describe = (t: RawToken) => {
    const d = [t.description ?? "", stackOf(t)].filter(Boolean).join(" ");
    if (t.deprecated === undefined || t.deprecated === false) return d;
    const msg = typeof t.deprecated === "string" && t.deprecated ? `Deprecated: ${t.deprecated}` : "Deprecated.";
    return d ? `${msg} ${d}` : msg;
  };
  const kindAndType = (t: RawToken) => {
    const type = typeOf(t) ?? "";
    const kind = kindOf(type);
    return { type, kind, figma: FIGMA_TYPE[kind]! };
  };

  /* Base tokens: Primitives or Semantic, by their value; the swapping axes give their collection modes. */
  const collectionAxes = new Map<string, string[]>([[PRIMITIVES, []], [SEMANTIC, []]]);
  for (const t of base.values()) {
    if (!fits(t) || refusedPaths().has(t.path)) continue;
    const collection = refOf(t.value) ? SEMANTIC : PRIMITIVES;
    const axes = collectionAxes.get(collection)!;
    for (const a of swapsOf.get(t.path) ?? []) if (!axes.includes(a)) axes.push(a);
  }
  for (const [key, axes] of collectionAxes) {
    axes.sort((x, y) => order.indexOf(x) - order.indexOf(y));
    if (axes.length > 2) {
      const dropped = axes.splice(2);
      for (const [p, list] of swapsOf) {
        if (list.some((a) => dropped.includes(a)) && (refOf(base.get(p)?.value) ? SEMANTIC : PRIMITIVES) === key) {
          refused.push({ path: p, reason: `${title(key === PRIMITIVES ? "primitives" : "semantic")} would vary on three or more axes (${[...axes, ...dropped].join(", ")}); Figma's modes hold two` });
        }
      }
    }
  }
  const combos = (axes: string[]): [string, string][][] =>
    axes.reduce<[string, string][][]>((acc, a) => {
      const ax = axisByName.get(a)!;
      const list = [ax.contexts.find((c) => c.name === ax.default)!, ...ax.contexts.filter((c) => c.name !== ax.default)];
      return acc.flatMap((prefix) => list.map((c) => [...prefix, [a, c.name] as [string, string]]));
    }, [[]]);

  for (const t of base.values()) {
    if (!fits(t) || refusedPaths().has(t.path)) continue;
    const collection = refOf(t.value) ? SEMANTIC : PRIMITIVES;
    const axes = collectionAxes.get(collection)!;
    const { type, kind, figma } = kindAndType(t);
    const cells: Record<string, Cell> = {};
    for (const combo of combos(axes)) {
      let cell: Cell = { raw: t.value, origin: t.origin, syntax: t.syntax };
      for (const [a, c] of combo) {
        const o = ctx.get(a)!.get(c)!.get(t.path);
        if (o) cell = { raw: o.value, origin: o.origin, syntax: o.syntax };
      }
      cells[modeKey(combo)] = cell;
    }
    entries.set(t.path, { path: t.path, kind, type: figma, tokenType: type, collection, cells, description: describe(t) });
  }

  /* Level tokens: a collection per axis, a mode per context, the default first. */
  const levelAxes: string[] = [];
  for (const [p, a] of levelOf) {
    if (!a || refusedPaths().has(p)) continue;
    const axis = axisByName.get(a)!;
    const byCtx = ctx.get(a)!;
    const def = byCtx.get(axis.default)!.get(p) ?? axis.contexts.map((c) => byCtx.get(c.name)!.get(p)).find(Boolean)!;
    if (!fits(def)) continue;
    const { type, kind, figma } = kindAndType(def);
    const cells: Record<string, Cell> = {};
    for (const c of axis.contexts) {
      let t = byCtx.get(c.name)!.get(p);
      if (!t) {
        t = def;
        issues.push({ level: "warning", path: p, message: `${p} isn't in ${a}'s "${c.name}" context; it takes ${def === byCtx.get(axis.default)!.get(p) ? `the default's ("${axis.default}")` : "another context's"} value there.` });
      }
      cells[modeKey([[a, c.name]])] = { raw: t.value, origin: t.origin, syntax: t.syntax };
    }
    if (!levelAxes.includes(a)) levelAxes.push(a);
    entries.set(p, { path: p, kind, type: figma, tokenType: type, collection: axisCollection(a), cells, description: describe(def) });
  }
  levelAxes.sort((x, y) => order.indexOf(x) - order.indexOf(y));

  /* 4. Collections, and Figma's variable limit before anything else is planned on them. */
  const modesOf = (axes: string[]): PlannedMode[] =>
    combos(axes).map((combo) => ({ key: modeKey(combo), name: combo.length ? combo.map(([, c]) => title(c)).join(" · ") : "Value" }));
  const collections: PlannedCollection[] = [];
  const add = (key: string, name: string, axes: string[], hidden: boolean) => collections.push({ key, name, modes: modesOf(axes), hidden, axes });
  add(PRIMITIVES, "Primitives", collectionAxes.get(PRIMITIVES)!, true);
  for (const a of levelAxes) add(axisCollection(a), title(a), [a], false);
  add(SEMANTIC, "Semantic", collectionAxes.get(SEMANTIC)!, false);
  for (const c of collections) {
    const own = [...entries.values()].filter((e) => e.collection === c.key);
    if (own.length > MAX_VARIABLES) {
      issues.push({ level: "error", message: `${c.name} would hold ${own.length} variables; a Figma collection holds ${MAX_VARIABLES}. It was left out.` });
      for (const e of own) {
        entries.delete(e.path);
        refused.push({ path: e.path, reason: `${c.name} is over Figma's ${MAX_VARIABLES} variables` });
      }
    }
  }

  /* 5. Values: literals in Figma's terms, references as aliases. A value that can't be read takes its token out, and the tokens pointing at it, each with its reason. */
  const values = new Map<string, Record<string, PlannedValue>>();
  const dropped = new Map<string, string>();
  const literalIn = (raw: unknown, kind: Kind, depth = 0): ReturnType<typeof literalOf> => {
    const r = refOf(raw);
    if (r && "path" in r && depth < 20) {
      const t = defaultOf(r.path);
      return t ? literalIn(t.value, kind, depth + 1) : { error: `points at ${r.path}, which doesn't exist.` };
    }
    return literalOf(kind, raw, remBase);
  };
  for (const e of entries.values()) {
    const out: Record<string, PlannedValue> = {};
    for (const [mode, cell] of Object.entries(e.cells)) {
      const r = refOf(cell.raw);
      if (r && "path" in r) {
        if (entries.has(r.path)) {
          out[mode] = { alias: r.path };
          continue;
        }
        if (resolveOnly.has(r.path) || (defaultOf(r.path) && !refusedPaths().has(r.path) && !listedOut.has(r.path))) {
          /* A token that makes no variable of its own (a source set's): its value, inlined. */
          const lit = literalIn(cell.raw, e.kind);
          if ("error" in lit) {
            dropped.set(e.path, `${e.path}: ${lit.error}`);
            break;
          }
          out[mode] = { literal: lit.value };
          continue;
        }
        dropped.set(e.path, refusedPaths().has(r.path) || listedOut.has(r.path) ? `${e.path} points at ${r.path}, which isn't in Figma.` : `${e.path} points at ${r.path}, which doesn't exist.`);
        break;
      }
      const lit = literalOf(e.kind, cell.raw, remBase);
      if ("error" in lit) {
        dropped.set(e.path, `${e.path} ${lit.error}`);
        break;
      }
      if (lit.warning && mode === Object.keys(e.cells)[0]) issues.push({ level: "warning", path: e.path, message: `${e.path} ${lit.warning}` });
      out[mode] = { literal: lit.value };
    }
    if (!dropped.has(e.path)) values.set(e.path, out);
  }
  /* The chains: a token pointing at a dropped one (or of another type) goes too. */
  for (let changed = true; changed; ) {
    changed = false;
    for (const [path, vals] of values) {
      for (const v of Object.values(vals)) {
        if (!("alias" in v)) continue;
        const target = entries.get(v.alias)!;
        const why = dropped.has(v.alias)
          ? `${path} points at ${v.alias}, which was left out (${dropped.get(v.alias)})`
          : target.type !== entries.get(path)!.type
            ? `${path} is a ${entries.get(path)!.tokenType} and points at ${v.alias}, a ${target.tokenType}`
            : null;
        if (why) {
          dropped.set(path, why);
          values.delete(path);
          changed = true;
          break;
        }
      }
    }
  }
  for (const [path, why] of dropped) {
    issues.push({ level: "error", path, message: why });
    refused.push({ path, reason: why });
    entries.delete(path);
  }

  /* 6. Names: two tokens with the same Figma name in a collection are refused, both. */
  const byName = new Map<string, string[]>();
  for (const e of entries.values()) {
    const k = `${e.collection}|${figmaName(e.path).toLowerCase()}`;
    byName.set(k, [...(byName.get(k) ?? []), e.path]);
  }
  for (const paths of byName.values()) {
    if (paths.length < 2) continue;
    for (const p of paths) {
      const msg = `${paths.join(" and ")} have the same Figma name (${figmaName(p)}); neither was planned.`;
      issues.push({ level: "error", path: p, message: msg });
      refused.push({ path: p, reason: msg });
      entries.delete(p);
      values.delete(p);
    }
  }
  /* Aliases to a token refused by its name. */
  for (const [path, vals] of [...values]) {
    const gone = Object.values(vals).find((v) => "alias" in v && !entries.has(v.alias)) as { alias: string } | undefined;
    if (gone) {
      const msg = `${path} points at ${gone.alias}, which was refused.`;
      issues.push({ level: "error", path, message: msg });
      refused.push({ path, reason: msg });
      entries.delete(path);
      values.delete(path);
    }
  }

  const variables: PlannedVariable[] = [...entries.values()].map((e) => ({
    path: e.path,
    name: figmaName(e.path),
    collection: e.collection,
    type: e.type,
    tokenType: e.tokenType,
    values: values.get(e.path)!,
    scopes: scopesFor(e.path, e.type, e.kind),
    description: e.description,
    origins: Object.fromEntries(Object.entries(e.cells).map(([k, c]) => [k, c.origin])),
  }));

  /* 7. Styles, from the base: bound to the variables, set to the default world's values meanwhile. */
  const planned = new Set(variables.map((v) => v.path));
  const typeOfVar = new Map(variables.map((v) => [v.path, v.type]));
  const textStyles: PlannedTextStyle[] = [];
  const effectStyles: PlannedEffectStyle[] = [];
  const styleIssue = (path: string, message: string) => issues.push({ level: "error", path, message: `${path}: ${message}` });

  /** A field: bound when it is a reference to a variable of that Figma type; its literal from the default world. */
  const field = <T>(raw: unknown, kind: Kind, figma: FigmaType, read: (lit: unknown) => T | null): Bound<T> | { error: string } => {
    const r = refOf(raw);
    const path = r && "path" in r && planned.has(r.path) && typeOfVar.get(r.path) === figma ? r.path : null;
    const lit = literalIn(raw, kind);
    if ("error" in lit) return lit;
    const value = read(lit.value);
    return value === null ? { error: `${JSON.stringify(raw)} can't be used here.` } : { path, value };
  };
  const rawIn = (raw: unknown, depth = 0): unknown => {
    const r = refOf(raw);
    if (r && "path" in r && depth < 20) {
      const t = defaultOf(r.path);
      return t ? rawIn(t.value, depth + 1) : undefined;
    }
    return raw;
  };
  const stack = (raw: unknown): Bound<string[]> | { error: string } => {
    const r = refOf(raw);
    const path = r && "path" in r && planned.has(r.path) && typeOfVar.get(r.path) === "STRING" ? r.path : null;
    const v = rawIn(raw);
    const list = (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : []).map((f) => String(f).trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    return list.length ? { path, value: list } : { error: `the font family ${JSON.stringify(raw)} can't be read.` };
  };
  const num = (v: unknown) => (typeof v === "number" ? v : null);
  /** Line height: px is bound; a multiplier (DTCG's number, or a percentage) is the style's percentage, set and not bound. */
  const lineHeight = (raw: unknown): PlannedTextStyle["lineHeight"] | { error: string } => {
    const v = rawIn(raw);
    const kindAt = (() => {
      const r = refOf(raw);
      return r && "path" in r ? kindOf(typeOf(defaultOf(r.path) ?? ({ type: null } as RawToken))) : null;
    })();
    if (typeof v === "number" && kindAt !== "dimension") return { percent: normalizeNumber(v * 100) };
    if (typeof v === "string" && v.trim().endsWith("%")) return { percent: normalizeNumber(parseFloat(v)) };
    if (typeof v === "string" && /^[\d.]+$/.test(v.trim())) return { percent: normalizeNumber(Number(v) * 100) };
    const f = field(raw, "dimension", "FLOAT", num);
    return f;
  };
  const letterSpacing = (raw: unknown): PlannedTextStyle["letterSpacing"] | { error: string } => {
    const v = rawIn(raw);
    if (isObject(v) && v.unit === "em" && typeof v.value === "number") return { percent: normalizeNumber(v.value * 100) };
    if (typeof v === "string" && /em$/.test(v.trim())) return { percent: normalizeNumber(parseFloat(v) * 100) };
    if (typeof v === "string" && v.trim().endsWith("%")) return { percent: normalizeNumber(parseFloat(v)) };
    return field(raw, "dimension", "FLOAT", num);
  };
  const fontFamilies = [...base.values()].filter((t) => kindOf(typeOf(t)) === "fontFamily" && fits(t));

  const textStyle = (id: string, path: string, origin: Origin, parts: { family?: unknown; size?: unknown; weight?: unknown; lineHeight?: unknown; letterSpacing?: unknown }, name = figmaName(id)) => {
    let familyRaw = parts.family;
    if (familyRaw === undefined) {
      if (fontFamilies.length !== 1) return styleIssue(path, `no font family: the group has none, and the base has ${fontFamilies.length ? "more than one" : "none"} to use.`);
      familyRaw = `{${fontFamilies[0].path}}`;
    }
    const family = stack(familyRaw);
    if ("error" in family) return styleIssue(path, family.error);
    const size = parts.size === undefined ? null : field(parts.size, "dimension", "FLOAT", num);
    if (size && "error" in size) return styleIssue(path, `the font size ${size.error}`);
    const weight = parts.weight === undefined ? { path: null, value: 400 } : field(parts.weight, "fontWeight", "FLOAT", num);
    if ("error" in weight) return styleIssue(path, `the font weight ${weight.error}`);
    const lh = parts.lineHeight === undefined ? null : lineHeight(parts.lineHeight);
    if (lh && "error" in lh) return styleIssue(path, `the line height ${lh.error}`);
    const ls = parts.letterSpacing === undefined ? null : letterSpacing(parts.letterSpacing);
    if (ls && "error" in ls) return styleIssue(path, `the letter spacing ${ls.error}`);
    textStyles.push({ id, name, family, size, weight, lineHeight: lh, letterSpacing: ls, origin });
  };

  const KEYS = {
    family: ["family", "fontFamily", "font-family"],
    size: ["size", "fontSize", "font-size"],
    weight: ["weight", "fontWeight", "font-weight"],
    lineHeight: ["lineHeight", "line-height"],
    letterSpacing: ["letterSpacing", "letter-spacing", "tracking"],
  };
  for (const t of base.values()) {
    const kind = kindOf(typeOf(t));
    if (kind === "typography") {
      const v = rawIn(t.value);
      if (!isObject(v)) {
        styleIssue(t.path, "a typography token's value must be an object.");
        continue;
      }
      /* The fields keep their references: bound to them when they are variables. */
      const own = isObject(t.value) ? t.value : v;
      const pick = (names: string[]) => names.map((n) => own[n]).find((x) => x !== undefined);
      textStyle(t.path, t.path, t.origin, { family: pick(KEYS.family), size: pick(KEYS.size), weight: pick(KEYS.weight), lineHeight: pick(KEYS.lineHeight), letterSpacing: pick(KEYS.letterSpacing) });
    } else if (kind === "shadow") {
      const v = rawIn(t.value);
      const list = Array.isArray(v) ? v : [v];
      const layers: PlannedShadowLayer[] = [];
      let bad: string | null = null;
      for (const l of list) {
        if (!isObject(l)) {
          bad = "a shadow layer must be an object.";
          break;
        }
        const color = field(l.color, "color", "COLOR", (x) => (typeof x === "object" ? (x as Rgba) : null));
        const dim = (x: unknown) => (x === undefined ? { path: null, value: 0 } : field(x, "dimension", "FLOAT", num));
        const parts = { x: dim(l.offsetX ?? l.x), y: dim(l.offsetY ?? l.y), blur: dim(l.blur), spread: dim(l.spread) };
        const err = [color, ...Object.values(parts)].find((p) => "error" in p) as { error: string } | undefined;
        if (err) {
          bad = err.error;
          break;
        }
        layers.push({ color: color as Bound<Rgba>, ...(parts as Record<"x" | "y" | "blur" | "spread", Bound<number>>), inner: l.inset === true || l.type === "innerShadow" });
      }
      if (bad) styleIssue(t.path, bad);
      else effectStyles.push({ id: t.path, name: figmaName(t.path), layers, origin: t.origin });
    }
  }

  /* Text styles from groups of separate type tokens: read by the children's type and key, never the group's name. */
  const groups = new Map<string, RawToken[]>();
  for (const t of base.values()) {
    const at = t.path.lastIndexOf(".");
    if (at < 0) continue;
    const parent = t.path.slice(0, at);
    groups.set(parent, [...(groups.get(parent) ?? []), t]);
  }
  const textIds = new Set(textStyles.map((s) => s.id));
  for (const [group, children] of groups) {
    const key = (t: RawToken) => t.path.slice(group.length + 1);
    const find = (names: string[], kinds: Kind[]) => children.find((t) => names.includes(key(t)) && kinds.includes(kindOf(typeOf(t))));
    const size = find(KEYS.size, ["dimension"]);
    const weight = find(KEYS.weight, ["fontWeight"]);
    const lh = find(KEYS.lineHeight, ["dimension", "number", "lineHeight"]);
    if (!size || (!weight && !lh) || textIds.has(group)) continue;
    const family = find(KEYS.family, ["fontFamily"]);
    const ls = find(KEYS.letterSpacing, ["dimension", "letterSpacing", "number"]);
    const ref = (t: RawToken | undefined) => (t ? `{${t.path}}` : undefined);
    const parts = { family: ref(family), size: ref(size), weight: ref(weight), lineHeight: ref(lh), letterSpacing: ref(ls) };
    /* One style per role: other weights of the role (weight-strong) stay variables, to bind in Figma.
       The repository keeps them as they are; this is only how Figma shows them. */
    textStyle(group, group, size.origin, parts);
  }

  /* Text styles laid out one level deep (role/size), without a prefix every style shares (type., typography.),
     roles in the order of a type scale, and sizes from the largest down. The ids stay the token paths. */
  shapeTextStyles(textStyles);

  /* 8. The order collections are created in: an alias's target collection first. */
  const deps = new Map(collections.map((c) => [c.key, new Set<string>()]));
  const collectionOf = new Map(variables.map((v) => [v.path, v.collection]));
  for (const v of variables) for (const val of Object.values(v.values)) if ("alias" in val && collectionOf.get(val.alias) !== v.collection) deps.get(v.collection)!.add(collectionOf.get(val.alias)!);
  const sorted: PlannedCollection[] = [];
  const visit = (c: PlannedCollection, seen: Set<string>) => {
    if (sorted.includes(c) || seen.has(c.key)) return;
    seen.add(c.key);
    for (const d of deps.get(c.key)!) visit(collections.find((x) => x.key === d)!, seen);
    sorted.push(c);
  };
  for (const c of collections) visit(c, new Set());
  const used = new Set(variables.map((v) => v.collection));

  return {
    format: read.format,
    name: opts.name ?? "Tokens",
    collections: sorted.filter((c) => used.has(c.key)),
    variables,
    textStyles,
    effectStyles,
    issues,
    notInFigma,
    refused: dedupe(refused),
    axesOut,
    baseFiles: [...new Set(layers.base.map((b) => b.origin.set ?? b.origin.file))],
    snapshot: snapshotOf(variables, textStyles, effectStyles),
  };
}

function dedupe(list: Listed[]): Listed[] {
  const seen = new Set<string>();
  return list.filter((l) => !seen.has(l.path) && !!seen.add(l.path));
}

export function snapValue(v: PlannedValue): SnapValue {
  return "alias" in v ? { alias: v.alias } : { literal: snapLiteral(v.literal) };
}

export function snapshotOf(variables: PlannedVariable[], text: PlannedTextStyle[], effects: PlannedEffectStyle[]): DtcgSnapshot {
  const snap: DtcgSnapshot = { tokens: {}, styles: {} };
  for (const v of variables) snap.tokens[v.path] = { collection: v.collection, type: v.type, values: Object.fromEntries(Object.entries(v.values).map(([k, x]) => [k, snapValue(x)])) };
  for (const s of text) {
    const bound: Record<string, string> = {};
    if (s.size?.path) bound.fontSize = s.size.path;
    if (s.weight.path) bound.fontWeight = s.weight.path;
    if (s.lineHeight && "path" in s.lineHeight && s.lineHeight.path) bound.lineHeight = s.lineHeight.path;
    if (s.letterSpacing && "path" in s.letterSpacing && s.letterSpacing.path) bound.letterSpacing = s.letterSpacing.path;
    snap.styles[s.id] = { kind: "text", name: s.name, bound };
  }
  for (const s of effects) {
    const bound: Record<string, string> = {};
    s.layers.forEach((l, i) => {
      for (const f of ["color", "x", "y", "blur", "spread"] as const) if (l[f].path) bound[`${i}.${f}`] = l[f].path!;
    });
    snap.styles[s.id] = { kind: "effect", name: s.name, bound };
  }
  return snap;
}

export { dimensionPx };
