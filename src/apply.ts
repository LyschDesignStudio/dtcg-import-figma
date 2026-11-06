/* A plan carried out in the Figma file: collections and modes by name, every
   write caught one by one, nothing deleted on its own (what the repository
   removed is listed for the designer to delete), and an "incomplete" mark
   when a write failed. The plugin's marks are shared plugin data. */

import { getData, getJson, KEYS, setData } from "./figma/identity";
import { hash, stableStringify } from "./shared/stable";
import type { DtcgLink, DtcgSnapshot, FigmaRefs, FontStandIn, Issue, Plan, PlannedCollection, PlannedTextStyle, PlannedValue, SnapStyle, SnapToken } from "./model";
import { snapValue } from "./plan";
import { rgbaHex } from "./color";

/** The marks this file's code sets, by role. */
export const DKEYS = { link: KEYS.link, token: KEYS.token, modes: KEYS.modes, style: KEYS.style, removed: KEYS.removed } as const;

export const isDtcgCollection = (c: VariableCollection) => getData(c, KEYS.collection).startsWith("dtcg:");

export interface Progress {
  done: number;
  total: number;
  label: string;
}

/** Something the repository no longer has, kept in Figma until the designer deletes it. */
export interface RemovedItem {
  kind: "variable" | "text" | "effect" | "collection" | "mode";
  id: string;
  name: string;
  /** The token's path (or the style's id), when there is one. */
  path?: string;
  /** For a mode: its collection's name. */
  of?: string;
}

export interface Replaced {
  from: string;
  to: string;
}

export interface DtcgFileState {
  snapshot: DtcgSnapshot;
  link: DtcgLink | null;
  removed: RemovedItem[];
  /** Variables the designer added to the plugin's collections: listed, never touched. */
  added: { id: string; name: string; collection: string }[];
  /** Variables kept in the collection they were created in, though their value now belongs in another. */
  misplaced: { path: string; in: string; belongs: string }[];
  counts: { variables: number; textStyles: number; effectStyles: number };
}

export interface ApplyOptions {
  link: Omit<DtcgLink, "snapshotHash" | "syncedAt" | "incomplete">;
  /** Adopt collections, variables and styles with the planned names that the plugin didn't make (the designer confirmed). */
  adopt?: boolean;
  figmaRefs?: FigmaRefs;
}

export interface ApplyResult {
  created: { variables: number; textStyles: number; effectStyles: number };
  updated: { variables: number; textStyles: number; effectStyles: number };
  adopted: number;
  /** Errors and warnings of this import (the plan's own come first). */
  issues: Issue[];
  /** What the file doesn't hold of the plan, read back: token paths and style ids. */
  drift: string[];
  removed: RemovedItem[];
  replaced: Replaced[];
  /** Collections Figma refused as a whole (a mode limit). */
  refusedCollections: string[];
  /** Variables renamed to …/root because Figma refused a variable and a group with the same name. */
  rootRenamed: string[];
  incomplete: boolean;
  link: DtcgLink;
  state: DtcgFileState;
}

const CHUNK = 50;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const closeColor = (a: RGBA, b: RGBA) => (["r", "g", "b", "a"] as const).every((k) => Math.abs((a[k] ?? 1) - (b[k] ?? 1)) < 1 / 512);
function sameValue(current: VariableValue | undefined, next: VariableValue): boolean {
  if (current === undefined) return false;
  if (typeof next === "object" && typeof current === "object") {
    if ("type" in next && next.type === "VARIABLE_ALIAS") return "type" in current && current.type === "VARIABLE_ALIAS" && current.id === next.id;
    if ("r" in next && "r" in current) return closeColor(current as RGBA, next as RGBA);
    return false;
  }
  if (typeof next === "number" && typeof current === "number") return Math.abs(next - current) < 1e-4;
  return current === next;
}

const isAlias = (v: unknown): v is VariableAlias => !!v && typeof v === "object" && (v as VariableAlias).type === "VARIABLE_ALIAS";
const norm = (s: string) => s.trim().toLowerCase();

/* ───── fonts: the first family of the stack Figma has with the weight exactly, else Inter ───── */

/** Figma has it in every weight, everywhere: the font that stands in for one this Figma lacks. */
export const STAND_IN = "Inter";

const STYLE_WEIGHTS: [RegExp, number][] = [
  [/^(thin|hairline)$/, 100], [/^(extra|ultra)light$/, 200], [/^light$/, 300], [/^(regular|normal|book|roman)$/, 400],
  [/^medium$/, 500], [/^(semi|demi)bold$/, 600], [/^bold$/, 700], [/^(extra|ultra)bold$/, 800], [/^(black|heavy)$/, 900],
];
export function styleWeight(style: string): number | null {
  const s = style.toLowerCase().replace(/[\s_-]/g, "");
  if (/italic|oblique/.test(s)) return null;
  return STYLE_WEIGHTS.find(([re]) => re.test(s))?.[1] ?? null;
}

