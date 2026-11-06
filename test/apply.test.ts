/* A DTCG plan carried out in a (fake) Figma file. */

import { describe, expect, it } from "vitest";
import { adoptionOf, applyDtcg, deleteRemoved, DKEYS, previewOf, readDtcg, type ApplyOptions } from "../src/apply";
import { readAndPlan } from "../src/detect";
import type { Plan, ReadResult } from "../src/model";
import { planFromLayers } from "../src/plan";
import { fontNotes } from "../src/ui/strings";
import { FakeFigma, INTER } from "./fake-figma";
import { fixtureTexts } from "./fixtures";

const LINK: ApplyOptions["link"] = { v: 1, repo: { owner: "acme", name: "tokens", folder: "tokens" }, branch: "main", format: "resolver", remBase: 16, name: "Example", baseSha: "a".repeat(40) };
const resolverPlan = (texts = fixtureTexts("resolver")) => readAndPlan(texts, { format: "resolver" }).plan;
const apply = (fig: FakeFigma, plan: Plan, opts: Partial<ApplyOptions> = {}, progress?: (p: { done: number; total: number }) => void) => applyDtcg(fig.api, plan, { link: LINK, ...opts }, progress);
const layers = (base: Record<string, unknown>): ReadResult => ({ format: "mapped", layers: { base: [{ origin: { file: "a.tokens.json" }, tree: base, syntax: "dtcg" }], axes: [] }, issues: [], files: [] });
/** The resolver fixture with one file changed. */
function edited(path: string, change: (tree: Record<string, any>) => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const texts = fixtureTexts("resolver");
  const tree = JSON.parse(texts[path]);
  change(tree);
  texts[path] = JSON.stringify(tree);
  return texts;
}

describe("dtcg apply", () => {
  it("dtcg collections: literals in Primitives, hidden on creation, and references in Semantic (in Figma)", async () => {
    const fig = new FakeFigma();
    const r = await apply(fig, resolverPlan());
    expect(r.incomplete).toBe(false);
    expect(fig.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport", "Semantic"]);
    expect(fig.collection("Primitives").hiddenFromPublishing).toBe(true);
    expect(fig.collection("Semantic").modes.map((m) => m.name)).toEqual(["Standard · Light", "Standard · Dark", "Premium · Light", "Premium · Dark"]);
    /* Visibility is set only when it creates: the designer's choice stays. */
    fig.collection("Primitives").hiddenFromPublishing = false;
    await apply(fig, resolverPlan());
    expect(fig.collection("Primitives").hiddenFromPublishing).toBe(false);
    /* The plugin's own keys. */
    expect(fig.collections.map((c) => c.getSharedPluginData("dtcg_import", "collection"))).toEqual(["dtcg:base:literal", "dtcg:axis:mode", "dtcg:axis:viewport", "dtcg:base:reference"]);
    /* Aliases across collections. */
    const primary = fig.variable("content/primary");
    const sem = fig.collection("Semantic");
    expect(fig.variables.find((v) => v.id === (primary.valuesByMode[sem.modes[0].modeId] as { id: string }).id)!.name).toBe("tone/neutral/900");
    /* One undo step for the whole import. */
    expect(fig.undoSteps).toBeGreaterThan(0);
  });

  it("dtcg limits: a collection over the mode limit is refused with its message, and the rest applies", async () => {
    const fig = new FakeFigma({ modeLimit: 3 });
    const r = await apply(fig, resolverPlan());
    expect(r.refusedCollections).toEqual(["dtcg:base:reference"]);
    expect(r.issues).toEqual(expect.arrayContaining([expect.objectContaining({ level: "error", message: expect.stringMatching(/^brand × mode needs 4 modes; this Figma plan allows 3\./) })]));
    expect(fig.collections.map((c) => c.name)).toEqual(["Primitives", "Mode", "Viewport"]);
    expect(fig.variable("tone/neutral/900")).toBeTruthy();
    expect(r.incomplete).toBe(true);
    /* An existing collection is left as it was: the modes added for this import are taken back. */
    const ok = new FakeFigma();
    await apply(ok, resolverPlan());
    const vp = ok.collection("Viewport");
    vp.modeLimit = 3;
    const more = resolverPlan(edited("example.resolver.json", (d) => (d.modifiers.viewport.contexts.wide = [])));
    const r2 = await apply(ok, more);
    expect(r2.refusedCollections).toEqual(["dtcg:axis:viewport"]);
    expect(vp.modes.map((m) => m.name)).toEqual(["Compact", "Medium", "Expanded"]);
  });

  it("dtcg update: one failed write applies the rest and leaves the status import incomplete", async () => {
    const fig = new FakeFigma();
    fig.failValuesOf.add("spacing/400");
    const r = await apply(fig, resolverPlan());
    expect(r.incomplete).toBe(true);
    expect(r.link.incomplete!.issues).toEqual(expect.arrayContaining([expect.objectContaining({ path: "spacing.400" })]));
    expect(fig.variable("spacing/600").valuesByMode[fig.collection("Primitives").modes[0].modeId]).toBe(24);
    expect(JSON.parse(fig.root.getSharedPluginData("dtcg_import", DKEYS.link)).incomplete).toBeTruthy();
  });

  it("dtcg update: an import that completes clears import incomplete", async () => {
    const fig = new FakeFigma();
    fig.failValuesOf.add("spacing/400");
    await apply(fig, resolverPlan());
    fig.failValuesOf.clear();
    const r = await apply(fig, resolverPlan());
    expect(r.incomplete).toBe(false);
    expect((await readDtcg(fig.api)).link!.incomplete).toBeNull();
  });

  it("dtcg large: an import shows progress", async () => {
    const tree: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) tree[`n${i}`] = { $type: "number", $value: i };
    const seen: number[] = [];
    await apply(new FakeFigma(), planFromLayers(layers({ big: tree })), {}, (p) => seen.push(p.done));
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.at(-1)).toBe(seen.reduce((a, b) => Math.max(a, b)));
  });
});

