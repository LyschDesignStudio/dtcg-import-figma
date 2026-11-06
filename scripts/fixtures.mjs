/* Writes test/repos/: one made-up design system ("Example DS") in the four
   layouts the plugin reads, so the tests can prove they give the same plan.
   The names, values and the com.example extension are invented.
   Run: node scripts/fixtures.mjs */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../test/repos");

/* ───── the design system, in one place ───── */

const HEX = {
  "neutral.0": "#ffffff", "neutral.100": "#f2f2f4", "neutral.500": "#7a7a85", "neutral.900": "#1d1d22", "neutral.1000": "#000000",
  "blue.500": "#2f6bff", "blue.700": "#1f47b3",
};
const hexToSrgb = (hex) => ({ colorSpace: "srgb", components: [1, 3, 5].map((i) => Math.round((parseInt(hex.slice(i, i + 2), 16) / 255) * 10000) / 10000), hex });
/* violet: out of sRGB's gamut, so it is clipped and listed; its sRGB stand-in, for the layouts that can't hold oklch. */
const VIOLET_OKLCH = { colorSpace: "oklch", components: [0.62, 0.3, 300] };
const VIOLET_CLIPPED = "#a832ff";
/* green in hsl (exact), amber as a hex string. */
const GREEN_HSL = { colorSpace: "hsl", components: [140, 60, 40] };
const GREEN_HEX = "#29a352";
const AMBER = "#f5a524";
const BLACK_10 = { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.1, hex: "#000000" };
const BLACK_40 = { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.4, hex: "#000000" };

const px = (value) => ({ value, unit: "px" });
const t = (type, value, extra = {}) => ({ $type: type, $value: value, ...extra });

/** The base, in DTCG: files of the set "foundation". */
function dtcgBase({ colors = "objects" } = {}) {
  const solid = {};
  for (const [path, hex] of Object.entries(HEX)) {
    const [family, step] = path.split(".");
    (solid[family] ??= {})[step] = t("color", colors === "hex" ? hex : hexToSrgb(hex));
  }
  solid.violet = { 500: t("color", colors === "hex" ? VIOLET_CLIPPED : VIOLET_OKLCH) };
  solid.green = { 500: t("color", colors === "hex" ? GREEN_HEX : GREEN_HSL) };
  solid.amber = { 500: t("color", AMBER) };
  const color = {
    "color.tokens.json": {
      color: {
        solid,
        alpha: { black: { 10: t("color", colors === "hex" ? "#0000001a" : BLACK_10), 40: t("color", colors === "hex" ? "#00000066" : BLACK_40) } },
        accent: { $root: t("color", "{color.solid.blue.500}"), subtle: t("color", "{color.solid.blue.700}") },
      },
      content: {
        primary: t("color", "{tone.neutral.900}", { $description: "Body text." }),
        secondary: t("color", "{tone.neutral.500}"),
        brand: t("color", "{color.solid.blue.500}", { $extensions: { "com.example": { note: "the brand's ink" } } }),
        legacy: t("color", "{tone.neutral.500}", { $deprecated: "Use content.secondary." }),
      },
      bg: {
        surface: t("color", "{tone.neutral.0}"),
        overlay: t("color", "{color.alpha.black.10}"),
      },
      border: { default: t("color", "{tone.neutral.100}") },
    },
    "dimension.tokens.json": {
      spacing: { 100: t("dimension", px(4)), 200: t("dimension", px(8)), 400: t("dimension", px(16)), 600: t("dimension", px(24)) },
      radius: { sm: t("dimension", px(4)), full: t("dimension", px(9999)) },
      shape: { control: t("dimension", "{radius.full}") },
      opacity: { disabled: t("opacity", 0.4) },
    },
    "typography.tokens.json": {
      font: {
        family: { text: t("fontFamily", ["Inter", "Arial", "sans-serif"]) },
        size: { sm: t("dimension", { value: 0.875, unit: "rem" }), md: t("dimension", px(16)), lg: t("dimension", px(24)) },
        weight: { regular: t("fontWeight", 400), semibold: t("fontWeight", "semi-bold") },
        "line-height": { body: t("dimension", px(24)) },
      },
      heading: {
        lg: t("typography", { fontFamily: "{font.family.text}", fontSize: "{font.size.lg}", fontWeight: "{font.weight.semibold}", lineHeight: 1.25, letterSpacing: px(0) }),
      },
      body: {
        md: {
          size: t("dimension", "{font.size.md}"),
          "line-height": t("dimension", "{font.line-height.body}"),
          weight: t("fontWeight", "{font.weight.regular}"),
          "weight-strong": t("fontWeight", "{font.weight.semibold}"),
        },
      },
    },
    "effects.tokens.json": {
      shadow: {
        raised: t("shadow", [
          { color: "{color.alpha.black.10}", offsetX: px(0), offsetY: "{spacing.100}", blur: px(8), spread: px(0) },
          { color: "{color.alpha.black.40}", offsetX: px(0), offsetY: px(1), blur: px(2), spread: px(0), inset: true },
        ]),
      },
    },
  };
  return color;
}