function fontIndex(fonts: Font[]) {
  const byFamily = new Map<string, { style: string; weight: number }[]>();
  for (const { fontName } of fonts) {
    const weight = styleWeight(fontName.style);
    if (weight === null) continue;
    byFamily.set(fontName.family, [...(byFamily.get(fontName.family) ?? []), { style: fontName.style, weight }]);
  }
  return byFamily;
}

/* ───── read the file ───── */

function modesOf(c: VariableCollection): Map<string, string> {
  const stored = getJson<Record<string, string>>(c, DKEYS.modes) ?? {};
  const byKey = new Map<string, string>();
  for (const m of c.modes) {
    const key = stored[m.modeId];
    if (key && !byKey.has(key)) byKey.set(key, m.modeId);
  }
  return byKey;
}
const metaOf = (v: Variable) => getJson<{ v: 1; path: string }>(v, DKEYS.token);

export async function readDtcg(api: PluginAPI, plannedCollections?: Map<string, string>): Promise<DtcgFileState> {
  const all = await api.variables.getLocalVariableCollectionsAsync();
  const own = all.filter(isDtcgCollection);
  const byId = new Map(own.map((c) => [c.id, c]));
  const variables = (await api.variables.getLocalVariablesAsync()).filter((v) => byId.has(v.variableCollectionId));
  const pathOf = new Map<string, string>();
  for (const v of variables) {
    const m = metaOf(v);
    if (m && !getData(v, DKEYS.removed)) pathOf.set(v.id, m.path);
  }
  const removed: RemovedItem[] = [];
  const added: DtcgFileState["added"] = [];
  const misplaced: DtcgFileState["misplaced"] = [];
  const tokens: Record<string, SnapToken> = {};
  for (const v of variables) {
    const c = byId.get(v.variableCollectionId)!;
    const m = metaOf(v);
    if (!m) {
      added.push({ id: v.id, name: v.name, collection: c.name });
      continue;
    }
    if (getData(v, DKEYS.removed)) {
      removed.push({ kind: "variable", id: v.id, name: v.name, path: m.path, of: c.name });
      continue;
    }
    const values: SnapToken["values"] = {};
    for (const [key, modeId] of modesOf(c)) {
      const raw = v.valuesByMode[modeId];
      if (raw === undefined) continue;
      if (isAlias(raw)) values[key] = { alias: pathOf.get(raw.id) ?? `?${raw.id}` };
      else if (v.resolvedType === "COLOR") values[key] = { literal: rgbaHex(raw as RGBA) };
      else if (typeof raw === "number") values[key] = { literal: Math.round(raw * 10000) / 10000 + 0 };
      else values[key] = { literal: raw as string | boolean };
    }
    const key = getData(c, KEYS.collection);
    tokens[m.path] = { collection: key, type: v.resolvedType as SnapToken["type"], values };
    const belongs = plannedCollections?.get(m.path);
    if (belongs && belongs !== key) misplaced.push({ path: m.path, in: c.name, belongs });
  }
  for (const c of own) {
    if (getData(c, DKEYS.removed)) removed.push({ kind: "collection", id: c.id, name: c.name });
    const stale = getJson<string[]>(c, `${DKEYS.removed}Modes`) ?? [];
    for (const modeId of stale) {
      const mode = c.modes.find((m) => m.modeId === modeId);
      if (mode) removed.push({ kind: "mode", id: `${c.id}:${modeId}`, name: mode.name, of: c.name });
    }
  }
  const styles: Record<string, SnapStyle> = {};
  const texts = (await api.getLocalTextStylesAsync()).filter((s) => getData(s, DKEYS.style));
  for (const s of texts) {
    const id = getData(s, DKEYS.style);
    if (getData(s, DKEYS.removed)) {
      removed.push({ kind: "text", id: s.id, name: s.name, path: id });
      continue;
    }
    const bound: Record<string, string> = {};
    for (const f of ["fontSize", "fontWeight", "lineHeight", "letterSpacing"] as const) {
      const a = (s.boundVariables as Record<string, VariableAlias | undefined> | undefined)?.[f];
      if (a && pathOf.has(a.id)) bound[f] = pathOf.get(a.id)!;
    }
    styles[id] = { kind: "text", name: s.name, bound };
  }
  const effects = (await api.getLocalEffectStylesAsync()).filter((s) => getData(s, DKEYS.style));
  for (const s of effects) {
    const id = getData(s, DKEYS.style);
    if (getData(s, DKEYS.removed)) {
      removed.push({ kind: "effect", id: s.id, name: s.name, path: id });
      continue;
    }
    const bound: Record<string, string> = {};
    s.effects.forEach((e, i) => {
      const b = (e as { boundVariables?: Record<string, VariableAlias> }).boundVariables ?? {};
      const names: Record<string, string> = { color: "color", offsetX: "x", offsetY: "y", radius: "blur", spread: "spread" };
      for (const [field, name] of Object.entries(names)) if (b[field] && pathOf.has(b[field].id)) bound[`${i}.${name}`] = pathOf.get(b[field].id)!;
    });
    styles[id] = { kind: "effect", name: s.name, bound };
  }
  return {
    snapshot: { tokens, styles },
    link: getJson<DtcgLink>(api.root, DKEYS.link),
    removed,
    added,
    misplaced,
    counts: { variables: pathOf.size, textStyles: texts.length, effectStyles: effects.length },
  };
}