describe("dtcg styles (Figma)", () => {
  it("dtcg styles: text styles from typography tokens and from groups of type tokens (in Figma)", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    expect(fig.textStyles.map((s) => s.name)).toEqual(["heading/lg", "body/md"]);
  });

  it("dtcg styles: binds family, size, weight, letter spacing and the shadow's color, offset, blur and spread", async () => {
    const plan = planFromLayers(layers({
      f: { $type: "fontFamily", $value: "Inter" }, s: { $type: "dimension", $value: { value: 16, unit: "px" } }, w: { $type: "fontWeight", $value: 600 },
      ls: { $type: "dimension", $value: { value: 1, unit: "px" } }, lh: { $type: "dimension", $value: { value: 24, unit: "px" } },
      c: { $type: "color", $value: "#00000033" }, o: { $type: "dimension", $value: { value: 2, unit: "px" } },
      type: { $type: "typography", $value: { fontFamily: "{f}", fontSize: "{s}", fontWeight: "{w}", letterSpacing: "{ls}", lineHeight: "{lh}" } },
      shadow: { $type: "shadow", $value: { color: "{c}", offsetX: "{o}", offsetY: "{o}", blur: "{o}", spread: "{o}" } },
    }));
    const fig = new FakeFigma();
    const r = await apply(fig, plan);
    expect(r.incomplete).toBe(false);
    const ts = fig.textStyles[0];
    const name = (a?: { id: string }) => fig.variables.find((v) => v.id === a?.id)?.name;
    expect(Object.fromEntries(Object.entries(ts.boundVariables).map(([k, a]) => [k, name(a)]))).toEqual({ fontFamily: "f", fontSize: "s", fontWeight: "w", letterSpacing: "ls", lineHeight: "lh" });
    const fx = fig.effectStyles[0].effects[0] as { boundVariables: Record<string, { id: string }> };
    expect(Object.fromEntries(Object.entries(fx.boundVariables).map(([k, a]) => [k, name(a)]))).toEqual({ color: "c", offsetX: "o", offsetY: "o", radius: "o", spread: "o" });
    /* The read-back sees the bindings. */
    expect((await readDtcg(fig.api)).snapshot.styles.shadow.bound).toEqual({ "0.color": "c", "0.x": "o", "0.y": "o", "0.blur": "o", "0.spread": "o" });
  });

  it("dtcg styles: the panel's order is the plan's, on every import, the file's own styles after", async () => {
    const fig = new FakeFigma();
    const plan = resolverPlan();
    await apply(fig, plan);
    expect(fig.textStyles.map((s) => s.name)).toEqual(plan.textStyles.map((s) => s.name));
    /* Out of order (by hand, or an older version of the plugin), and one of the file's own first: the next import puts them back. */
    const own = fig.api.createTextStyle();
    own.name = "mine";
    fig.textStyles.reverse();
    await apply(fig, plan);
    expect(fig.textStyles.map((s) => s.name)).toEqual([...plan.textStyles.map((s) => s.name), "mine"]);
  });

  it("dtcg styles: a multiplier line height becomes a percentage (in Figma)", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    expect(fig.textStyles.find((s) => s.name === "heading/lg")!.lineHeight).toEqual({ unit: "PERCENT", value: 125 });
    expect(fig.textStyles.find((s) => s.name === "body/md")!.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
  });

  it("dtcg styles: a missing font or weight stands in with Inter, said under Notes; with no Inter either, an issue on that style only", async () => {
    const plan = () => {
      const p = resolverPlan();
      p.textStyles.forEach((t) => (t.family.value = ["Söhne", "Arial"]));
      return p;
    };
    /* Arial (next in the stack) has Regular but no Semi Bold: one font for the whole scale, so Inter, which has every weight, stands in for all. */
    const fig = new FakeFigma({ fonts: [{ family: "Arial", style: "Regular" }, { family: "Arial", style: "Bold" }, ...INTER] });
    const r = await apply(fig, plan());
    expect(fig.textStyles.map((s) => s.name).sort()).toEqual(plan().textStyles.map((t) => t.name).sort());
    expect(new Set(fig.textStyles.map((s) => s.fontName.family))).toEqual(new Set(["Inter"]));
    expect(fig.textStyles.find((s) => s.name === "body/md")!.boundVariables.fontFamily).toBeUndefined();
    expect(r.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", path: "heading.lg", message: expect.stringMatching(/Söhne isn't in this Figma; Inter stands in/) }),
    ]));
    expect(r.issues.filter((i) => i.level === "error" && /font|weight/.test(i.message))).toEqual([]);
    expect(r.incomplete).toBe(false);
    /* The file keeps one entry per style; the panel says them as one note per font. */
    expect(r.link.fonts?.map((f) => f.style).sort()).toEqual(plan().textStyles.map((t) => t.name).sort());
    expect(fontNotes(r.link.fonts!)).toEqual([expect.stringMatching(/^Söhne isn't in this Figma: Inter stands in for 2 text styles \(.+\)\. Install Söhne and import again\.$/)]);
    /* A stack whose next family has every weight: that one, not Inter. */
    const arial = new FakeFigma({ fonts: [{ family: "Arial", style: "Regular" }, { family: "Arial", style: "Semi Bold" }, ...INTER] });
    await apply(arial, plan());
    expect(new Set(arial.textStyles.map((s) => s.fontName.family))).toEqual(new Set(["Arial"]));
    /* Not even Inter: an issue on that style, nothing created. */
    const none = new FakeFigma({ fonts: [{ family: "Roboto", style: "Regular" }] });
    const r2 = await apply(none, resolverPlan());
    expect(none.textStyles).toEqual([]);
    expect(r2.issues.filter((i) => /none of its fonts/.test(i.message))).toHaveLength(2);
  });
});

