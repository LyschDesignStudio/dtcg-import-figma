/* Tokens out of a source's tree, and each value into Figma's terms: DTCG 2025.10 and
   Tokens Studio's syntax, read into the same types. */

import { normalizeNumber } from "./shared/stable";
import { readColor, rgbaHex } from "./color";
import type { FigmaType, Origin, Rgba, Source, Syntax, Tree } from "./model";

export interface RawToken {
  path: string;
  /** Its own `$type`, or its group's (null when neither says). */
  type: string | null;
  value: unknown;
  description?: string;
  deprecated?: boolean | string;
  extensions?: Tree;
  origin: Origin;
  syntax: Syntax;
}

export const isObject = (v: unknown): v is Tree => !!v && typeof v === "object" && !Array.isArray(v);

/** Keys that would reach an object's prototype when used to write: never taken from a repository. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const isSafeKey = (key: string) => !UNSAFE_KEYS.has(key);

/** JSON.parse that drops the keys isSafeKey refuses, at any depth. `dropped` counts them. */
export function parseJsonSafely(text: string, dropped = { count: 0 }): unknown {
  return JSON.parse(text, function (key, value) {
    if (key && !isSafeKey(key)) {
      dropped.count++;
      return undefined;
    }
    return value;
  });
}

function isToken(node: Tree, syntax: Syntax, inheritedType: string | null): boolean {
  if ("$value" in node) return true;
  if (syntax !== "tokens-studio" || !("value" in node)) return false;
  /* Tokens Studio's token: `value` with a `type`; a group named "value" holds groups, never a literal. */
  return "type" in node || !!inheritedType || !isObject(node.value) || !Object.values(node.value).some(isObject);
}

/** Every token in a tree, with `$type` inherited from its groups and `$root` at its group's path. */
export function flatten(source: Source): RawToken[] {
  const out: RawToken[] = [];
  const ts = source.syntax === "tokens-studio";
  const walk = (node: Tree, path: string[], type: string | null) => {
    for (const [key, child] of Object.entries(node)) {
      if (!isObject(child) || !isSafeKey(key)) continue;
      if (key.startsWith("$") && key !== "$root") continue;
      const childPath = key === "$root" ? path : [...path, key];
      if (isToken(child, source.syntax, type)) {
        const t = typeof child.$type === "string" ? child.$type : ts && typeof child.type === "string" ? child.type : type;
        const tok: RawToken = { path: childPath.join("."), type: t, value: "$value" in child ? child.$value : child.value, origin: source.origin, syntax: source.syntax };
        const description = child.$description ?? (ts ? child.description : undefined);
        if (typeof description === "string" && description) tok.description = description;
        if (child.$deprecated !== undefined && child.$deprecated !== false) tok.deprecated = child.$deprecated as boolean | string;
        if (isObject(child.$extensions)) tok.extensions = child.$extensions;
        out.push(tok);
      } else walk(child, childPath, typeof child.$type === "string" ? child.$type : type);
    }
  };
  walk(source.tree, [], typeof source.tree.$type === "string" ? source.tree.$type : null);
  return out;
}

/** True when a tree holds at least one token (`$value`, or Tokens Studio's `value`), anywhere. */
export function hasTokens(tree: unknown): boolean {
  if (!isObject(tree)) return false;
  if ("$value" in tree || ("value" in tree && ("type" in tree || !isObject(tree.value)))) return true;
  return Object.values(tree).some(hasTokens);
}

/* ───── types ───── */

/** What a token is in the plugin's terms. */
export type Kind = "color" | "dimension" | "number" | "opacity" | "fontWeight" | "fontFamily" | "duration" | "boolean" | "string" | "typography" | "shadow" | "lineHeight" | "letterSpacing" | "none";

