/* An in-memory stand-in for the slice of the Figma Plugin API the plugin
   uses, strict where Figma is strict (alias types, mode ids, unloaded fonts),
   so the tests fail where Figma would throw. */

type Data = Map<string, string>;

function pluginData(store: Data) {
  return {
    getSharedPluginData: (ns: string, key: string) => store.get(`${ns}:${key}`) ?? "",
    getSharedPluginDataKeys: (ns: string) => [...store.keys()].filter((k) => k.startsWith(`${ns}:`)).map((k) => k.slice(ns.length + 1)),
    setSharedPluginData: (ns: string, key: string, value: string) => {
      if (value) store.set(`${ns}:${key}`, value);
      else store.delete(`${ns}:${key}`);
    },
  };
}

let seq = 0;
const nextId = (p: string) => `${p}:${++seq}`;

class FakeCollection {
  id = nextId("VariableCollectionId");
  key = nextId("collectionKey");
  modes: { modeId: string; name: string }[] = [{ modeId: nextId("mode"), name: "Mode 1" }];
  hiddenFromPublishing = false;
  private data: Data = new Map();
  getSharedPluginData = pluginData(this.data).getSharedPluginData;
  getSharedPluginDataKeys = pluginData(this.data).getSharedPluginDataKeys;
  setSharedPluginData = pluginData(this.data).setSharedPluginData;
  constructor(public name: string, public modeLimit: number) {}
  get defaultModeId() {
    return this.modes[0].modeId;
  }
  renameMode(modeId: string, name: string) {
    const m = this.modes.find((x) => x.modeId === modeId);
    if (!m) throw new Error("in renameMode: mode not found");
    m.name = name;
  }
  removeMode(modeId: string) {
    if (this.modes.length <= 1) throw new Error("in removeMode: a collection needs a mode");
    this.modes = this.modes.filter((m) => m.modeId !== modeId);
  }
  /** Set by the fake: removing a collection removes it from the file. */
  onRemove: () => void = () => {};
  remove() {
    this.onRemove();
  }
  addMode(name: string) {
    if (this.modes.length >= this.modeLimit) throw new Error(`in addMode: Limited to ${this.modeLimit} modes only`);
    const modeId = nextId("mode");
    this.modes.push({ modeId, name });
    return modeId;
  }
}

const SCALAR: Record<string, string> = { FLOAT: "number", STRING: "string", BOOLEAN: "boolean" };

class FakeVariable {
  id = nextId("VariableID");
  key = nextId("vkey");
  description = "";
  hiddenFromPublishing = false;
  codeSyntax: Record<string, string> = {};
  valuesByMode: Record<string, unknown> = {};
  private _scopes: string[] = ["ALL_SCOPES"];
  private data: Data = new Map();
  getSharedPluginData = pluginData(this.data).getSharedPluginData;
  getSharedPluginDataKeys = pluginData(this.data).getSharedPluginDataKeys;
  setSharedPluginData = pluginData(this.data).setSharedPluginData;
  constructor(public name: string, public variableCollectionId: string, public resolvedType: string, private fig: FakeFigma) {}
  remove() {
    this.fig.variables = this.fig.variables.filter((v) => v !== (this as unknown));
  }
  /** A write the test makes fail, as Figma would (a value it refuses). */
  failWrites = false;
  get scopes() {
    return this._scopes;
  }
  set scopes(s: string[]) {
    if (s.includes("ALL_SCOPES") && s.length > 1) throw new Error("ALL_SCOPES can't be combined with other scopes");
    this._scopes = [...s];
  }
  resolveForConsumer() {
    return { value: this.fig.resolve(this as never), resolvedType: this.resolvedType };
  }
  setVariableCodeSyntax(platform: string, value: string) {
    this.codeSyntax[platform] = value;
  }
  setValueForMode(modeId: string, value: unknown) {
    if (this.failWrites || this.fig.failValuesOf.has(this.name)) throw new Error("in setValueForMode: refused by the test");
    const c = this.fig.collections.find((x) => x.id === this.variableCollectionId)!;
    if (!c.modes.some((m) => m.modeId === modeId)) throw new Error(`in setValueForMode: invalid mode ${modeId}`);
    if (value && typeof value === "object" && (value as { type?: string }).type === "VARIABLE_ALIAS") {
      const target = this.fig.variables.find((v) => v.id === (value as { id: string }).id);
      if (!target) throw new Error("in setValueForMode: alias target not found");
      if (target.resolvedType !== this.resolvedType) throw new Error(`in setValueForMode: can't alias a ${this.resolvedType} to a ${target.resolvedType}`);
    } else if (this.resolvedType === "COLOR") {
      const c = value as { r?: number };
      if (!c || typeof c !== "object" || typeof c.r !== "number") throw new Error("in setValueForMode: expected a color");
    } else if (typeof value !== SCALAR[this.resolvedType]) {
      throw new Error(`in setValueForMode: expected a ${SCALAR[this.resolvedType]}, got ${typeof value}`);
    }
    this.valuesByMode[modeId] = value;
  }
}

