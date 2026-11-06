/* Reading the four layouts into one plan. */

import { describe, expect, it } from "vitest";
import { readColor, rgbaHex } from "../src/color";
import { detect, readAndPlan } from "../src/detect";
import type { Plan, ReadResult, Source } from "../src/model";
import { planFromLayers, PRIMITIVES, SEMANTIC } from "../src/plan";
import { readFolder } from "../src/readers/files";
import { suggestMapping } from "../src/readers/mapped";
import { ReadError, readResolver } from "../src/readers/resolver";
import { literalOf } from "../src/tokens";
import { fixtureTexts, MAPPINGS } from "./fixtures";

const resolverPlan = () => readAndPlan(fixtureTexts("resolver"), { format: "resolver" });
const studioPlan = () => readAndPlan(fixtureTexts("tokens-studio"), { format: "tokens-studio" });
const filesPlan = () => readAndPlan(fixtureTexts("mapped-files"), { format: "mapped", mapping: MAPPINGS["mapped-files"] });
const extPlan = () => readAndPlan(fixtureTexts("mapped-extensions"), { format: "mapped", mapping: MAPPINGS["mapped-extensions"] });

/** A plan's shape, for comparing layouts: collections and modes, each variable's values and aliases, the styles. Tokens Studio has no $root, so color.accent is left out. */
function shape(plan: Plan) {
  const tokens = Object.fromEntries(Object.entries(plan.snapshot.tokens).filter(([p]) => !p.startsWith("color.accent")).sort(([a], [b]) => a.localeCompare(b)));
  return {
    collections: plan.collections.map((c) => ({ key: c.key, name: c.name, modes: c.modes })),
    tokens,
    styles: plan.snapshot.styles,
    text: plan.textStyles.map((s) => ({ id: s.id, family: s.family.value, size: s.size?.value, weight: s.weight.value, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing })),
    effects: plan.effectStyles.map((s) => ({ id: s.id, layers: s.layers.map((l) => ({ ...l, color: { path: l.color.path, value: rgbaHex(l.color.value) } })) })),
  };
}

const src = (tree: Record<string, unknown>, file = "x.tokens.json"): Source => ({ origin: { file }, tree, syntax: "dtcg" });
const layers = (base: Record<string, unknown>, axes: ReadResult["layers"]["axes"] = []): ReadResult => ({ format: "mapped", layers: { base: [src(base)], axes }, issues: [], files: [] });
const variable = (plan: Plan, path: string) => plan.variables.find((v) => v.path === path);