/** Tokens Studio's type names, and DTCG's, to a kind. Unknown types, and DTCG's composites Figma has no variable for, are "none". */
const KINDS: Record<string, Kind> = {
  color: "color",
  dimension: "dimension", sizing: "dimension", spacing: "dimension", borderRadius: "dimension", borderWidth: "dimension", fontSizes: "dimension", paragraphSpacing: "dimension", paragraphIndent: "dimension",
  number: "number",
  opacity: "opacity",
  fontWeight: "fontWeight", fontWeights: "fontWeight",
  fontFamily: "fontFamily", fontFamilies: "fontFamily",
  duration: "duration",
  boolean: "boolean", text: "string", string: "string",
  typography: "typography",
  shadow: "shadow", boxShadow: "shadow",
  lineHeights: "lineHeight",
  letterSpacing: "letterSpacing",
};

export const kindOf = (type: string | null | undefined): Kind => (type ? KINDS[type] ?? "none" : "none");

export const FIGMA_TYPE: Partial<Record<Kind, FigmaType>> = {
  color: "COLOR", dimension: "FLOAT", number: "FLOAT", opacity: "FLOAT", fontWeight: "FLOAT", duration: "FLOAT", lineHeight: "FLOAT", letterSpacing: "FLOAT",
  fontFamily: "STRING", string: "STRING", boolean: "BOOLEAN",
};

/* ───── references ───── */

const REF = /^\{([^{}]+)\}$/;

/** The path a whole-value reference points at: `{a.b.c}`, or a `$ref` pointer to a whole token. */
export function refOf(value: unknown): { path: string } | { partial: string } | null {
  if (typeof value === "string") {
    const m = value.trim().match(REF);
    return m ? { path: m[1].trim() } : null;
  }
  if (isObject(value) && typeof value.$ref === "string" && Object.keys(value).length === 1) {
    const ptr = value.$ref.replace(/^#/, "");
    const parts = ptr.split("/").filter(Boolean).map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
    const at = parts.indexOf("$value");
    if (at >= 0 && at < parts.length - 1) return { partial: value.$ref };
    return { path: (at >= 0 ? parts.slice(0, at) : parts).join(".") };
  }
  return null;
}

/** Tokens Studio's math (`{space.md} * 2`) and references inside a string: a value Figma can't hold. */
export const isMath = (value: unknown) => typeof value === "string" && /\{[^}]+\}/.test(value) && !REF.test(value.trim());

/** Tokens Studio's color modifiers ($extensions["studio.tokens"].modify). */
export const hasModifier = (t: RawToken) => isObject(t.extensions?.["studio.tokens"]) && isObject((t.extensions!["studio.tokens"] as Tree).modify);

/* ───── literals ───── */

export type Literal = { value: number | string | boolean | Rgba; warning?: string } | { error: string };