const tone = (scheme) => ({
  tone: {
    neutral: Object.fromEntries(
      [["0", "0", "1000"], ["100", "100", "900"], ["500", "500", "500"], ["900", "900", "100"]].map(([step, light, dark]) => [step, t("color", `{color.solid.neutral.${scheme === "light" ? light : dark}}`)]),
    ),
  },
});
/* The mode axis both adds a level (tone.*) and swaps a role (bg.overlay in dark). */
const MODE = {
  light: tone("light"),
  dark: { ...tone("dark"), bg: { overlay: t("color", "{color.alpha.black.40}") } },
};
const BRAND = { premium: { content: { brand: t("color", "{color.solid.violet.500}") }, bg: { overlay: t("color", "{color.solid.blue.700}") } } };
const VIEWPORT = {
  compact: { layout: { margin: t("dimension", "{spacing.200}"), columns: t("number", 4) } },
  medium: { layout: { margin: t("dimension", "{spacing.400}"), columns: t("number", 8) } },
  expanded: { layout: { margin: t("dimension", "{spacing.600}"), columns: t("number", 12) } },
};
const transition = (ms) => t("transition", { duration: { value: ms, unit: "ms" }, delay: { value: 0, unit: "ms" }, timingFunction: [0.2, 0, 0, 1] });
const MOTION = {
  full: { transition: { enter: transition(200), exit: transition(150) } },
  reduced: { transition: { enter: transition(0), exit: transition(0) } },
};

const NOISE = {
  "package.json": { name: "example-tokens", version: "1.0.0" },
  "broken.tokens.json": "{ \"color\": { \"oops\": ",
  "notes.json": { owner: "design", reviewed: true },
};

/* ───── writing ───── */