describe("dtcg layouts", () => {
  it("dtcg layouts: the four fixtures give the same plan", () => {
    const r = shape(resolverPlan().plan);
    expect(r.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
    expect(Object.keys(r.tokens).length).toBeGreaterThan(30);
    for (const [name, p] of [["tokens-studio", studioPlan], ["mapped-files", filesPlan], ["mapped-extensions", extPlan]] as const) {
      expect(shape(p().plan), name).toEqual(r);
    }
  });
});

describe("dtcg resolver", () => {
  it("dtcg resolver: reads sets, modifiers, defaults and $ref to files and inside the document", () => {
    const { read } = resolverPlan();
    expect(read.layers.base.map((s) => s.origin.file)).toEqual(["color.tokens.json", "dimension.tokens.json", "typography.tokens.json", "effects.tokens.json"]);
    expect(read.layers.axes.map((a) => [a.name, a.default, a.contexts.map((c) => c.name)])).toEqual([
      ["brand", "standard", ["standard", "premium"]],
      ["mode", "light", ["light", "dark"]],
      ["viewport", "compact", ["compact", "medium", "expanded"]],
      ["motion", "full", ["full", "reduced"]],
      ["density", "regular", ["regular", "compact"]],
    ]);
    expect(read.layers.axes[1].contexts[1].sources[0].origin).toEqual({ file: "modes/mode.dark.tokens.json" });
    /* A $ref inside the document (a set by pointer), and inline tokens in a context. */
    const doc = {
      version: "2025.10",
      sets: { core: { sources: [{ $ref: "a.tokens.json" }] } },
      modifiers: { mode: { default: "dark", contexts: { light: [], dark: [{ color: { bg: { $type: "color", $value: "#000000" } } }] } } },
      resolutionOrder: [{ $ref: "#/sets/core" }, { $ref: "#/modifiers/mode" }],
    };
    const files = readFolder({ "x.resolver.json": JSON.stringify(doc), "a.tokens.json": JSON.stringify({ color: { bg: { $type: "color", $value: "#ffffff" } } }) });
    const r = readResolver(files, "x.resolver.json");
    expect(r.layers.axes[0].default).toBe("dark");
    expect(r.layers.axes[0].contexts[1].sources[0].origin).toEqual({ file: "x.resolver.json", pointer: "/modifiers/mode/contexts/dark/0" });
    const plan = planFromLayers(r);
    expect(variable(plan, "color.bg")!.values).toEqual({ "mode=dark": { literal: { r: 0, g: 0, b: 0, a: 1 } }, "mode=light": { literal: { r: 1, g: 1, b: 1, a: 1 } } });
  });

  it("dtcg resolver: refuses a $ref outside the folder, a cycle, another version and a bad modifier, with the path", () => {
    const tok = JSON.stringify({ a: { $type: "number", $value: 1 } });
    const read = (doc: object, extra: Record<string, string> = {}) => () => readResolver(readFolder({ "r.resolver.json": JSON.stringify(doc), "a.tokens.json": tok, ...extra }), "r.resolver.json");
    const ok = { version: "2025.10", sets: { s: { sources: [{ $ref: "a.tokens.json" }] } }, resolutionOrder: [{ $ref: "#/sets/s" }] };
    expect(read(ok)).not.toThrow();
    expect(read({ ...ok, sets: { s: { sources: [{ $ref: "../outside.tokens.json" }] } } })).toThrow(/r\.resolver\.json .*leaves the folder/);
    expect(read({ ...ok, sets: { s: { sources: [{ $ref: "https://example.com/a.json" }] } } })).toThrow(/is a URL/);
    expect(read({ ...ok, sets: { s: { sources: [{ $ref: "#/sets/t" }] }, t: { sources: [{ $ref: "#/sets/s" }] } } })).toThrow(/cycle/);
    expect(read({ ...ok, version: "2024.1" })).toThrow(/version "2024.1".*2025\.10/);
    expect(read({ ...ok, modifiers: { m: { contexts: { only: [] } } }, resolutionOrder: [{ $ref: "#/modifiers/m" }] })).toThrow(/\/modifiers\/m: the modifier "m" has 1 context/);
    expect(read({ ...ok, modifiers: { m: { default: "x", contexts: { a: [], b: [] } } }, resolutionOrder: [{ $ref: "#/modifiers/m" }] })).toThrow(/default "x" of "m" isn't one of its contexts/);
    try {
      read({ ...ok, version: "1" })();
    } catch (e) {
      expect((e as ReadError).path).toBe("r.resolver.json");
    }
  });
});

describe("dtcg tokens-studio", () => {
  it("dtcg tokens-studio: reads theme groups as axes, with enabled, source and disabled sets in $metadata order", () => {
    const { read, plan } = studioPlan();
    expect(read.layers.axes.map((a) => [a.name, a.contexts.map((c) => c.name)])).toEqual([
      ["brand", ["standard", "premium"]], ["mode", ["light", "dark"]], ["viewport", ["compact", "medium", "expanded"]], ["motion", ["full", "reduced"]], ["density", ["regular", "compact"]],
    ]);
    expect(read.layers.base.map((s) => s.origin.set)).toEqual(["core/color", "core/dimension", "core/typography", "core/effects"]);
    expect(read.layers.resolveOnly!.map((s) => s.origin.set)).toEqual(["global/palette-source"]);
    expect(read.files).not.toContain("drafts/unused.json");
    expect(variable(plan, "palette.ink")).toBeUndefined();
    expect(variable(plan, "draft")).toBeUndefined();
    expect(read.layers.axes[1].contexts[1].sources[0].origin).toEqual({ file: "mode/dark.json", set: "mode/dark" });
  });

  it("dtcg tokens-studio: reads its syntax and type names", () => {
    const { plan } = studioPlan();
    expect(variable(plan, "font.weight.semibold")!.values["*"]).toEqual({ literal: 600 });
    expect(variable(plan, "font.size.sm")!.values["*"]).toEqual({ literal: 14 });
    expect(variable(plan, "opacity.disabled")!.values["*"]).toEqual({ literal: 40 });
    expect(variable(plan, "font.family.text")!.values["*"]).toEqual({ literal: "Inter" });
    expect(plan.effectStyles[0].layers.map((l) => l.inner)).toEqual([false, true]);
  });

  it("dtcg tokens-studio: lists math and color modifiers as not in Figma", () => {
    const { plan } = studioPlan();
    expect(plan.notInFigma).toEqual(expect.arrayContaining([
      { path: "spacing.double", reason: "Tokens Studio math has no Figma value" },
      { path: "content.hover", reason: "Tokens Studio's color modifiers have no Figma value" },
    ]));
    expect(variable(plan, "spacing.double")).toBeUndefined();
  });
});

describe("dtcg mapped", () => {
  it("dtcg mapped: suggests a mapping from file names and extension keys", () => {
    const files = readFolder(fixtureTexts("mapped-files"));
    const m = suggestMapping(files);
    expect(m.files["color.tokens.json"]).toEqual({ kind: "base" });
    expect(m.files["mode.dark.tokens.json"]).toEqual({ kind: "context", axis: "mode", context: "dark" });
    expect(m.files["viewport.medium.tokens.json"]).toEqual({ kind: "context", axis: "viewport", context: "medium" });
    expect(m.axes!.mode).toEqual({ contexts: ["light", "dark"], default: "light" });
    expect(m.axes!.viewport.default).toBe("compact");
    const ext = suggestMapping(readFolder(fixtureTexts("mapped-extensions")));
    expect(ext.extension).toEqual({ key: "com.example.modes", defaults: { brand: "default", mode: "light" } });
    expect(ext.files["tone.light.tokens.json"]).toEqual({ kind: "context", axis: "mode", context: "light" });
  });
});

describe("dtcg files", () => {
  it("dtcg files: skips package.json, *.resolved.json and files with no token", () => {
    const files = readFolder(fixtureTexts("resolver"));
    for (const f of ["package.json", "example.resolved.json", "notes.json"]) {
      expect(files.tokenFiles, f).not.toContain(f);
      if (f !== "notes.json") expect(files.json[f], f).toBeUndefined();
      expect(files.issues.some((i) => i.file === f), f).toBe(false);
    }
    const more = readFolder({ "node_modules/x/a.tokens.json": "{}", ".github/a.json": "{}", "dist/a.tokens.json": "{}", "tsconfig.base.json": "{}", "a.tokens.json": JSON.stringify({ a: { $type: "number", $value: 1 } }) });
    expect(Object.keys(more.json)).toEqual(["a.tokens.json"]);
    expect(more.tokenFiles).toEqual(["a.tokens.json"]);
  });

  it("dtcg files: a broken file is an issue that does not stop the read", () => {
    const { read, plan } = filesPlan();
    expect(read.issues).toEqual(expect.arrayContaining([expect.objectContaining({ level: "error", file: "broken.tokens.json" })]));
    expect(plan.variables.length).toBeGreaterThan(30);
  });

  it("dtcg files: a broken file the resolver points at stops the read with its path", () => {
    const texts = fixtureTexts("resolver");
    texts["modes/mode.dark.tokens.json"] = "{ nope";
    expect(() => readAndPlan(texts, { format: "resolver" })).toThrow(/modes\/mode\.dark\.tokens\.json, which the resolver points at, isn't valid JSON/);
  });
});

describe("dtcg values", () => {
  it("dtcg values: colors in srgb, hsl and hwb are exact, oklch is clipped and listed, never black", () => {
    const hex = (v: unknown) => {
      const r = readColor(v);
      return "error" in r ? r.error : rgbaHex(r.rgba);
    };
    expect(hex({ colorSpace: "srgb", components: [1, 0.5, 0] })).toBe("#ff8000");
    expect(hex({ colorSpace: "hsl", components: [140, 60, 40] })).toBe("#29a352");
    expect(hex({ colorSpace: "hwb", components: [240, 0, 0] })).toBe("#0000ff");
    expect(hex({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.1 })).toBe("#0000001a");
    expect(hex("#ABC")).toBe("#aabbcc");
    const { plan } = resolverPlan();
    expect(rgbaHex(variable(plan, "color.solid.violet.500")!.values["*"] as never)).not.toBe("#000000");
    expect(plan.issues).toEqual(expect.arrayContaining([expect.objectContaining({ level: "warning", path: "color.solid.violet.500", message: expect.stringMatching(/oklch, outside sRGB: converted and clipped/) })]));
    expect(plan.issues.some((i) => i.path === "color.solid.green.500")).toBe(false);
    /* A color it can't read is an issue, never black. */
    const bad = planFromLayers(layers({ c: { $type: "color", $value: { colorSpace: "cmyk", components: [0, 0, 0] } } }));
    expect(variable(bad, "c")).toBeUndefined();
    expect(bad.issues).toEqual([expect.objectContaining({ level: "error", path: "c", message: expect.stringMatching(/color space "cmyk"/) })]);
  });

  it("dtcg values: an alpha Figma keeps in 32 bits gives the same hex as the repository's (0.7 and 0.9 sit on a rounding edge)", () => {
    for (const a of [0.05, 0.1, 0.3, 0.7, 0.9, 0.95]) {
      /* What the plan writes, and what Figma reads back: the same color in the snapshot, or the file never matches. */
      expect(rgbaHex({ r: 1, g: 1, b: 1, a: Math.fround(a) })).toBe(rgbaHex({ r: 1, g: 1, b: 1, a }));
      expect(rgbaHex({ r: Math.fround(0.7), g: 0, b: 0 })).toBe(rgbaHex({ r: 0.7, g: 0, b: 0 }));
    }
  });

  it("dtcg values: a font family variable holds the first family, and its description the whole stack", () => {
    const { plan } = readAndPlan({ "a.tokens.json": JSON.stringify({ font: { text: { $type: "fontFamily", $value: ["Söhne", "Helvetica Neue", "sans-serif"] }, mono: { $type: "fontFamily", $value: "Plex Mono" } } }) }, { format: "mapped" });
    const text = plan.variables.find((v) => v.path === "font.text")!;
    expect(JSON.stringify(text)).toContain("Söhne");
    expect(text.description).toBe("Font stack: Söhne, Helvetica Neue, sans-serif.");
    expect(plan.variables.find((v) => v.path === "font.mono")!.description).toBe("");
  });

  it("dtcg values: rem with the default base and a changed one", () => {
    expect(variable(resolverPlan().plan, "font.size.sm")!.values["*"]).toEqual({ literal: 14 });
    expect(variable(readAndPlan(fixtureTexts("resolver"), { format: "resolver", remBase: 10 }).plan, "font.size.sm")!.values["*"]).toEqual({ literal: 8.75 });
  });

  it("dtcg values: opacity from 0 to 100", () => {
    expect(variable(resolverPlan().plan, "opacity.disabled")!.values["*"]).toEqual({ literal: 40 });
    expect(literalOf("opacity", 1.5, 16)).toEqual({ error: expect.stringMatching(/from 0 to 1/) });
    expect(literalOf("duration", { value: 0.2, unit: "s" }, 16)).toEqual({ value: 200 });
    expect(literalOf("fontWeight", "bold", 16)).toEqual({ value: 700 });
  });

  it("dtcg values: reads Tokens Studio's strings", () => {
    expect(literalOf("dimension", "16px", 16)).toEqual({ value: 16 });
    expect(literalOf("dimension", "1.5rem", 16)).toEqual({ value: 24 });
    expect(literalOf("opacity", "50%", 16)).toEqual({ value: 50 });
    expect(literalOf("fontWeight", "Semi Bold", 16)).toEqual({ value: 600 });
    expect(literalOf("fontFamily", "Inter, sans-serif", 16)).toEqual({ value: "Inter" });
    expect(literalOf("boolean", "true", 16)).toEqual({ value: true });
  });

  it("dtcg values: lists an unreadable value and the token that references it, with their paths", () => {
    const plan = planFromLayers(layers({ a: { $type: "dimension", $value: { value: 2, unit: "vw" } }, b: { $type: "dimension", $value: "{a}" }, c: { $type: "dimension", $value: "{b}" } }));
    expect(plan.variables).toEqual([]);
    expect(plan.refused.map((r) => r.path).sort()).toEqual(["a", "b", "c"]);
    expect(plan.refused.find((r) => r.path === "b")!.reason).toMatch(/b points at a, which was left out/);
    const deprecated = variable(resolverPlan().plan, "content.legacy")!;
    expect(deprecated.description).toBe("Deprecated: Use content.secondary.");
  });
});

describe("dtcg collections", () => {
  it("dtcg collections: literals in Primitives, hidden on creation, and references in Semantic", () => {
    const { plan } = resolverPlan();
    expect(variable(plan, "color.solid.blue.500")!.collection).toBe(PRIMITIVES);
    expect(variable(plan, "spacing.100")!.collection).toBe(PRIMITIVES);
    expect(variable(plan, "content.primary")!.collection).toBe(SEMANTIC);
    expect(variable(plan, "shape.control")!.collection).toBe(SEMANTIC);
    expect(plan.collections.find((c) => c.key === PRIMITIVES)!.hidden).toBe(true);
    expect(plan.collections.find((c) => c.key === SEMANTIC)!.hidden).toBe(false);
    /* $root takes its group's path. */
    expect(variable(plan, "color.accent")!.name).toBe("color/accent");
  });

  it("dtcg collections: an axis that adds its own level is a collection with a mode per context", () => {
    const { plan } = resolverPlan();
    const mode = plan.collections.find((c) => c.name === "Mode")!;
    expect(mode.modes.map((m) => m.name)).toEqual(["Light", "Dark"]);
    expect(variable(plan, "tone.neutral.900")!.collection).toBe(mode.key);
    expect(variable(plan, "layout.margin")!.collection).toBe("dtcg:axis:viewport");
    expect(plan.collections.find((c) => c.name === "Viewport")!.modes.map((m) => m.name)).toEqual(["Compact", "Medium", "Expanded"]);
    expect(variable(plan, "layout.columns")!.values).toEqual({ "viewport=compact": { literal: 4 }, "viewport=medium": { literal: 8 }, "viewport=expanded": { literal: 12 } });
  });

  it("dtcg collections: brand × mode gives combined modes", () => {
    const sem = resolverPlan().plan.collections.find((c) => c.key === SEMANTIC)!;
    expect(sem.axes).toEqual(["brand", "mode"]);
    expect(sem.modes.map((m) => m.name)).toEqual(["Standard · Light", "Standard · Dark", "Premium · Light", "Premium · Dark"]);
  });

  it("dtcg collections: an empty axis and an axis Figma cannot hold make no collection, each with its reason", () => {
    const { plan } = resolverPlan();
    expect(plan.axesOut).toEqual([{ name: "motion", reason: "not-in-figma", count: 2 }, { name: "density", reason: "empty", count: 0 }]);
    expect(plan.collections.some((c) => /motion|density/i.test(c.name))).toBe(false);
    expect(plan.notInFigma).toEqual(expect.arrayContaining([{ path: "transition.enter", reason: "transition has no Figma variable" }]));
  });

  it("dtcg collections: refuses a token on both kinds of axis, and three axes on one collection, with the path", () => {
    const axis = (name: string, ctxs: Record<string, Record<string, unknown>>) => ({ name, default: Object.keys(ctxs)[0], contexts: Object.entries(ctxs).map(([n, tree]) => ({ name: n, sources: [src(tree)] })) });
    const num = (n: number) => ({ $type: "number", $value: n });
    const both = planFromLayers(layers({ a: num(1) }, [axis("mode", { light: { lvl: num(1) }, dark: { lvl: num(2) } }), axis("brand", { x: {}, y: { lvl: num(3) } })]));
    expect(both.refused).toEqual([expect.objectContaining({ path: "lvl", reason: expect.stringMatching(/"mode" adds.*"brand" redefines/) })]);
    const three = planFromLayers(layers({ a: num(1) }, ["p", "q", "r"].map((n) => axis(n, { one: {}, two: { a: num(2) } }))));
    expect(three.refused).toEqual([expect.objectContaining({ path: "a", reason: expect.stringMatching(/three or more axes/) })]);
  });
});

describe("dtcg aliases", () => {
  it("dtcg aliases: references become aliases, across collections too", () => {
    const { plan } = resolverPlan();
    expect(variable(plan, "content.primary")!.values["brand=standard|mode=light"]).toEqual({ alias: "tone.neutral.900" });
    expect(variable(plan, "tone.neutral.900")!.values).toEqual({ "mode=light": { alias: "color.solid.neutral.900" }, "mode=dark": { alias: "color.solid.neutral.100" } });
    expect(variable(plan, "layout.margin")!.values["viewport=medium"]).toEqual({ alias: "spacing.400" });
    /* Collections are created in dependency order. */
    expect(plan.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
  });

  it("dtcg aliases: a role the context does not redefine has the base's value", () => {
    const v = variable(resolverPlan().plan, "content.primary")!;
    expect(v.values["brand=premium|mode=light"]).toEqual(v.values["brand=standard|mode=light"]);
    const brand = variable(resolverPlan().plan, "content.brand")!;
    expect(brand.values["brand=standard|mode=dark"]).toEqual({ alias: "color.solid.blue.500" });
    expect(brand.values["brand=premium|mode=dark"]).toEqual({ alias: "color.solid.violet.500" });
    expect(brand.origins["brand=premium|mode=light"]).toEqual({ file: "modes/brand.premium.tokens.json" });
    const overlay = variable(resolverPlan().plan, "bg.overlay")!;
    expect(overlay.values["brand=premium|mode=dark"]).toEqual({ alias: "color.alpha.black.40" });
  });
});

describe("dtcg limits", () => {
  it("dtcg limits: a collection over the variable limit is refused before writing", () => {
    const tree: Record<string, unknown> = {};
    for (let i = 0; i < 5001; i++) tree[`n${i}`] = { $type: "number", $value: i };
    const plan = planFromLayers(layers({ big: tree, ok: { $type: "number", $value: 1 }, ref: { $type: "number", $value: "{big.n1}" } }));
    expect(plan.collections.map((c) => c.name)).toEqual([]);
    expect(plan.issues[0].message).toMatch(/Primitives would hold 5002 variables; a Figma collection holds 5000/);
    expect(plan.refused.find((r) => r.path === "ref")!.reason).toMatch(/points at big\.n1/);
  });

  it("dtcg limits: two tokens with the same Figma name are refused with both paths", () => {
    const plan = planFromLayers(layers({ size: { "1/2": { $type: "number", $value: 1 }, 1: { 2: { $type: "number", $value: 2 } } }, other: { $type: "number", $value: 3 } }));
    expect(plan.variables.map((v) => v.path)).toEqual(["other"]);
    expect(plan.issues).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/size\.1\/2 and size\.1\.2 have the same Figma name|size\.1\.2 and size\.1\/2 have the same Figma name/) })]));
  });
});