describe("dtcg removals", () => {
  it("dtcg removals: a token removed from the repository stays and is listed, and is deleted only after confirming", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    const gone = edited("dimension.tokens.json", (d) => delete d.spacing["600"]);
    /* The import's preview says so before it writes. */
    expect((await previewOf(fig.api, resolverPlan(gone))).removed).toContain("spacing.600");
    const r = await apply(fig, resolverPlan(gone));
    expect(fig.variable("spacing/600")).toBeTruthy();
    expect(r.removed).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "variable", path: "spacing.600" })]));
    /* Listed every time, until deleted. */
    expect((await readDtcg(fig.api)).removed.map((x) => x.path)).toContain("spacing.600");
    const id = fig.variable("spacing/600").id;
    expect(await deleteRemoved(fig.api, [id])).toEqual({ deleted: 1 });
    expect(fig.variables.some((v) => v.name === "spacing/600")).toBe(false);
    /* A variable the repository still has is never deleted, even if asked. */
    expect(await deleteRemoved(fig.api, [fig.variable("spacing/400").id])).toEqual({ deleted: 0 });
  });

  it("dtcg removals: a renamed token gives old → new", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    const renamed = edited("dimension.tokens.json", (d) => {
      d.spacing.lg = d.spacing["600"];
      delete d.spacing["600"];
    });
    expect((await previewOf(fig.api, resolverPlan(renamed))).replaced).toEqual([{ from: "spacing.600", to: "spacing.lg" }]);
    const r = await apply(fig, resolverPlan(renamed));
    expect(r.replaced).toEqual([{ from: "spacing.600", to: "spacing.lg" }]);
    expect(fig.variable("spacing/600")).toBeTruthy();
    expect(fig.variable("spacing/lg")).toBeTruthy();
  });

  it("dtcg removals: a token that flips between literal and reference stays in its collection", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    const flipped = edited("dimension.tokens.json", (d) => (d.spacing["600"] = { $type: "dimension", $value: "{spacing.400}" }));
    const plan = resolverPlan(flipped);
    expect(plan.variables.find((v) => v.path === "spacing.600")!.collection).toBe("dtcg:base:reference");
    const r = await apply(fig, plan);
    const v = fig.variable("spacing/600");
    expect(fig.collections.find((c) => c.id === v.variableCollectionId)!.name).toBe("Primitives");
    expect(r.state.misplaced).toEqual([{ path: "spacing.600", in: "Primitives", belongs: "dtcg:base:reference" }]);
    expect(r.drift, JSON.stringify([r.state.snapshot.tokens["spacing.600"], r.issues.filter((i) => i.path === "spacing.600")])).toEqual([]);
    expect(r.incomplete).toBe(false);
    expect(fig.variables.filter((x) => x.name === "spacing/600")).toHaveLength(1);
  });

  it("dtcg removals: styles follow the same rules", async () => {
    const fig = new FakeFigma();
    await apply(fig, resolverPlan());
    const gone = edited("effects.tokens.json", (d) => delete d.shadow.raised);
    const r = await apply(fig, resolverPlan(gone));
    expect(fig.effectStyles).toHaveLength(1);
    expect(r.removed).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "effect", path: "shadow.raised" })]));
    await deleteRemoved(fig.api, [fig.effectStyles[0].id]);
    expect(fig.effectStyles).toHaveLength(0);
  });
});

