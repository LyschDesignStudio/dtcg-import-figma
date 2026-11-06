/* Figma's scopes for a DTCG token, from its type and its name. Anything the
   table doesn't know gets every scope of its type. */

import type { FigmaType } from "./model";

type Rule = { test: RegExp; type: FigmaType; scopes: string[] };

/* The first rule that matches wins; the path is matched as dots. */
const RULES: Rule[] = [
  { test: /^(content|text|fg|foreground|on)(\.|$)/, type: "COLOR", scopes: ["TEXT_FILL"] },
  { test: /^(bg|background|surface)(\.|$)/, type: "COLOR", scopes: ["FRAME_FILL", "SHAPE_FILL"] },
  { test: /^(border|stroke|outline)(\.|$)/, type: "COLOR", scopes: ["STROKE_COLOR"] },
  { test: /^(shadow|elevation)(\.|$)/, type: "COLOR", scopes: ["EFFECT_COLOR"] },
  { test: /^(radius|shape|border-radius|corner)(\.|$)/, type: "FLOAT", scopes: ["CORNER_RADIUS"] },
  { test: /^(border-width|stroke|stroke-width|borderwidth)(\.|$)/, type: "FLOAT", scopes: ["STROKE_FLOAT"] },
  { test: /^(spacing|space|inset|gap|padding)(\.|$)|^layout\.(margin|gutter)(\.|$)/, type: "FLOAT", scopes: ["GAP"] },
  { test: /^(size|sizing|width|height)(\.|$)|(\.|^)(max|min)-(width|height)$/, type: "FLOAT", scopes: ["WIDTH_HEIGHT"] },
  { test: /^font\.size(\.|$)|(\.|^)(font-?size|size)$/, type: "FLOAT", scopes: ["FONT_SIZE"] },
  { test: /^font\.line-height(\.|$)|(\.|^)line-?height$/i, type: "FLOAT", scopes: ["LINE_HEIGHT"] },
  { test: /^font\.weight(\.|$)|(\.|^)(font-?weight|weight)(-[a-z]+)?$/i, type: "FLOAT", scopes: ["FONT_WEIGHT"] },
  { test: /^font\.letter-spacing(\.|$)|(\.|^)letter-?spacing$/i, type: "FLOAT", scopes: ["LETTER_SPACING"] },
  { test: /^(opacity|alpha)(\.|$)/, type: "FLOAT", scopes: ["OPACITY"] },
  { test: /^font\.family(\.|$)|(\.|^)font-?family$/i, type: "STRING", scopes: ["FONT_FAMILY"] },
];

/** By kind, for what the names don't say. */
const BY_KIND: Record<string, string[]> = {
  fontWeight: ["FONT_WEIGHT"],
  fontFamily: ["FONT_FAMILY"],
  opacity: ["OPACITY"],
  lineHeight: ["LINE_HEIGHT"],
  letterSpacing: ["LETTER_SPACING"],
};

export function scopesFor(path: string, type: FigmaType, kind: string): string[] {
  const p = path.toLowerCase();
  const rule = RULES.find((r) => r.type === type && r.test.test(p));
  if (rule) return [...rule.scopes].sort();
  if (BY_KIND[kind]) return BY_KIND[kind];
  return ["ALL_SCOPES"];
}