const WEIGHTS: Record<string, number> = {
  thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, normal: 400, regular: 400, book: 400, medium: 500,
  semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900, extrablack: 950, ultrablack: 950,
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** A dimension in px: `{ value, unit }`, "16px", "1rem", or a bare number (Tokens Studio's px). */
export function dimensionPx(v: unknown, remBase: number): number | { error: string } {
  let value: number | null = null;
  let unit = "px";
  if (isObject(v)) {
    value = num(v.value);
    unit = String(v.unit ?? "");
  } else if (typeof v === "number") value = v;
  else if (typeof v === "string") {
    const m = v.trim().match(/^(-?[\d.]+)\s*(px|rem|em)?$/i);
    if (m) {
      value = Number(m[1]);
      unit = (m[2] ?? "px").toLowerCase();
    }
  }
  if (value === null || !Number.isFinite(value)) return { error: `"${JSON.stringify(v)}" isn't a dimension.` };
  if (unit === "px") return normalizeNumber(value);
  if (unit === "rem") return normalizeNumber(value * remBase);
  return { error: `the unit "${unit}" has no meaning in Figma (px and rem do).` };
}

/** A literal value of a kind, in Figma's terms. */
export function literalOf(kind: Kind, v: unknown, remBase: number): Literal {
  switch (kind) {
    case "color": {
      const c = readColor(v);
      if ("error" in c) return { error: `isn't a color it can read: ${c.error}` };
      const space = isObject(v) ? String(v.colorSpace) : "";
      if (c.clipped) return { value: c.rgba, warning: `is in ${space}, outside sRGB: converted and clipped to sRGB.` };
      if (c.converted) return { value: c.rgba, warning: `is in ${space}: converted to sRGB.` };
      return { value: c.rgba };
    }
    case "dimension": {
      const px = dimensionPx(v, remBase);
      return typeof px === "number" ? { value: px } : px;
    }
    case "number": {
      const n = num(v);
      return n === null ? { error: `"${JSON.stringify(v)}" isn't a number.` } : { value: normalizeNumber(n) };
    }
    case "opacity": {
      if (typeof v === "string" && v.trim().endsWith("%")) {
        const n = num(v.trim().slice(0, -1));
        return n === null ? { error: `"${v}" isn't an opacity.` } : { value: normalizeNumber(n) };
      }
      const n = num(v);
      if (n === null || n < 0 || n > 1) return { error: `"${JSON.stringify(v)}" isn't an opacity from 0 to 1.` };
      return { value: normalizeNumber(n * 100) };
    }
    case "fontWeight": {
      const n = num(v);
      if (n !== null) return n >= 1 && n <= 1000 ? { value: n } : { error: `${n} isn't a font weight.` };
      const w = typeof v === "string" ? WEIGHTS[v.toLowerCase().replace(/[\s_-]/g, "").replace(/italic$/, "")] : undefined;
      return w ? { value: w } : { error: `"${JSON.stringify(v)}" isn't a font weight.` };
    }
    case "fontFamily": {
      const first = Array.isArray(v) ? v[0] : typeof v === "string" ? v.split(",")[0] : null;
      const f = typeof first === "string" ? first.trim().replace(/^["']|["']$/g, "") : "";
      return f ? { value: f } : { error: `"${JSON.stringify(v)}" isn't a font family.` };
    }
    case "duration": {
      let value: number | null = null;
      let unit = "ms";
      if (isObject(v)) {
        value = num(v.value);
        unit = String(v.unit ?? "");
      } else if (typeof v === "string") {
        const m = v.trim().match(/^(-?[\d.]+)\s*(ms|s)$/);
        if (m) [value, unit] = [Number(m[1]), m[2]];
      } else value = num(v);
      if (value === null) return { error: `"${JSON.stringify(v)}" isn't a duration.` };
      if (unit === "s") return { value: normalizeNumber(value * 1000) };
      return unit === "ms" ? { value: normalizeNumber(value) } : { error: `the unit "${unit}" isn't a duration's.` };
    }
    case "boolean":
      return typeof v === "boolean" ? { value: v } : v === "true" || v === "false" ? { value: v === "true" } : { error: `"${JSON.stringify(v)}" isn't true or false.` };
    case "string":
      return typeof v === "string" ? { value: v } : { error: `"${JSON.stringify(v)}" isn't text.` };
    case "lineHeight": {
      /* Tokens Studio's lineHeights: px, or a percentage or a multiplier (a number, in Figma). */
      if (typeof v === "string" && v.trim().endsWith("%")) {
        const n = num(v.trim().slice(0, -1));
        return n === null ? { error: `"${v}" isn't a line height.` } : { value: normalizeNumber(n / 100) };
      }
      const px = dimensionPx(v, remBase);
      return typeof px === "number" ? { value: px } : { error: `"${JSON.stringify(v)}" isn't a line height.` };
    }
    case "letterSpacing": {
      if (typeof v === "string" && v.trim().endsWith("%")) {
        const n = num(v.trim().slice(0, -1));
        return n === null ? { error: `"${v}" isn't a letter spacing.` } : { value: normalizeNumber(n) };
      }
      const px = dimensionPx(v, remBase);
      return typeof px === "number" ? { value: px } : px;
    }
    default:
      return { error: "has no Figma variable type." };
  }
}

/** A Figma literal in the snapshot's form: colors as hex, numbers rounded to what Figma keeps. */
export function snapLiteral(v: number | string | boolean | Rgba): string | number | boolean {
  if (typeof v === "object") return rgbaHex(v);
  if (typeof v === "number") return normalizeNumber(v);
  return v;
}