const TEXT_FIELD_TYPES: Record<string, string> = { fontFamily: "STRING", fontStyle: "STRING", fontWeight: "FLOAT", fontSize: "FLOAT", lineHeight: "FLOAT", letterSpacing: "FLOAT" };

class FakeTextStyle {
  id = nextId("S");
  key = nextId("skey");
  type = "TEXT";
  name = "";
  fontSize = 12;
  lineHeight: unknown = { unit: "AUTO" };
  letterSpacing: unknown = { unit: "PERCENT", value: 0 };
  boundVariables: Record<string, { type: "VARIABLE_ALIAS"; id: string }> = {};
  private _font = { family: "Inter", style: "Regular" };
  private data: Data = new Map();
  getSharedPluginData = pluginData(this.data).getSharedPluginData;
  getSharedPluginDataKeys = pluginData(this.data).getSharedPluginDataKeys;
  setSharedPluginData = pluginData(this.data).setSharedPluginData;
  constructor(private fig: FakeFigma) {}
  get fontName() {
    return this._font;
  }
  set fontName(f: { family: string; style: string }) {
    if (!this.fig.loaded.has(`${f.family}|${f.style}`)) throw new Error(`Cannot write to node with unloaded font "${f.family} ${f.style}"`);
    this._font = f;
  }
  setBoundVariable(field: string, variable: FakeVariable) {
    if (TEXT_FIELD_TYPES[field] !== variable.resolvedType) throw new Error(`can't bind a ${variable.resolvedType} variable to ${field}`);
    this.boundVariables[field] = { type: "VARIABLE_ALIAS", id: variable.id };
  }
  remove() {
    this.fig.textStyles = this.fig.textStyles.filter((s) => s !== this);
  }
}

class FakeEffectStyle {
  id = nextId("S");
  key = nextId("skey");
  type = "EFFECT";
  name = "";
  effects: unknown[] = [];
  remove() {
    this.fig.effectStyles = this.fig.effectStyles.filter((s) => s !== this);
  }
  constructor(private fig: FakeFigma) {}
  private data: Data = new Map();
  getSharedPluginData = pluginData(this.data).getSharedPluginData;
  getSharedPluginDataKeys = pluginData(this.data).getSharedPluginDataKeys;
  setSharedPluginData = pluginData(this.data).setSharedPluginData;
}

/** The document: a name and its shared plugin data. */
class FakeRoot {
  private data: Data = new Map();
  getSharedPluginData = pluginData(this.data).getSharedPluginData;
  getSharedPluginDataKeys = pluginData(this.data).getSharedPluginDataKeys;
  setSharedPluginData = pluginData(this.data).setSharedPluginData;
  constructor(public name: string) {}
}

export class FakeFigma {
  collections: FakeCollection[] = [];
  variables: FakeVariable[] = [];
  textStyles: FakeTextStyle[] = [];
  effectStyles: FakeEffectStyle[] = [];
  loaded = new Set<string>();
  root: FakeRoot;
  /** Figma's client storage: per computer, shared by every file. */
  storage = new Map<string, unknown>();

  /** How many times the plugin closed an undo step. */
  undoSteps = 0;
  /** Variables (by name) whose values the test makes Figma refuse. */
  failValuesOf = new Set<string>();

  constructor(private opts: { fonts?: { family: string; style: string }[]; modeLimit?: number; name?: string } = {}) {
    this.root = new FakeRoot(opts.name ?? "Untitled");
  }