/* ───── before linking: what would be adopted ───── */

export interface Adoption {
  collections: string[];
  variables: number;
  styles: string[];
  /** The file holds Tokens Studio's plugin data: two plugins would write the same variables. */
  tokensStudio: boolean;
}

export async function adoptionOf(api: PluginAPI, plan: Plan): Promise<Adoption> {
  const all = await api.variables.getLocalVariableCollectionsAsync();
  const names = new Set(plan.collections.map((c) => norm(c.name)));
  const unowned = all.filter((c) => !getData(c, KEYS.collection) && names.has(norm(c.name)));
  const ids = new Set(unowned.map((c) => c.id));
  const planned = new Set(plan.variables.map((v) => v.name));
  const variables = (await api.variables.getLocalVariablesAsync()).filter((v) => ids.has(v.variableCollectionId) && planned.has(v.name)).length;
  const styleNames = new Set([...plan.textStyles, ...plan.effectStyles].map((s) => s.name));
  const styles = [...(await api.getLocalTextStylesAsync()), ...(await api.getLocalEffectStylesAsync())].filter((s) => !getData(s, DKEYS.style) && !getData(s, KEYS.style) && styleNames.has(s.name)).map((s) => s.name);
  let tokensStudio = false;
  try {
    tokensStudio = (api.root.getSharedPluginDataKeys?.("tokens") ?? []).length > 0;
  } catch {
    /* an API without it */
  }
  return { collections: unowned.map((c) => c.name), variables, styles, tokensStudio };
}

/* ───── the preview: what an import will do, before it writes ───── */

export interface Preview {
  created: number;
  changed: number;
  /** In the file, gone from the repository: they'd be listed, not deleted. */
  removed: string[];
  replaced: Replaced[];
  /** Tokens the plan refuses or leaves out. */
  refused: number;
  styles: { created: number; changed: number; removed: string[] };
  collections: { created: string[] };
}

const sameJson = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

/** Old → new: a token gone and one new, with the same type and the same value in every mode. */
function pairRenames(before: DtcgSnapshot["tokens"], after: DtcgSnapshot["tokens"], gone: string[], fresh: string[]): Replaced[] {
  const out: Replaced[] = [];
  const left = new Set(fresh);
  for (const from of gone) {
    const a = before[from];
    const matches = [...left].filter((to) => after[to].type === a.type && sameJson(after[to].values, a.values));
    if (matches.length === 1) {
      out.push({ from, to: matches[0] });
      left.delete(matches[0]);
    }
  }
  return out;
}

export async function previewOf(api: PluginAPI, plan: Plan): Promise<Preview> {
  const file = await readDtcg(api);
  const have = file.snapshot.tokens;
  const want = plan.snapshot.tokens;
  const fresh = Object.keys(want).filter((p) => !have[p]);
  const gone = Object.keys(have).filter((p) => !want[p]);
  const changed = Object.keys(want).filter((p) => have[p] && !sameJson(have[p].values, want[p].values)).length;
  const hs = file.snapshot.styles;
  const ws = plan.snapshot.styles;
  const owned = new Set((await api.variables.getLocalVariableCollectionsAsync()).filter(isDtcgCollection).map((c) => getData(c, KEYS.collection)));
  return {
    created: fresh.length,
    changed,
    removed: gone,
    replaced: pairRenames(have, want, gone, fresh),
    refused: plan.refused.length,
    styles: { created: Object.keys(ws).filter((k) => !hs[k]).length, changed: Object.keys(ws).filter((k) => hs[k] && !sameJson(hs[k], ws[k])).length, removed: Object.keys(hs).filter((k) => !ws[k]) },
    collections: { created: plan.collections.filter((c) => !owned.has(c.key)).map((c) => c.name) },
  };
}

