/* The one model every DTCG layout is read into: layers (a base and axes of contexts, each a
   list of sources), and what a plan for Figma made of them looks like.
   */

export type Format = "resolver" | "tokens-studio" | "mapped";
export const FORMATS: Format[] = ["resolver", "tokens-studio", "mapped"];

export type Tree = Record<string, unknown>;

/** Where a value came from: the file, and where in it. */
export interface Origin {
  /** The file, relative to the folder. */
  file: string;
  /** A Tokens Studio token set (a file of its own, or a key of a single file). */
  set?: string;
  /** A JSON pointer inside the file, when the tokens aren't its root (a resolver's inline sources, a single-file set). */
  pointer?: string;
  /** Modes kept in `$extensions`: the extension key, and the axis and context the value is for. */
  extension?: { key: string; axis: string; context: string };
}

export type Syntax = "dtcg" | "tokens-studio";

export interface Source {
  origin: Origin;
  tree: Tree;
  syntax: Syntax;
}

export interface Context {
  name: string;
  sources: Source[];
}

export interface Axis {
  name: string;
  /** In order; the default is one of them. */
  contexts: Context[];
  default: string;
}

export interface Layers {
  base: Source[];
  axes: Axis[];
  /** Read only to resolve references (Tokens Studio's `source` sets): they make no variables. */
  resolveOnly?: Source[];
}

export interface Issue {
  level: "error" | "warning";
  message: string;
  /** The token's path, when it is about one token. */
  path?: string;
  /** The file, when it is about one file. */
  file?: string;
}

/** The mapping the designer confirms for plain DTCG files (the `mapped` layout). */
export interface Mapping {
  /** By file: base, a context of an axis, or left out. */
  files: Record<string, { kind: "base" } | { kind: "context"; axis: string; context: string } | { kind: "out" }>;
  /** Modes kept in `$extensions`: the extension key, and each axis's default context (the token's `$value`). */
  extension?: { key: string; defaults: Record<string, string> } | null;
  /** Each axis's contexts in order and its default: a context may have no file yet (empty, or the base itself). */
  axes?: Record<string, { contexts: string[]; default: string }>;
}

/** What Tokens Studio's `$themes.json` says about Figma ids, by theme. */
export interface FigmaRefs {
  collections: { axis: string; context: string; collectionId?: string; modeId?: string }[];
  /** Token path → a variable's key. */
  variables: Record<string, string>;
}

export interface ReadResult {
  format: Format;
  layers: Layers;
  issues: Issue[];
  /** Token files the read used. */
  files: string[];
  /** Token files no mapping places (the `mapped` layout): they stay out until the designer maps them. */
  unmapped?: string[];
  figmaRefs?: FigmaRefs;
}

/* ───── the plan ───── */

export type FigmaType = "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
export type FigmaLiteral = Rgba | number | string | boolean;
/** A literal, or the path of the token whose variable it points at. */
export type PlannedValue = { literal: FigmaLiteral } | { alias: string };

export interface PlannedMode {
  /** "*" for one mode; "<axis>=<context>", or two joined by "|" (escaped). */
  key: string;
  name: string;
}

export interface PlannedCollection {
  /** `dtcg:base:literal`, `dtcg:base:reference` or `dtcg:axis:<name>` */
  key: string;
  name: string;
  modes: PlannedMode[];
  /** Hidden from publishing when it is created (Primitives). */
  hidden: boolean;
  /** The axes its modes come from, in resolution order. */
  axes: string[];
}

export interface PlannedVariable {
  path: string;
  /** The Figma name: the path with slashes. */
  name: string;
  collection: string;
  type: FigmaType;
  /** The repository's type ($type, or Tokens Studio's). */
  tokenType: string;
  values: Record<string, PlannedValue>;
  scopes: string[];
  description: string;
  /** Where each mode's value came from. */
  origins: Record<string, Origin>;
}

/** A field of a style: bound to a variable (its token's path) and set to the literal meanwhile. */
export interface Bound<T> {
  path: string | null;
  value: T;
}

export interface PlannedTextStyle {
  id: string;
  name: string;
  /** The stack; the first family Figma has is used, and bound only when it is the first. */
  family: Bound<string[]>;
  size: Bound<number> | null;
  weight: Bound<number>;
  lineHeight: Bound<number> | { percent: number } | null;
  letterSpacing: Bound<number> | { percent: number } | null;
  origin: Origin;
}

export interface PlannedShadowLayer {
  color: Bound<Rgba>;
  x: Bound<number>;
  y: Bound<number>;
  blur: Bound<number>;
  spread: Bound<number>;
  inner: boolean;
}

export interface PlannedEffectStyle {
  id: string;
  name: string;
  layers: PlannedShadowLayer[];
  origin: Origin;
}

/** A token that makes nothing in Figma, and why. */
export interface Listed {
  path: string;
  reason: string;
}

/** An axis that makes no collection: no tokens yet, or none Figma can hold. */
export interface AxisOut {
  name: string;
  reason: "empty" | "not-in-figma";
  count: number;
}

/* The snapshot: what the file should hold, in the form both sides are read into, so the status is a diff. */
export type SnapValue = { literal: string | number | boolean } | { alias: string };
export interface SnapToken {
  collection: string;
  type: FigmaType;
  values: Record<string, SnapValue>;
}
export interface SnapStyle {
  kind: "text" | "effect";
  name: string;
  /** Bound fields, by name: the token's path. */
  bound: Record<string, string>;
}
export interface DtcgSnapshot {
  tokens: Record<string, SnapToken>;
  styles: Record<string, SnapStyle>;
}

export interface Plan {
  format: ReadResult["format"];
  name: string;
  /** In dependency order: an alias's target collection comes first. */
  collections: PlannedCollection[];
  variables: PlannedVariable[];
  textStyles: PlannedTextStyle[];
  effectStyles: PlannedEffectStyle[];
  issues: Issue[];
  /** Tokens whose type has no Figma variable (cubicBezier, transition…), and Tokens Studio's math and modifiers. */
  notInFigma: Listed[];
  /** Tokens refused, or left out because a value couldn't be read (theirs or one they point at). */
  refused: Listed[];
  axesOut: AxisOut[];
  /** The files (or sets) the base is read from. */
  baseFiles: string[];
  snapshot: DtcgSnapshot;
}

/* ───── what the file keeps ───── */

/** A text style that took another font: `wanted` isn't in this Figma ("family"), or not in that weight ("weight"). */
export interface FontStandIn {
  style: string;
  wanted: string;
  used: string;
  weight: number;
  missing: "family" | "weight";
}

/** The file's link to a DTCG repository: shared plugin data on the document. */
export interface DtcgLink {
  v: 1;
  repo: { owner: string; name: string; folder: string };
  branch: string;
  format: ReadResult["format"];
  /** The resolver file, when the folder has more than one. */
  resolver?: string;
  mapping?: Mapping;
  /** px per rem. */
  remBase: number;
  /** The designer said this file is published as a library: an import asks before replacing anything. */
  library?: boolean;
  /** Adopt variables and styles with the same names, made by hand or by another tool (confirmed on connect). */
  adopt?: boolean;
  name: string;
  /** The commit the file was last brought level with. */
  baseSha: string;
  /** The file's snapshot right after that import: the shortcut for "no local edit". */
  snapshotHash: string;
  syncedAt: string;
  /** The text styles whose font stood in for one this Figma lacks, at the last import. */
  fonts?: FontStandIn[] | null;
  /** The last import didn't land whole: what failed. Cleared by an import that completes. */
  incomplete?: { at: string; issues: Issue[] } | null;
}