describe("dtcg styles (plan)", () => {
  it("dtcg styles: text styles from typography tokens and from groups of type tokens", () => {
    const { plan } = resolverPlan();
    expect(plan.textStyles.map((s) => s.name)).toEqual(["heading/lg", "body/md"]);
    const body = plan.textStyles.find((s) => s.id === "body.md")!;
    expect(body).toMatchObject({ family: { path: "font.family.text", value: ["Inter", "Arial", "sans-serif"] }, size: { path: "body.md.size", value: 16 }, weight: { path: "body.md.weight", value: 400 }, lineHeight: { path: "body.md.line-height", value: 24 } });
    /* Another weight of the role is a variable to bind, not a style of its own. */
    expect(plan.textStyles.some((s) => s.id === "body.md.strong")).toBe(false);
    expect(plan.variables.some((v) => v.path === "body.md.weight-strong")).toBe(true);
  });

  it("dtcg styles: named role/size, without a shared prefix, in the order of a type scale, largest size first", () => {
    const style = (path: string, size: number) => ({ size: { $type: "dimension", $value: { value: size, unit: "px" } }, weight: { $type: "fontWeight", $value: 400 }, "line-height": { $type: "dimension", $value: { value: size + 4, unit: "px" } } });
    const tree = { type: {
      caption: { md: style("", 12) }, body: { sm: style("", 14), lg: style("", 18), md: style("", 16) },
      label: { sm: style("", 12), md: style("", 14) }, display: { lg: style("", 40) }, chip: { md: style("", 13) }, heading: { md: style("", 24), sm: style("", 20) },
    }, font: { family: { $type: "fontFamily", $value: "Inter" } } };
    const { plan } = readAndPlan({ "typography.tokens.json": JSON.stringify(tree) }, { format: "mapped" });
    expect(plan.textStyles.map((s) => s.name)).toEqual(["display/lg", "heading/md", "heading/sm", "body/lg", "body/md", "body/sm", "label/md", "label/sm", "caption/md", "chip/md"]);
    /* The ids stay the repository's paths: the repository is the reference, Figma only shows it this way. */
    expect(plan.textStyles[0].id).toBe("type.display.lg");
  });

  it("dtcg styles: a multiplier line height becomes a percentage", () => {
    expect(resolverPlan().plan.textStyles.find((s) => s.id === "heading.lg")!.lineHeight).toEqual({ percent: 125 });
  });

  it("dtcg styles: effect styles from shadow tokens, with every layer", () => {
    const s = resolverPlan().plan.effectStyles[0];
    expect(s.name).toBe("shadow/raised");
    expect(s.layers).toHaveLength(2);
    expect(s.layers[0].y).toEqual({ path: "spacing.100", value: 4 });
    expect(s.layers[1]).toMatchObject({ inner: true, color: { path: "color.alpha.black.40" } });
  });
});