function write(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    const file = join(OUT, dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
}

rmSync(OUT, { recursive: true, force: true });

/* 1. resolver/ — under a nested folder, as a repository would keep it. */
{
  const base = dtcgBase();
  const files = { ...base, ...NOISE };
  for (const [ctx, tree] of Object.entries(MODE)) files[`modes/mode.${ctx}.tokens.json`] = tree;
  files["modes/brand.premium.tokens.json"] = BRAND.premium;
  for (const [ctx, tree] of Object.entries(VIEWPORT)) files[`modes/viewport.${ctx}.tokens.json`] = tree;
  for (const [ctx, tree] of Object.entries(MOTION)) files[`modes/motion.${ctx}.tokens.json`] = tree;
  files["example.resolved.json"] = { note: "a generated permutation: never read" };
  files["example.resolver.json"] = {
    version: "2025.10",
    name: "Example DS",
    sets: { foundation: { sources: Object.keys(base).map((f) => ({ $ref: f })) } },
    modifiers: {
      brand: { default: "standard", contexts: { standard: [], premium: [{ $ref: "modes/brand.premium.tokens.json" }] } },
      mode: { default: "light", contexts: { light: [{ $ref: "modes/mode.light.tokens.json" }], dark: [{ $ref: "modes/mode.dark.tokens.json" }] } },
      viewport: {
        default: "compact",
        contexts: Object.fromEntries(Object.keys(VIEWPORT).map((c) => [c, [{ $ref: `modes/viewport.${c}.tokens.json` }]])),
        $extensions: { "com.example": { minWidth: { compact: px(0), medium: px(600), expanded: px(1024) } } },
      },
      motion: { default: "full", contexts: Object.fromEntries(Object.keys(MOTION).map((c) => [c, [{ $ref: `modes/motion.${c}.tokens.json` }]])) },
      density: { default: "regular", contexts: { regular: [], compact: [] } },
    },
    resolutionOrder: ["#/sets/foundation", "#/modifiers/brand", "#/modifiers/mode", "#/modifiers/viewport", "#/modifiers/motion", "#/modifiers/density"].map(($ref) => ({ $ref })),
  };
  write("resolver/tokens", files);
}

/* 2. mapped-files/ — the same files, no resolver: the names suggest the mapping. */
{
  const files = { ...dtcgBase(), ...NOISE };
  for (const [ctx, tree] of Object.entries(MODE)) files[`mode.${ctx}.tokens.json`] = tree;
  files["brand.premium.tokens.json"] = BRAND.premium;
  for (const [ctx, tree] of Object.entries(VIEWPORT)) files[`viewport.${ctx}.tokens.json`] = tree;
  for (const [ctx, tree] of Object.entries(MOTION)) files[`motion.${ctx}.tokens.json`] = tree;
  write("mapped-files", files);
}

/* 3. mapped-extensions/ — the roles that swap keep their modes in $extensions; the levels stay in files of their own. */
{
  const base = dtcgBase();
  const KEY = "com.example.modes";
  base["color.tokens.json"].content.brand.$extensions = { ...base["color.tokens.json"].content.brand.$extensions, [KEY]: { brand: { premium: "{color.solid.violet.500}" } } };
  base["color.tokens.json"].bg.overlay.$extensions = { [KEY]: { brand: { premium: "{color.solid.blue.700}" }, mode: { dark: "{color.alpha.black.40}" } } };
  const files = { ...base, ...NOISE };
  files["tone.light.tokens.json"] = tone("light");
  files["tone.dark.tokens.json"] = tone("dark");
  for (const [ctx, tree] of Object.entries(VIEWPORT)) files[`viewport.${ctx}.tokens.json`] = tree;
  for (const [ctx, tree] of Object.entries(MOTION)) files[`motion.${ctx}.tokens.json`] = tree;
  write("mapped-extensions", files);
}

/* 4. tokens-studio/ — sets as files in folders, $themes.json and $metadata.json, in Tokens Studio's syntax. */
{
  const toStudio = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return node;
    if ("$value" in node) {
      const type = { fontFamily: "fontFamilies", fontWeight: "fontWeights", shadow: "boxShadow", transition: "other" }[node.$type] ?? (node.$type === "dimension" ? "dimension" : node.$type);
      let value = node.$value;
      if (node.$type === "dimension" && value && typeof value === "object") value = `${value.value}${value.unit}`;
      if (node.$type === "fontFamily") value = value.join(", ");
      if (node.$type === "fontWeight" && value === "semi-bold") value = "Semi Bold";
      if (node.$type === "opacity") value = `${value * 100}%`;
      if (node.$type === "typography") value = { ...value, lineHeight: `${value.lineHeight * 100}%`, letterSpacing: `${value.letterSpacing.value}px` };
      if (node.$type === "shadow") value = value.map((l) => ({ x: typeof l.offsetX === "string" ? l.offsetX : `${l.offsetX.value}`, y: typeof l.offsetY === "string" ? l.offsetY : `${l.offsetY.value}`, blur: `${l.blur.value}`, spread: `${l.spread.value}`, color: l.color, type: l.inset ? "innerShadow" : "dropShadow" }));
      if (node.$type === "transition") value = JSON.stringify(value);
      const out = { value, type };
      if (node.$description) out.description = node.$description;
      return out;
    }
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== "$root").map(([k, v]) => [k, toStudio(v)]));
  };
  const base = dtcgBase({ colors: "hex" });
  /* Tokens Studio has no $root: the accent is a token of its own path's group (left out of the comparison). */
  delete base["color.tokens.json"].color.accent;
  const sets = {};
  for (const [f, tree] of Object.entries(base)) sets[`core/${f.replace(".tokens.json", "")}`] = toStudio(tree);
  /* Math and a color modifier: listed as not in Figma. */
  sets["core/dimension"].spacing.double = { value: "{spacing.200} * 2", type: "spacing" };
  sets["core/color"].content.hover = { value: "{color.solid.blue.500}", type: "color", $extensions: { "studio.tokens": { modify: { type: "darken", value: "0.1", space: "lch" } } } };
  for (const [ctx, tree] of Object.entries(MODE)) sets[`mode/${ctx}`] = toStudio(tree);
  sets["brand/premium"] = toStudio(BRAND.premium);
  for (const [ctx, tree] of Object.entries(VIEWPORT)) sets[`viewport/${ctx}`] = toStudio(tree);
  for (const [ctx, tree] of Object.entries(MOTION)) sets[`motion/${ctx}`] = toStudio(tree);
  /* A source set (references only) and a disabled one. */
  sets["global/palette-source"] = { palette: { ink: { value: "#123456", type: "color" } } };
  sets["drafts/unused"] = { draft: { value: "#ff00ff", type: "color" } };
  const core = Object.keys(sets).filter((s) => s.startsWith("core/"));
  const theme = (group, name, extra) => ({
    id: `${group}-${name}`,
    name,
    group,
    selectedTokenSets: { ...Object.fromEntries(core.map((s) => [s, "enabled"])), "global/palette-source": "source", "drafts/unused": "disabled", ...extra },
  });
  const themes = [
    theme("brand", "standard", {}),
    theme("brand", "premium", { "brand/premium": "enabled" }),
    theme("mode", "light", { "mode/light": "enabled" }),
    theme("mode", "dark", { "mode/dark": "enabled" }),
    ...Object.keys(VIEWPORT).map((c) => theme("viewport", c, { [`viewport/${c}`]: "enabled" })),
    ...Object.keys(MOTION).map((c) => theme("motion", c, { [`motion/${c}`]: "enabled" })),
    theme("density", "regular", {}),
    theme("density", "compact", {}),
  ];
  const files = { "$themes.json": themes, "$metadata.json": { tokenSetOrder: Object.keys(sets) }, ...NOISE };
  for (const [set, tree] of Object.entries(sets)) files[`${set}.json`] = tree;
  write("tokens-studio", files);
}

console.log(`✔ ${OUT}`);