/* ───── apply ───── */

export async function applyDtcg(api: PluginAPI, plan: Plan, opts: ApplyOptions, onProgress: (p: Progress) => void = () => {}): Promise<ApplyResult> {
  const issues: Issue[] = [...plan.issues];
  const failures: Issue[] = [];
  const fail = (i: Issue) => {
    issues.push(i);
    if (i.level === "error") failures.push(i);
  };
  const created = { variables: 0, textStyles: 0, effectStyles: 0 };
  const updated = { variables: 0, textStyles: 0, effectStyles: 0 };
  let adopted = 0;
  const refusedCollections: string[] = [];
  const rootRenamed: string[] = [];
  const total = plan.variables.length * 2 + plan.textStyles.length + plan.effectStyles.length + 1;
  let done = 0;
  const step = async (label: string) => {
    done++;
    if (done % CHUNK === 0) {
      onProgress({ done, total, label });
      await tick();
    }
  };
  const before = await readDtcg(api);
  (api as { commitUndo?: () => void }).commitUndo?.();
  onProgress({ done: 0, total, label: "Collections" });

  // 1. Collections and their modes; a collection Figma can't hold is refused as a whole, and left as it was.
  const existing = await api.variables.getLocalVariableCollectionsAsync();
  const collections = new Map<string, VariableCollection>();
  const modes = new Map<string, Record<string, string>>();
  for (const pc of plan.collections) {
    let c = existing.find((x) => getData(x, KEYS.collection) === pc.key);
    let isNew = false;
    if (!c && opts.adopt) {
      const ref = opts.figmaRefs?.collections.find((r) => r.collectionId && pc.axes.includes(r.axis))?.collectionId;
      c = existing.find((x) => !getData(x, KEYS.collection) && (x.id === ref || norm(x.name) === norm(pc.name)));
      if (c) {
        adopted++;
        issues.push({ level: "warning", message: `Adopted the existing "${c.name}" collection.` });
      }
    }
    if (!c) {
      try {
        c = api.variables.createVariableCollection(pc.name);
      } catch (e) {
        fail({ level: "error", message: `Couldn't create the ${pc.name} collection: ${(e as Error).message}` });
        refusedCollections.push(pc.key);
        continue;
      }
      isNew = true;
    }
    const found = ensureModes(c, pc, isNew);
    if ("error" in found) {
      fail({ level: "error", message: found.error });
      refusedCollections.push(pc.key);
      if (isNew) c.remove();
      continue;
    }
    setData(c, KEYS.collection, pc.key);
    if (getData(c, DKEYS.removed)) setData(c, DKEYS.removed, "");
    if (isNew && c.hiddenFromPublishing !== pc.hidden) c.hiddenFromPublishing = pc.hidden;
    if (c.name !== pc.name && isNew) c.name = pc.name;
    collections.set(pc.key, c);
    modes.set(pc.key, found.modes);
  }
  /* Collections of the plugin's the plan no longer has (a renamed axis): listed, never deleted. */
  for (const c of existing) {
    if (isDtcgCollection(c) && !plan.collections.some((p) => p.key === getData(c, KEYS.collection)) && !getData(c, DKEYS.removed)) setData(c, DKEYS.removed, "1");
  }

  // 2. Variables: found by their path (in whichever of the plugin's collections holds them), adopted by name, or created.
  const keyOf = new Map([...collections].map(([k, c]) => [c.id, k]));
  const ownIds = new Set(existing.filter(isDtcgCollection).map((c) => c.id).concat([...collections.values()].map((c) => c.id)));
  const locals = await api.variables.getLocalVariablesAsync();
  const byPath = new Map<string, Variable>();
  const unclaimed = new Map<string, Variable>();
  for (const v of locals) {
    if (!ownIds.has(v.variableCollectionId)) continue;
    const m = metaOf(v);
    if (m) byPath.set(m.path, v);
    else if (opts.adopt && keyOf.has(v.variableCollectionId)) unclaimed.set(`${keyOf.get(v.variableCollectionId)}|${v.name}`, v);
  }
  const refVar = opts.figmaRefs?.variables ?? {};
  const varOf = new Map<string, Variable>();
  /** The collection a variable's values go to: its own, which may not be the planned one (a token never moves). */
  const homeOf = new Map<string, string>();
  /** The values a variable gets, when they differ from the plan's (a token kept in another collection). */
  const valuesOf = new Map<string, Record<string, PlannedValue>>();
  const fresh = new Set<string>();
  const touched = new Set<string>();
  for (const pv of plan.variables) {
    if (refusedCollections.includes(pv.collection)) {
      await step(pv.path);
      continue;
    }
    try {
      let v = byPath.get(pv.path);
      if (v && keyOf.get(v.variableCollectionId) !== pv.collection) {
        /* Created in another collection: it stays there (Figma can't move a variable), when that one has the same modes. */
        const home = keyOf.get(v.variableCollectionId);
        const homeModes = home ? Object.keys(modes.get(home) ?? {}) : [];
        const same = new Set(Object.values(pv.values).map((x) => stableStringify(x))).size === 1;
        if (home && !Object.keys(pv.values).every((k) => homeModes.includes(k)) && same) {
          /* One value in every mode: it fits any collection's modes. */
          valuesOf.set(pv.path, Object.fromEntries(homeModes.map((k) => [k, Object.values(pv.values)[0]])));
        } else if (!home || !Object.keys(pv.values).every((k) => homeModes.includes(k))) {
          fail({ level: "error", path: pv.path, message: `${pv.name} is in another collection, whose modes don't match the ones it needs now. Delete it in Figma and import again.` });
          await step(pv.path);
          continue;
        }
      }
      if (!v && opts.adopt) {
        const byRef = refVar[pv.path] ? locals.find((x) => x.key === refVar[pv.path] && !metaOf(x)) : undefined;
        const k = `${pv.collection}|${pv.name}`;
        v = byRef ?? unclaimed.get(k);
        if (v) {
          unclaimed.delete(k);
          adopted++;
        }
      }
      if (!v) {
        const c = collections.get(pv.collection)!;
        try {
          v = api.variables.createVariable(pv.name, c, pv.type);
        } catch (e) {
          /* A token at its group's path ($root): Figma may refuse a variable and a group with the same name. */
          if (!plan.variables.some((o) => o.collection === pv.collection && o.name.startsWith(`${pv.name}/`))) throw e;
          v = api.variables.createVariable(`${pv.name}/root`, c, pv.type);
          rootRenamed.push(pv.path);
          issues.push({ level: "warning", path: pv.path, message: `${pv.path} is named ${pv.name}/root in Figma: Figma refused a variable and a group with the same name.` });
        }
        fresh.add(pv.path);
        created.variables++;
        v.scopes = pv.scopes as VariableScope[];
      }
      if (v.resolvedType !== pv.type) {
        fail({ level: "error", path: pv.path, message: `${pv.name} is a ${v.resolvedType} variable in Figma and a ${pv.type} in the repository. Figma can't change a variable's type; delete it and import again.` });
        await step(pv.path);
        continue;
      }
      setData(v, DKEYS.token, JSON.stringify({ v: 1, path: pv.path }));
      if (getData(v, DKEYS.removed)) setData(v, DKEYS.removed, "");
      const name = rootRenamed.includes(pv.path) ? `${pv.name}/root` : pv.name;
      if (v.name !== name && !fresh.has(pv.path)) {
        try {
          v.name = name;
          touched.add(pv.path);
        } catch (e) {
          fail({ level: "error", path: pv.path, message: `${pv.name}: couldn't rename it (${(e as Error).message}).` });
        }
      }
      if (v.description !== pv.description) {
        v.description = pv.description;
        touched.add(pv.path);
      }
      varOf.set(pv.path, v);
      homeOf.set(pv.path, keyOf.get(v.variableCollectionId)!);
    } catch (e) {
      fail({ level: "error", path: pv.path, message: `${pv.name}: ${(e as Error).message}` });
    }
    await step(pv.path);
  }

  // 3. Values, once every variable exists (an alias needs its target); each write caught on its own.
  for (const pv of plan.variables) {
    const v = varOf.get(pv.path);
    if (!v) {
      await step(pv.path);
      continue;
    }
    const ids = modes.get(homeOf.get(pv.path)!)!;
    for (const [mode, value] of Object.entries(valuesOf.get(pv.path) ?? pv.values)) {
      const modeId = ids[mode];
      if (!modeId) continue;
      const next = toFigma(api, value, varOf);
      if (next === null) {
        fail({ level: "error", path: pv.path, message: `${pv.name} (${mode}) points at ${(value as { alias: string }).alias}, which isn't in Figma.` });
        continue;
      }
      if (sameValue(v.valuesByMode[modeId], next)) continue;
      try {
        v.setValueForMode(modeId, next);
        touched.add(pv.path);
      } catch (e) {
        fail({ level: "error", path: pv.path, message: `${pv.name} (${mode}): ${(e as Error).message}` });
      }
    }
    await step(pv.path);
  }
  updated.variables = [...touched].filter((p) => !fresh.has(p)).length;

  // 4. What the repository no longer has: flagged and listed, never deleted here.
  const planned = new Set(plan.variables.map((v) => v.path));
  for (const [path, v] of byPath) {
    if (!planned.has(path) && !getData(v, DKEYS.removed)) setData(v, DKEYS.removed, "1");
  }

  // 5. Text styles: the font must be there, with the weight exactly; otherwise the style is left as it was.
  const fonts = fontIndex(await api.listAvailableFontsAsync());
  const fontNotes: FontStandIn[] = [];
  /* One stand-in per stack, for the whole type scale: the first family of the stack (else Inter) with every weight the stack's styles use,
     so a scale doesn't mix two fonts. A style whose weight no such family has takes the first family with its own weight. */
  const weightsOf = new Map<string, Set<number>>();
  for (const ts of plan.textStyles) {
    const k = ts.family.value.join("|");
    weightsOf.set(k, (weightsOf.get(k) ?? new Set()).add(ts.weight.value));
  }
  const has = (f: string, w: number) => !!fonts.get(f)?.some((x) => x.weight === w);
  const standIn = (ts: PlannedTextStyle) => {
    const candidates = [...ts.family.value, STAND_IN];
    if (has(ts.family.value[0], ts.weight.value)) return ts.family.value[0];
    const all = [...weightsOf.get(ts.family.value.join("|"))!];
    return candidates.find((f) => all.every((w) => has(f, w))) ?? candidates.find((f) => has(f, ts.weight.value));
  };
  const texts = await api.getLocalTextStylesAsync();
  for (const ts of plan.textStyles) {
    try {
      await applyText(ts);
    } catch (e) {
      fail({ level: "error", path: ts.id, message: `${ts.name}: ${(e as Error).message}` });
    }
    await step(ts.name);
  }
  /* The panel's order is the plan's (the type scale's), on every import; the file's own styles stay after them. */
  if (api.moveLocalTextStyleAfter) {
    const mine = new Map((await api.getLocalTextStylesAsync()).map((x) => [getData(x, DKEYS.style), x]));
    let prev: TextStyle | null = null;
    for (const ts of plan.textStyles) {
      const st = mine.get(ts.id);
      if (!st) continue;
      try {
        api.moveLocalTextStyleAfter(st, prev);
      } catch {
        /* Order only: never a reason to stop. */
      }
      prev = st;
    }
  }
  async function applyText(ts: PlannedTextStyle) {
    const wanted = ts.family.value[0];
    const family = standIn(ts);
    if (!family) {
      fail({ level: "error", path: ts.id, message: `${ts.name}: none of its fonts (${ts.family.value.join(", ")}) has weight ${ts.weight.value} in this Figma, nor ${STAND_IN}. Install ${wanted} and import again; the style was left as it was.` });
      return;
    }
    const pick = fonts.get(family)!.find((f) => f.weight === ts.weight.value)!;
    if (family !== wanted) {
      const missing = fonts.has(wanted) ? "weight" : "family";
      issues.push({ level: "warning", path: ts.id, message: `${ts.name}: ${missing === "weight" ? `${wanted} has no weight ${ts.weight.value} in this Figma` : `${wanted} isn't in this Figma`}; ${family} stands in. Install ${wanted} and import again.` });
      fontNotes.push({ style: ts.name, wanted, used: family, weight: ts.weight.value, missing });
    }
    let s = texts.find((x) => getData(x, DKEYS.style) === ts.id);
    if (!s && opts.adopt) {
      s = texts.find((x) => !getData(x, DKEYS.style) && !getData(x, KEYS.style) && x.name === ts.name);
      if (s) adopted++;
    }
    const font = { family, style: pick.style };
    await api.loadFontAsync(font);
    if (!s) {
      s = api.createTextStyle();
      created.textStyles++;
    } else updated.textStyles++;
    setData(s, DKEYS.style, ts.id);
    if (getData(s, DKEYS.removed)) setData(s, DKEYS.removed, "");
    if (s.name !== ts.name) s.name = ts.name;
    s.fontName = font;
    if (ts.size) s.fontSize = ts.size.value;
    if (ts.lineHeight) s.lineHeight = "percent" in ts.lineHeight ? { unit: "PERCENT", value: ts.lineHeight.percent } : { unit: "PIXELS", value: ts.lineHeight.value };
    if (ts.letterSpacing) s.letterSpacing = "percent" in ts.letterSpacing ? { unit: "PERCENT", value: ts.letterSpacing.percent } : { unit: "PIXELS", value: ts.letterSpacing.value };
    const bind: [VariableBindableTextField, string | null][] = [
      ["fontSize", ts.size?.path ?? null],
      ["lineHeight", ts.lineHeight && "path" in ts.lineHeight ? ts.lineHeight.path : null],
      ["letterSpacing", ts.letterSpacing && "path" in ts.letterSpacing ? ts.letterSpacing.path : null],
      ["fontWeight", ts.weight.path],
      /* Bound only to the family it names: binding it while another family stands in would point the style at a missing font. */
      ["fontFamily", family === ts.family.value[0] ? ts.family.path : null],
    ];
    for (const [f, path] of bind) {
      const v = path ? varOf.get(path) : undefined;
      if (!v) continue;
      try {
        s.setBoundVariable(f, v);
      } catch (e) {
        fail({ level: "error", path: ts.id, message: `${ts.name}: couldn't bind ${f} to ${path} (${(e as Error).message}).` });
      }
    }
  }

  // 6. Effect styles: every layer, each field bound when it is a reference.
  const effects = await api.getLocalEffectStylesAsync();
  for (const es of plan.effectStyles) {
    try {
      let s = effects.find((x) => getData(x, DKEYS.style) === es.id);
      if (!s && opts.adopt) {
        s = effects.find((x) => !getData(x, DKEYS.style) && !getData(x, KEYS.style) && x.name === es.name);
        if (s) adopted++;
      }
      if (!s) {
        s = api.createEffectStyle();
        created.effectStyles++;
      } else updated.effectStyles++;
      setData(s, DKEYS.style, es.id);
      if (getData(s, DKEYS.removed)) setData(s, DKEYS.removed, "");
      if (s.name !== es.name) s.name = es.name;
      s.effects = es.layers.map((l) => {
        let e = { type: l.inner ? "INNER_SHADOW" : "DROP_SHADOW", color: l.color.value, offset: { x: l.x.value, y: l.y.value }, radius: l.blur.value, spread: l.spread.value, visible: true, blendMode: "NORMAL" } as Effect;
        const fields: [VariableBindableEffectField, string | null][] = [["color", l.color.path], ["offsetX", l.x.path], ["offsetY", l.y.path], ["radius", l.blur.path], ["spread", l.spread.path]];
        for (const [f, path] of fields) {
          const v = path ? varOf.get(path) : undefined;
          if (!v) continue;
          try {
            e = api.variables.setBoundVariableForEffect(e, f, v);
          } catch (err) {
            fail({ level: "error", path: es.id, message: `${es.name}: couldn't bind ${f} to ${path} (${(err as Error).message}).` });
          }
        }
        return e;
      });
    } catch (e) {
      fail({ level: "error", path: es.id, message: `${es.name}: ${(e as Error).message}` });
    }
    await step(es.name);
  }
  const styleIds = new Set([...plan.textStyles, ...plan.effectStyles].map((s) => s.id));
  for (const s of [...texts, ...effects]) {
    const id = getData(s, DKEYS.style);
    if (id && !styleIds.has(id) && !getData(s, DKEYS.removed)) setData(s, DKEYS.removed, "1");
  }

  // 7. Read the file back: the proof it holds the plan, and the baseline for the next status.
  const state = await readDtcg(api, new Map(plan.variables.map((v) => [v.path, v.collection])));
  const expected = plannedSnapshot(plan, refusedCollections, homeOf, valuesOf);
  const drift = [
    ...Object.keys(expected.tokens).filter((p) => !sameJson(expected.tokens[p], state.snapshot.tokens[p])),
    ...Object.keys(expected.styles).filter((k) => !sameJson(expected.styles[k], state.snapshot.styles[k])),
  ];
  const incomplete = failures.length > 0 || drift.length > 0;
  const fileFresh = Object.keys(state.snapshot.tokens).filter((p) => !before.snapshot.tokens[p]);
  const goneNow = Object.keys(before.snapshot.tokens).filter((p) => !state.snapshot.tokens[p]);
  const replaced = pairRenames(before.snapshot.tokens, state.snapshot.tokens, goneNow, fileFresh);
  const link: DtcgLink = {
    ...opts.link,
    snapshotHash: hash(state.snapshot as never),
    syncedAt: new Date().toISOString(),
    /* The fonts that stood in, said under Notes until the right one is installed. */
    fonts: fontNotes.length ? fontNotes : null,
    incomplete: incomplete ? { at: new Date().toISOString(), issues: [...failures, ...drift.filter((p) => !failures.some((f) => f.path === p)).map((p) => ({ level: "error" as const, path: p, message: `${p} isn't in the file as the repository has it.` }))] } : null,
  };
  setData(api.root, DKEYS.link, JSON.stringify(link));
  (api as { commitUndo?: () => void }).commitUndo?.();
  onProgress({ done: total, total, label: "Done" });
  return { created, updated, adopted, issues, drift, removed: state.removed, replaced, refusedCollections, rootRenamed, incomplete, link, state };
}

/** The plan's snapshot as the file should hold it: without what Figma refused, each token in the collection it lives in. */
function plannedSnapshot(plan: Plan, refused: string[], homeOf: Map<string, string>, valuesOf: Map<string, Record<string, PlannedValue>>): DtcgSnapshot {
  const tokens: DtcgSnapshot["tokens"] = {};
  for (const v of plan.variables) {
    if (refused.includes(v.collection)) continue;
    tokens[v.path] = { collection: homeOf.get(v.path) ?? v.collection, type: v.type, values: Object.fromEntries(Object.entries(valuesOf.get(v.path) ?? v.values).map(([k, x]) => [k, snapValue(x)])) };
  }
  const styles: DtcgSnapshot["styles"] = {};
  for (const [id, s] of Object.entries(plan.snapshot.styles)) {
    if (Object.values(s.bound).every((p) => tokens[p])) styles[id] = s;
  }
  return { tokens, styles };
}

/**
 * A collection's modes by key: by the keys the plugin stored, then by name
 * (never by position), then added. When Figma refuses a mode (its plan's
 * limit), the modes added here are taken back and the collection is refused.
 */
function ensureModes(c: VariableCollection, pc: PlannedCollection, isNew: boolean): { modes: Record<string, string> } | { error: string } {
  const found: Record<string, string> = Object.fromEntries(modesOf(c));
  if (isNew) found[pc.modes[0].key] = c.defaultModeId;
  for (const p of pc.modes) {
    if (found[p.key]) continue;
    const m = c.modes.find((x) => norm(x.name) === norm(p.name) && !Object.values(found).includes(x.modeId));
    if (m) found[p.key] = m.modeId;
  }
  const added: string[] = [];
  for (const p of pc.modes) {
    if (found[p.key]) continue;
    try {
      found[p.key] = c.addMode(p.name);
      added.push(found[p.key]);
    } catch (e) {
      const limit = c.modes.length;
      for (const id of added) {
        try {
          c.removeMode(id);
        } catch {
          /* left; the error below says what happened */
        }
      }
      const axes = pc.axes.length ? pc.axes.join(" × ") : pc.name;
      return { error: `${axes} needs ${pc.modes.length} modes; this Figma plan allows ${limit}. ${pc.name} was left as it was (${(e as Error).message}).` };
    }
  }
  for (const p of pc.modes) {
    const mode = c.modes.find((m) => m.modeId === found[p.key]);
    if (mode && mode.name !== p.name) c.renameMode(mode.modeId, p.name);
  }
  const stale = c.modes.filter((m) => !pc.modes.some((p) => found[p.key] === m.modeId)).map((m) => m.modeId);
  setData(c, `${DKEYS.removed}Modes`, stale.length ? JSON.stringify(stale) : "");
  setData(c, DKEYS.modes, JSON.stringify(Object.fromEntries(pc.modes.map((p) => [found[p.key], p.key]))));
  return { modes: found };
}

function toFigma(api: PluginAPI, value: PlannedValue, varOf: Map<string, Variable>): VariableValue | null {
  if ("literal" in value) return value.literal as VariableValue;
  const target = varOf.get(value.alias);
  return target ? api.variables.createVariableAlias(target) : null;
}

/** Deletes what the designer confirmed, of what the repository no longer has. */
export async function deleteRemoved(api: PluginAPI, ids: string[]): Promise<{ deleted: number }> {
  const want = new Set(ids);
  let deleted = 0;
  for (const v of await api.variables.getLocalVariablesAsync()) {
    if (want.has(v.id) && getData(v, DKEYS.removed)) {
      v.remove();
      deleted++;
    }
  }
  for (const s of [...(await api.getLocalTextStylesAsync()), ...(await api.getLocalEffectStylesAsync())]) {
    if (want.has(s.id) && getData(s, DKEYS.removed)) {
      s.remove();
      deleted++;
    }
  }
  for (const c of await api.variables.getLocalVariableCollectionsAsync()) {
    if (want.has(c.id) && getData(c, DKEYS.removed)) {
      c.remove();
      deleted++;
      continue;
    }
    const stale = getJson<string[]>(c, `${DKEYS.removed}Modes`) ?? [];
    const keep = stale.filter((m) => !want.has(`${c.id}:${m}`));
    for (const m of stale) {
      if (keep.includes(m)) continue;
      c.removeMode(m);
      deleted++;
    }
    if (keep.length !== stale.length) setData(c, `${DKEYS.removed}Modes`, keep.length ? JSON.stringify(keep) : "");
  }
  (api as { commitUndo?: () => void }).commitUndo?.();
  return { deleted };
}