describe("dtcg format", () => {
  it("dtcg format: suggests resolver, tokens-studio or mapped from what the folder holds", () => {
    const of = (texts: Record<string, string>) => detect(Object.keys(texts), readFolder(texts));
    expect(of({ "tokens/sys/color.json": "{}" }).suggested).toBe(null);
    expect(of(fixtureTexts("resolver")).suggested).toBe("resolver");
    expect(of(fixtureTexts("tokens-studio")).suggested).toBe("tokens-studio");
    expect(of(fixtureTexts("mapped-files")).suggested).toBe("mapped");
    expect(of(fixtureTexts("resolver")).candidates).toEqual(["resolver", "mapped"]);
  });
});

describe("dtcg large", () => {
  it("dtcg large: 3,000 tokens in 150 files read and plan in under 10 seconds", () => {
    const texts: Record<string, string> = {};
    for (let f = 0; f < 150; f++) {
      const tree: Record<string, unknown> = {};
      for (let i = 0; i < 20; i++) {
        const n = f * 20 + i;
        tree[`t${i}`] = n % 3 === 0 ? { $type: "color", $value: { colorSpace: "srgb", components: [(n % 255) / 255, 0.5, 0.25] } } : n % 3 === 1 || i === 0 ? { $type: "dimension", $value: { value: n, unit: "px" } } : { $type: "dimension", $value: `{g${f}.t${i - 1}}` };
      }
      texts[`group-${f}.tokens.json`] = JSON.stringify({ [`g${f}`]: tree });
    }
    const start = performance.now();
    const { plan } = readAndPlan(texts, { format: "mapped" });
    expect(performance.now() - start).toBeLessThan(10_000);
    expect(plan.variables).toHaveLength(3000);
  });
});