describe("dtcg adoption", () => {
  /** A file made by hand (or another tool): a Semantic collection with Dark before Light, a variable and a style with the planned names. */
  function handMade() {
    const fig = new FakeFigma();
    const c = fig.api.variables.createVariableCollection("Mode");
    c.renameMode(c.modes[0].modeId, "Dark");
    c.addMode("Light");
    const v = fig.api.variables.createVariable("tone/neutral/900", c, "COLOR");
    v.setValueForMode(c.modes[0].modeId, { r: 0.1, g: 0.1, b: 0.1, a: 1 });
    const s = fig.api.createEffectStyle();
    s.name = "shadow/raised";
    return { fig, c, v };
  }

  it("dtcg adoption: lists what it would adopt before linking, and adopts only when confirmed", async () => {
    const { fig, c, v } = handMade();
    const plan = resolverPlan();
    expect(await adoptionOf(fig.api, plan)).toEqual({ collections: ["Mode"], variables: 1, styles: ["shadow/raised"], tokensStudio: false });
    /* Not confirmed: the plugin makes its own beside them. */
    const apart = handMade();
    await apply(apart.fig, plan, { adopt: false });
    expect(apart.fig.collections.filter((x) => x.name === "Mode")).toHaveLength(2);
    expect(apart.v.getSharedPluginData("dtcg_import", DKEYS.token)).toBe("");
    /* Confirmed: adopted. */
    const r = await apply(fig, plan, { adopt: true });
    expect(r.adopted).toBe(3);
    expect(fig.collections.filter((x) => x.name === "Mode")).toEqual([c]);
    expect(JSON.parse(v.getSharedPluginData("dtcg_import", DKEYS.token))).toEqual({ v: 1, path: "tone.neutral.900" });
    expect(fig.effectStyles).toHaveLength(1);
    /* A file with Tokens Studio's data gets a warning. */
    fig.root.setSharedPluginData("tokens", "values", "{}");
    expect((await adoptionOf(fig.api, plan)).tokensStudio).toBe(true);
  });

  it("dtcg adoption: adopts modes by name, never by position", async () => {
    const { fig, c } = handMade();
    await apply(fig, resolverPlan(), { adopt: true });
    const dark = c.modes.find((m) => m.name === "Dark")!;
    const light = c.modes.find((m) => m.name === "Light")!;
    expect(c.modes[0]).toBe(dark);
    const v = fig.variable("tone/neutral/900");
    const target = (modeId: string) => fig.variables.find((x) => x.id === (v.valuesByMode[modeId] as { id: string }).id)!.name;
    expect(target(dark.modeId)).toBe("color/solid/neutral/100");
    expect(target(light.modeId)).toBe("color/solid/neutral/900");
  });
});