  /** The value a variable resolves to (its default mode, aliases followed). */
  resolve(v: FakeVariable): unknown {
    const c = this.collections.find((x) => x.id === v.variableCollectionId);
    const raw = c ? v.valuesByMode[c.defaultModeId] : Object.values(v.valuesByMode)[0];
    if (raw && typeof raw === "object" && (raw as { type?: string }).type === "VARIABLE_ALIAS") {
      const t = this.variableById((raw as { id: string }).id);
      return t ? this.resolve(t) : undefined;
    }
    return raw;
  }
  variableById(id: string): FakeVariable | undefined {
    return this.variables.find((v) => v.id === id);
  }

  variablesApi = {
    getLocalVariableCollectionsAsync: async () => [...this.collections],
    getLocalVariablesAsync: async () => [...this.variables],
    createVariableCollection: (name: string) => {
      const c = new FakeCollection(name, this.opts.modeLimit ?? 20);
      c.onRemove = () => {
        this.collections = this.collections.filter((x) => x !== c);
        this.variables = this.variables.filter((v) => v.variableCollectionId !== c.id);
      };
      this.collections.push(c);
      return c;
    },
    createVariable: (name: string, collection: FakeCollection, type: string) => {
      if (typeof collection === "string") throw new Error("pass a collection object");
      if (this.variables.some((v) => v.variableCollectionId === collection.id && v.name === name)) throw new Error(`in createVariable: duplicate variable name "${name}"`);
      const v = new FakeVariable(name, collection.id, type, this);
      this.variables.push(v);
      return v;
    },
    createVariableAlias: (variable: FakeVariable) => ({ type: "VARIABLE_ALIAS" as const, id: variable.id }),
    getVariableByIdAsync: async (id: string) => this.variableById(id) ?? null,
    setBoundVariableForEffect: (effect: Record<string, unknown>, field: string, variable: FakeVariable) => {
      const expected = field === "color" ? "COLOR" : "FLOAT";
      if (variable.resolvedType !== expected) throw new Error(`can't bind a ${variable.resolvedType} to ${field}`);
      return { ...effect, boundVariables: { ...((effect.boundVariables as object) ?? {}), [field]: { type: "VARIABLE_ALIAS", id: variable.id } } };
    },
  };

  /** The object handed to the plugin as `figma`. */
  get api(): PluginAPI {
    return {
      root: this.root,
      variables: this.variablesApi,
      getLocalTextStylesAsync: async () => [...this.textStyles],
      getLocalEffectStylesAsync: async () => [...this.effectStyles],
      moveLocalTextStyleAfter: (target: FakeTextStyle, reference: FakeTextStyle | null) => {
        this.textStyles.splice(this.textStyles.indexOf(target), 1);
        this.textStyles.splice(reference ? this.textStyles.indexOf(reference) + 1 : 0, 0, target);
      },
      createTextStyle: () => {
        const s = new FakeTextStyle(this);
        this.textStyles.push(s);
        return s;
      },
      createEffectStyle: () => {
        const s = new FakeEffectStyle(this);
        this.effectStyles.push(s);
        return s;
      },
      listAvailableFontsAsync: async () => (this.opts.fonts ?? INTER).map((fontName) => ({ fontName })),
      notify: () => {},
      commitUndo: () => {
        this.undoSteps++;
      },
      loadFontAsync: async (f: { family: string; style: string }) => {
        const fonts = this.opts.fonts ?? INTER;
        if (!fonts.some((x) => x.family === f.family && x.style === f.style)) throw new Error(`The font "${f.family} ${f.style}" could not be loaded`);
        this.loaded.add(`${f.family}|${f.style}`);
      },
      clientStorage: {
        getAsync: async (k: string) => this.storage.get(k),
        setAsync: async (k: string, v: unknown) => void this.storage.set(k, v),
        deleteAsync: async (k: string) => void this.storage.delete(k),
      },
    } as unknown as PluginAPI;
  }

  variable(name: string) {
    return this.variables.find((v) => v.name === name)!;
  }
  collection(name: string) {
    return this.collections.find((c) => c.name === name)!;
  }
}

export const INTER = ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black", "Italic"].map((style) => ({ family: "Inter", style }));
