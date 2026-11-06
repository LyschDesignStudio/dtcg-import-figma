/* The DTCG fixtures (test/repos/, written by scripts/fixtures.mjs): one made-up design system in four layouts. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Mapping } from "../src/model";

const ROOT = join(import.meta.dirname, "repos");

/** Every file of a fixture, by path relative to `folder` inside it. */
export function fixtureTexts(layout: "resolver" | "tokens-studio" | "mapped-files" | "mapped-extensions", folder = layout === "resolver" ? "tokens" : ""): Record<string, string> {
  const dir = join(ROOT, layout, folder);
  const out: Record<string, string> = {};
  const walk = (d: string, rel: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full, `${rel}${name}/`);
      else out[`${rel}${name}`] = readFileSync(full, "utf8");
    }
  };
  walk(dir, "");
  return out;
}

const AXES = {
  brand: { contexts: ["standard", "premium"], default: "standard" },
  mode: { contexts: ["light", "dark"], default: "light" },
  viewport: { contexts: ["compact", "medium", "expanded"], default: "compact" },
  motion: { contexts: ["full", "reduced"], default: "full" },
};
const base = ["color.tokens.json", "dimension.tokens.json", "typography.tokens.json", "effects.tokens.json"];
const ctx = (axis: string, context: string) => ({ kind: "context" as const, axis, context });
const levels = (prefix: string) => ({
  ...Object.fromEntries(["compact", "medium", "expanded"].map((c) => [`viewport.${c}.tokens.json`, ctx("viewport", c)])),
  ...Object.fromEntries(["full", "reduced"].map((c) => [`motion.${c}.tokens.json`, ctx("motion", c)])),
  [`${prefix}.light.tokens.json`]: ctx("mode", "light"),
  [`${prefix}.dark.tokens.json`]: ctx("mode", "dark"),
});

/** The mappings a designer confirms for the two mapped fixtures. */
export const MAPPINGS: Record<"mapped-files" | "mapped-extensions", Mapping> = {
  "mapped-files": {
    files: { ...Object.fromEntries(base.map((f) => [f, { kind: "base" as const }])), "brand.premium.tokens.json": ctx("brand", "premium"), ...levels("mode") },
    axes: AXES,
  },
  "mapped-extensions": {
    files: { ...Object.fromEntries(base.map((f) => [f, { kind: "base" as const }])), ...levels("tone") },
    extension: { key: "com.example.modes", defaults: { brand: "standard", mode: "light" } },
    axes: AXES,
  },
};
