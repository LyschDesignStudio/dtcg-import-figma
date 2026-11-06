(function() {
	// src/figma/identity.ts
	var NS = "dtcg_import";
	var KEYS = {
		/** figma.root: the file's link to its repository. */
		link: "link",
		/** a variable collection: the planned collection's key. */
		collection: "collection",
		/** a variable: { v: 1, path } */
		token: "token",
		/** a variable collection: { [modeId]: mode key } */
		modes: "modes",
		/** a text or effect style: its id (the token's or the group's path) */
		style: "style",
		/** a variable, style, collection or mode list the repository no longer has: "1" */
		removed: "removed"
	};
	var getData = (node, key) => node.getSharedPluginData(NS, key);
	var setData = (node, key, value) => node.setSharedPluginData(NS, key, value);
	function getJson(node, key) {
		const raw = getData(node, key);
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch (_unused) {
			return null;
		}
	}
	// src/shared/stable.ts
	var HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
	/** Lowercase #rrggbb, or #rrggbbaa when not opaque. Null when it isn't a hex color. */
	function normalizeHex(value) {
		const m = value.trim().match(HEX_RE);
		if (!m) return null;
		let hex = m[1].toLowerCase();
		if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
		if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
		return `#${hex}`;
	}
	/** Figma stores numbers as float32 (0.8 comes back as 0.800000011920929): four decimals is the precision that survives. */
	var normalizeNumber = (n) => Math.round(n * 1e4) / 1e4 + 0;
	function stableStringify(value) {
		if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
		if (value && typeof value === "object") return `{${Object.keys(value).sort().filter((k) => value[k] !== void 0).map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
		return JSON.stringify(value);
	}
	/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic; a change detector. */
	function cyrb53(str) {
		let h1 = 3735928559;
		let h2 = 1103547991;
		for (let i = 0; i < str.length; i++) {
			const ch = str.charCodeAt(i);
			h1 = Math.imul(h1 ^ ch, 2654435761);
			h2 = Math.imul(h2 ^ ch, 1597334677);
		}
		h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
		h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
		return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
	}
	/** The hash of any JSON value, independent of key order. */
	var hash = (value) => cyrb53(stableStringify(value));
	// \0@oxc-project+runtime@0.156.0/helpers/esm/typeof.js
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/toPrimitive.js
	function toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/toPropertyKey.js
	function toPropertyKey(t) {
		var i = toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/defineProperty.js
	function _defineProperty(e, r, t) {
		return (r = toPropertyKey(r)) in e ? Object.defineProperty(e, r, {
			value: t,
			enumerable: !0,
			configurable: !0,
			writable: !0
		}) : e[r] = t, e;
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/objectSpread2.js
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r) {
				return Object.getOwnPropertyDescriptor(e, r).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread2(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
				_defineProperty(e, r, t[r]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
				Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
			});
		}
		return e;
	}
	// src/color.ts
	/** Lowercase #rrggbb, or #rrggbbaa when not opaque: the snapshot's form.
	Each channel is first taken to 32 bits, as Figma stores it: an alpha of 0.7 is 178.5 of 255 and rounds up, but Figma's
	0.69999999 rounds down, and the file would never match the repository. Both sides go through here, so both round alike. */
	function rgbaHex({ r, g, b, a = 1 }) {
		const byte = (v) => Math.max(0, Math.min(255, Math.round(Math.fround(v) * 255))).toString(16).padStart(2, "0");
		return normalizeHex(`#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`);
	}
	// src/tokens.ts
	/** A Figma literal in the snapshot's form: colors as hex, numbers rounded to what Figma keeps. */
	function snapLiteral(v) {
		if (typeof v === "object") return rgbaHex(v);
		if (typeof v === "number") return normalizeNumber(v);
		return v;
	}
	// src/plan.ts
	function snapValue(v) {
		return "alias" in v ? { alias: v.alias } : { literal: snapLiteral(v.literal) };
	}
	// src/apply.ts
	/** The marks this file's code sets, by role. */
	var DKEYS = {
		link: KEYS.link,
		token: KEYS.token,
		modes: KEYS.modes,
		style: KEYS.style,
		removed: KEYS.removed
	};
	var isDtcgCollection = (c) => getData(c, KEYS.collection).startsWith("dtcg:");
	var CHUNK = 50;
	var tick = () => new Promise((r) => setTimeout(r, 0));
	var closeColor = (a, b) => [
		"r",
		"g",
		"b",
		"a"
	].every((k) => {
		var _a$k, _b$k;
		return Math.abs(((_a$k = a[k]) !== null && _a$k !== void 0 ? _a$k : 1) - ((_b$k = b[k]) !== null && _b$k !== void 0 ? _b$k : 1)) < 1 / 512;
	});
	function sameValue(current, next) {
		if (current === void 0) return false;
		if (typeof next === "object" && typeof current === "object") {
			if ("type" in next && next.type === "VARIABLE_ALIAS") return "type" in current && current.type === "VARIABLE_ALIAS" && current.id === next.id;
			if ("r" in next && "r" in current) return closeColor(current, next);
			return false;
		}
		if (typeof next === "number" && typeof current === "number") return Math.abs(next - current) < 1e-4;
		return current === next;
	}
	var isAlias = (v) => !!v && typeof v === "object" && v.type === "VARIABLE_ALIAS";
	var norm = (s) => s.trim().toLowerCase();
	/** Figma has it in every weight, everywhere: the font that stands in for one this Figma lacks. */
	var STAND_IN = "Inter";
	var STYLE_WEIGHTS = [
		[/^(thin|hairline)$/, 100],
		[/^(extra|ultra)light$/, 200],
		[/^light$/, 300],
		[/^(regular|normal|book|roman)$/, 400],
		[/^medium$/, 500],
		[/^(semi|demi)bold$/, 600],
		[/^bold$/, 700],
		[/^(extra|ultra)bold$/, 800],
		[/^(black|heavy)$/, 900]
	];
	function styleWeight(style) {
		var _STYLE_WEIGHTS$find$, _STYLE_WEIGHTS$find;
		const s = style.toLowerCase().replace(/[\s_-]/g, "");
		if (/italic|oblique/.test(s)) return null;
		return (_STYLE_WEIGHTS$find$ = (_STYLE_WEIGHTS$find = STYLE_WEIGHTS.find(([re]) => re.test(s))) === null || _STYLE_WEIGHTS$find === void 0 ? void 0 : _STYLE_WEIGHTS$find[1]) !== null && _STYLE_WEIGHTS$find$ !== void 0 ? _STYLE_WEIGHTS$find$ : null;
	}
	function fontIndex(fonts) {
		const byFamily = /* @__PURE__ */ new Map();
		for (const { fontName } of fonts) {
			var _byFamily$get;
			const weight = styleWeight(fontName.style);
			if (weight === null) continue;
			byFamily.set(fontName.family, [...(_byFamily$get = byFamily.get(fontName.family)) !== null && _byFamily$get !== void 0 ? _byFamily$get : [], {
				style: fontName.style,
				weight
			}]);
		}
		return byFamily;
	}
	function modesOf(c) {
		var _getJson;
		const stored = (_getJson = getJson(c, DKEYS.modes)) !== null && _getJson !== void 0 ? _getJson : {};
		const byKey = /* @__PURE__ */ new Map();
		for (const m of c.modes) {
			const key = stored[m.modeId];
			if (key && !byKey.has(key)) byKey.set(key, m.modeId);
		}
		return byKey;
	}
	var metaOf = (v) => getJson(v, DKEYS.token);
	async function readDtcg(api, plannedCollections) {
		const own = (await api.variables.getLocalVariableCollectionsAsync()).filter(isDtcgCollection);
		const byId = new Map(own.map((c) => [c.id, c]));
		const variables = (await api.variables.getLocalVariablesAsync()).filter((v) => byId.has(v.variableCollectionId));
		const pathOf = /* @__PURE__ */ new Map();
		for (const v of variables) {
			const m = metaOf(v);
			if (m && !getData(v, DKEYS.removed)) pathOf.set(v.id, m.path);
		}
		const removed = [];
		const added = [];
		const misplaced = [];
		const tokens = {};
		for (const v of variables) {
			const c = byId.get(v.variableCollectionId);
			const m = metaOf(v);
			if (!m) {
				added.push({
					id: v.id,
					name: v.name,
					collection: c.name
				});
				continue;
			}
			if (getData(v, DKEYS.removed)) {
				removed.push({
					kind: "variable",
					id: v.id,
					name: v.name,
					path: m.path,
					of: c.name
				});
				continue;
			}
			const values = {};
			for (const [key, modeId] of modesOf(c)) {
				var _pathOf$get;
				const raw = v.valuesByMode[modeId];
				if (raw === void 0) continue;
				if (isAlias(raw)) values[key] = { alias: (_pathOf$get = pathOf.get(raw.id)) !== null && _pathOf$get !== void 0 ? _pathOf$get : `?${raw.id}` };
				else if (v.resolvedType === "COLOR") values[key] = { literal: rgbaHex(raw) };
				else if (typeof raw === "number") values[key] = { literal: Math.round(raw * 1e4) / 1e4 + 0 };
				else values[key] = { literal: raw };
			}
			const key = getData(c, KEYS.collection);
			tokens[m.path] = {
				collection: key,
				type: v.resolvedType,
				values
			};
			const belongs = plannedCollections === null || plannedCollections === void 0 ? void 0 : plannedCollections.get(m.path);
			if (belongs && belongs !== key) misplaced.push({
				path: m.path,
				in: c.name,
				belongs
			});
		}
		for (const c of own) {
			var _getJson2;
			if (getData(c, DKEYS.removed)) removed.push({
				kind: "collection",
				id: c.id,
				name: c.name
			});
			const stale = (_getJson2 = getJson(c, `${DKEYS.removed}Modes`)) !== null && _getJson2 !== void 0 ? _getJson2 : [];
			for (const modeId of stale) {
				const mode = c.modes.find((m) => m.modeId === modeId);
				if (mode) removed.push({
					kind: "mode",
					id: `${c.id}:${modeId}`,
					name: mode.name,
					of: c.name
				});
			}
		}
		const styles = {};
		const texts = (await api.getLocalTextStylesAsync()).filter((s) => getData(s, DKEYS.style));
		for (const s of texts) {
			const id = getData(s, DKEYS.style);
			if (getData(s, DKEYS.removed)) {
				removed.push({
					kind: "text",
					id: s.id,
					name: s.name,
					path: id
				});
				continue;
			}
			const bound = {};
			for (const f of [
				"fontSize",
				"fontWeight",
				"lineHeight",
				"letterSpacing"
			]) {
				var _s$boundVariables;
				const a = (_s$boundVariables = s.boundVariables) === null || _s$boundVariables === void 0 ? void 0 : _s$boundVariables[f];
				if (a && pathOf.has(a.id)) bound[f] = pathOf.get(a.id);
			}
			styles[id] = {
				kind: "text",
				name: s.name,
				bound
			};
		}
		const effects = (await api.getLocalEffectStylesAsync()).filter((s) => getData(s, DKEYS.style));
		for (const s of effects) {
			const id = getData(s, DKEYS.style);
			if (getData(s, DKEYS.removed)) {
				removed.push({
					kind: "effect",
					id: s.id,
					name: s.name,
					path: id
				});
				continue;
			}
			const bound = {};
			s.effects.forEach((e, i) => {
				var _e$boundVariables;
				const b = (_e$boundVariables = e.boundVariables) !== null && _e$boundVariables !== void 0 ? _e$boundVariables : {};
				for (const [field, name] of Object.entries({
					color: "color",
					offsetX: "x",
					offsetY: "y",
					radius: "blur",
					spread: "spread"
				})) if (b[field] && pathOf.has(b[field].id)) bound[`${i}.${name}`] = pathOf.get(b[field].id);
			});
			styles[id] = {
				kind: "effect",
				name: s.name,
				bound
			};
		}
		return {
			snapshot: {
				tokens,
				styles
			},
			link: getJson(api.root, DKEYS.link),
			removed,
			added,
			misplaced,
			counts: {
				variables: pathOf.size,
				textStyles: texts.length,
				effectStyles: effects.length
			}
		};
	}
	async function adoptionOf(api, plan) {
		const all = await api.variables.getLocalVariableCollectionsAsync();
		const names = new Set(plan.collections.map((c) => norm(c.name)));
		const unowned = all.filter((c) => !getData(c, KEYS.collection) && names.has(norm(c.name)));
		const ids = new Set(unowned.map((c) => c.id));
		const planned = new Set(plan.variables.map((v) => v.name));
		const variables = (await api.variables.getLocalVariablesAsync()).filter((v) => ids.has(v.variableCollectionId) && planned.has(v.name)).length;
		const styleNames = new Set([...plan.textStyles, ...plan.effectStyles].map((s) => s.name));
		const styles = [...await api.getLocalTextStylesAsync(), ...await api.getLocalEffectStylesAsync()].filter((s) => !getData(s, DKEYS.style) && !getData(s, KEYS.style) && styleNames.has(s.name)).map((s) => s.name);
		let tokensStudio = false;
		try {
			var _api$root$getSharedPl, _api$root$getSharedPl2, _api$root;
			tokensStudio = ((_api$root$getSharedPl = (_api$root$getSharedPl2 = (_api$root = api.root).getSharedPluginDataKeys) === null || _api$root$getSharedPl2 === void 0 ? void 0 : _api$root$getSharedPl2.call(_api$root, "tokens")) !== null && _api$root$getSharedPl !== void 0 ? _api$root$getSharedPl : []).length > 0;
		} catch (_unused) {}
		return {
			collections: unowned.map((c) => c.name),
			variables,
			styles,
			tokensStudio
		};
	}
	var sameJson = (a, b) => stableStringify(a) === stableStringify(b);
	/** Old → new: a token gone and one new, with the same type and the same value in every mode. */
	function pairRenames(before, after, gone, fresh) {
		const out = [];
		const left = new Set(fresh);
		for (const from of gone) {
			const a = before[from];
			const matches = [...left].filter((to) => after[to].type === a.type && sameJson(after[to].values, a.values));
			if (matches.length === 1) {
				out.push({
					from,
					to: matches[0]
				});
				left.delete(matches[0]);
			}
		}
		return out;
	}
	async function previewOf(api, plan) {
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
			styles: {
				created: Object.keys(ws).filter((k) => !hs[k]).length,
				changed: Object.keys(ws).filter((k) => hs[k] && !sameJson(hs[k], ws[k])).length,
				removed: Object.keys(hs).filter((k) => !ws[k])
			},
			collections: { created: plan.collections.filter((c) => !owned.has(c.key)).map((c) => c.name) }
		};
	}
	async function applyDtcg(api, plan, opts, onProgress = () => {}) {
		var _api$commitUndo, _opts$figmaRefs$varia, _opts$figmaRefs2, _api$commitUndo2;
		const issues = [...plan.issues];
		const failures = [];
		const fail = (i) => {
			issues.push(i);
			if (i.level === "error") failures.push(i);
		};
		const created = {
			variables: 0,
			textStyles: 0,
			effectStyles: 0
		};
		const updated = {
			variables: 0,
			textStyles: 0,
			effectStyles: 0
		};
		let adopted = 0;
		const refusedCollections = [];
		const rootRenamed = [];
		const total = plan.variables.length * 2 + plan.textStyles.length + plan.effectStyles.length + 1;
		let done = 0;
		const step = async (label) => {
			done++;
			if (done % CHUNK === 0) {
				onProgress({
					done,
					total,
					label
				});
				await tick();
			}
		};
		const before = await readDtcg(api);
		(_api$commitUndo = api.commitUndo) === null || _api$commitUndo === void 0 || _api$commitUndo.call(api);
		onProgress({
			done: 0,
			total,
			label: "Collections"
		});
		const existing = await api.variables.getLocalVariableCollectionsAsync();
		const collections = /* @__PURE__ */ new Map();
		const modes = /* @__PURE__ */ new Map();
		for (const pc of plan.collections) {
			let c = existing.find((x) => getData(x, KEYS.collection) === pc.key);
			let isNew = false;
			if (!c && opts.adopt) {
				var _opts$figmaRefs;
				const ref = (_opts$figmaRefs = opts.figmaRefs) === null || _opts$figmaRefs === void 0 || (_opts$figmaRefs = _opts$figmaRefs.collections.find((r) => r.collectionId && pc.axes.includes(r.axis))) === null || _opts$figmaRefs === void 0 ? void 0 : _opts$figmaRefs.collectionId;
				c = existing.find((x) => !getData(x, KEYS.collection) && (x.id === ref || norm(x.name) === norm(pc.name)));
				if (c) {
					adopted++;
					issues.push({
						level: "warning",
						message: `Adopted the existing "${c.name}" collection.`
					});
				}
			}
			if (!c) {
				try {
					c = api.variables.createVariableCollection(pc.name);
				} catch (e) {
					fail({
						level: "error",
						message: `Couldn't create the ${pc.name} collection: ${e.message}`
					});
					refusedCollections.push(pc.key);
					continue;
				}
				isNew = true;
			}
			const found = ensureModes(c, pc, isNew);
			if ("error" in found) {
				fail({
					level: "error",
					message: found.error
				});
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
		for (const c of existing) if (isDtcgCollection(c) && !plan.collections.some((p) => p.key === getData(c, KEYS.collection)) && !getData(c, DKEYS.removed)) setData(c, DKEYS.removed, "1");
		const keyOf = new Map([...collections].map(([k, c]) => [c.id, k]));
		const ownIds = new Set(existing.filter(isDtcgCollection).map((c) => c.id).concat([...collections.values()].map((c) => c.id)));
		const locals = await api.variables.getLocalVariablesAsync();
		const byPath = /* @__PURE__ */ new Map();
		const unclaimed = /* @__PURE__ */ new Map();
		for (const v of locals) {
			if (!ownIds.has(v.variableCollectionId)) continue;
			const m = metaOf(v);
			if (m) byPath.set(m.path, v);
			else if (opts.adopt && keyOf.has(v.variableCollectionId)) unclaimed.set(`${keyOf.get(v.variableCollectionId)}|${v.name}`, v);
		}
		const refVar = (_opts$figmaRefs$varia = (_opts$figmaRefs2 = opts.figmaRefs) === null || _opts$figmaRefs2 === void 0 ? void 0 : _opts$figmaRefs2.variables) !== null && _opts$figmaRefs$varia !== void 0 ? _opts$figmaRefs$varia : {};
		const varOf = /* @__PURE__ */ new Map();
		/** The collection a variable's values go to: its own, which may not be the planned one (a token never moves). */
		const homeOf = /* @__PURE__ */ new Map();
		/** The values a variable gets, when they differ from the plan's (a token kept in another collection). */
		const valuesOf = /* @__PURE__ */ new Map();
		const fresh = /* @__PURE__ */ new Set();
		const touched = /* @__PURE__ */ new Set();
		for (const pv of plan.variables) {
			if (refusedCollections.includes(pv.collection)) {
				await step(pv.path);
				continue;
			}
			try {
				let v = byPath.get(pv.path);
				if (v && keyOf.get(v.variableCollectionId) !== pv.collection) {
					var _modes$get;
					const home = keyOf.get(v.variableCollectionId);
					const homeModes = home ? Object.keys((_modes$get = modes.get(home)) !== null && _modes$get !== void 0 ? _modes$get : {}) : [];
					const same = new Set(Object.values(pv.values).map((x) => stableStringify(x))).size === 1;
					if (home && !Object.keys(pv.values).every((k) => homeModes.includes(k)) && same) valuesOf.set(pv.path, Object.fromEntries(homeModes.map((k) => [k, Object.values(pv.values)[0]])));
					else if (!home || !Object.keys(pv.values).every((k) => homeModes.includes(k))) {
						fail({
							level: "error",
							path: pv.path,
							message: `${pv.name} is in another collection, whose modes don't match the ones it needs now. Delete it in Figma and import again.`
						});
						await step(pv.path);
						continue;
					}
				}
				if (!v && opts.adopt) {
					const byRef = refVar[pv.path] ? locals.find((x) => x.key === refVar[pv.path] && !metaOf(x)) : void 0;
					const k = `${pv.collection}|${pv.name}`;
					v = byRef !== null && byRef !== void 0 ? byRef : unclaimed.get(k);
					if (v) {
						unclaimed.delete(k);
						adopted++;
					}
				}
				if (!v) {
					const c = collections.get(pv.collection);
					try {
						v = api.variables.createVariable(pv.name, c, pv.type);
					} catch (e) {
						if (!plan.variables.some((o) => o.collection === pv.collection && o.name.startsWith(`${pv.name}/`))) throw e;
						v = api.variables.createVariable(`${pv.name}/root`, c, pv.type);
						rootRenamed.push(pv.path);
						issues.push({
							level: "warning",
							path: pv.path,
							message: `${pv.path} is named ${pv.name}/root in Figma: Figma refused a variable and a group with the same name.`
						});
					}
					fresh.add(pv.path);
					created.variables++;
					v.scopes = pv.scopes;
				}
				if (v.resolvedType !== pv.type) {
					fail({
						level: "error",
						path: pv.path,
						message: `${pv.name} is a ${v.resolvedType} variable in Figma and a ${pv.type} in the repository. Figma can't change a variable's type; delete it and import again.`
					});
					await step(pv.path);
					continue;
				}
				setData(v, DKEYS.token, JSON.stringify({
					v: 1,
					path: pv.path
				}));
				if (getData(v, DKEYS.removed)) setData(v, DKEYS.removed, "");
				const name = rootRenamed.includes(pv.path) ? `${pv.name}/root` : pv.name;
				if (v.name !== name && !fresh.has(pv.path)) try {
					v.name = name;
					touched.add(pv.path);
				} catch (e) {
					fail({
						level: "error",
						path: pv.path,
						message: `${pv.name}: couldn't rename it (${e.message}).`
					});
				}
				if (v.description !== pv.description) {
					v.description = pv.description;
					touched.add(pv.path);
				}
				varOf.set(pv.path, v);
				homeOf.set(pv.path, keyOf.get(v.variableCollectionId));
			} catch (e) {
				fail({
					level: "error",
					path: pv.path,
					message: `${pv.name}: ${e.message}`
				});
			}
			await step(pv.path);
		}
		for (const pv of plan.variables) {
			var _valuesOf$get;
			const v = varOf.get(pv.path);
			if (!v) {
				await step(pv.path);
				continue;
			}
			const ids = modes.get(homeOf.get(pv.path));
			for (const [mode, value] of Object.entries((_valuesOf$get = valuesOf.get(pv.path)) !== null && _valuesOf$get !== void 0 ? _valuesOf$get : pv.values)) {
				const modeId = ids[mode];
				if (!modeId) continue;
				const next = toFigma(api, value, varOf);
				if (next === null) {
					fail({
						level: "error",
						path: pv.path,
						message: `${pv.name} (${mode}) points at ${value.alias}, which isn't in Figma.`
					});
					continue;
				}
				if (sameValue(v.valuesByMode[modeId], next)) continue;
				try {
					v.setValueForMode(modeId, next);
					touched.add(pv.path);
				} catch (e) {
					fail({
						level: "error",
						path: pv.path,
						message: `${pv.name} (${mode}): ${e.message}`
					});
				}
			}
			await step(pv.path);
		}
		updated.variables = [...touched].filter((p) => !fresh.has(p)).length;
		const planned = new Set(plan.variables.map((v) => v.path));
		for (const [path, v] of byPath) if (!planned.has(path) && !getData(v, DKEYS.removed)) setData(v, DKEYS.removed, "1");
		const fonts = fontIndex(await api.listAvailableFontsAsync());
		const fontNotes = [];
		const weightsOf = /* @__PURE__ */ new Map();
		for (const ts of plan.textStyles) {
			var _weightsOf$get;
			const k = ts.family.value.join("|");
			weightsOf.set(k, ((_weightsOf$get = weightsOf.get(k)) !== null && _weightsOf$get !== void 0 ? _weightsOf$get : /* @__PURE__ */ new Set()).add(ts.weight.value));
		}
		const has = (f, w) => {
			var _fonts$get;
			return !!((_fonts$get = fonts.get(f)) === null || _fonts$get === void 0 ? void 0 : _fonts$get.some((x) => x.weight === w));
		};
		const standIn = (ts) => {
			var _candidates$find;
			const candidates = [...ts.family.value, STAND_IN];
			if (has(ts.family.value[0], ts.weight.value)) return ts.family.value[0];
			const all = [...weightsOf.get(ts.family.value.join("|"))];
			return (_candidates$find = candidates.find((f) => all.every((w) => has(f, w)))) !== null && _candidates$find !== void 0 ? _candidates$find : candidates.find((f) => has(f, ts.weight.value));
		};
		const texts = await api.getLocalTextStylesAsync();
		for (const ts of plan.textStyles) {
			try {
				await applyText(ts);
			} catch (e) {
				fail({
					level: "error",
					path: ts.id,
					message: `${ts.name}: ${e.message}`
				});
			}
			await step(ts.name);
		}
		if (api.moveLocalTextStyleAfter) {
			const mine = new Map((await api.getLocalTextStylesAsync()).map((x) => [getData(x, DKEYS.style), x]));
			let prev = null;
			for (const ts of plan.textStyles) {
				const st = mine.get(ts.id);
				if (!st) continue;
				try {
					api.moveLocalTextStyleAfter(st, prev);
				} catch (_unused2) {}
				prev = st;
			}
		}
		async function applyText(ts) {
			var _ts$size$path, _ts$size;
			const wanted = ts.family.value[0];
			const family = standIn(ts);
			if (!family) {
				fail({
					level: "error",
					path: ts.id,
					message: `${ts.name}: none of its fonts (${ts.family.value.join(", ")}) has weight ${ts.weight.value} in this Figma, nor ${STAND_IN}. Install ${wanted} and import again; the style was left as it was.`
				});
				return;
			}
			const pick = fonts.get(family).find((f) => f.weight === ts.weight.value);
			if (family !== wanted) {
				const missing = fonts.has(wanted) ? "weight" : "family";
				issues.push({
					level: "warning",
					path: ts.id,
					message: `${ts.name}: ${missing === "weight" ? `${wanted} has no weight ${ts.weight.value} in this Figma` : `${wanted} isn't in this Figma`}; ${family} stands in. Install ${wanted} and import again.`
				});
				fontNotes.push({
					style: ts.name,
					wanted,
					used: family,
					weight: ts.weight.value,
					missing
				});
			}
			let s = texts.find((x) => getData(x, DKEYS.style) === ts.id);
			if (!s && opts.adopt) {
				s = texts.find((x) => !getData(x, DKEYS.style) && !getData(x, KEYS.style) && x.name === ts.name);
				if (s) adopted++;
			}
			const font = {
				family,
				style: pick.style
			};
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
			if (ts.lineHeight) s.lineHeight = "percent" in ts.lineHeight ? {
				unit: "PERCENT",
				value: ts.lineHeight.percent
			} : {
				unit: "PIXELS",
				value: ts.lineHeight.value
			};
			if (ts.letterSpacing) s.letterSpacing = "percent" in ts.letterSpacing ? {
				unit: "PERCENT",
				value: ts.letterSpacing.percent
			} : {
				unit: "PIXELS",
				value: ts.letterSpacing.value
			};
			const bind = [
				["fontSize", (_ts$size$path = (_ts$size = ts.size) === null || _ts$size === void 0 ? void 0 : _ts$size.path) !== null && _ts$size$path !== void 0 ? _ts$size$path : null],
				["lineHeight", ts.lineHeight && "path" in ts.lineHeight ? ts.lineHeight.path : null],
				["letterSpacing", ts.letterSpacing && "path" in ts.letterSpacing ? ts.letterSpacing.path : null],
				["fontWeight", ts.weight.path],
				["fontFamily", family === ts.family.value[0] ? ts.family.path : null]
			];
			for (const [f, path] of bind) {
				const v = path ? varOf.get(path) : void 0;
				if (!v) continue;
				try {
					s.setBoundVariable(f, v);
				} catch (e) {
					fail({
						level: "error",
						path: ts.id,
						message: `${ts.name}: couldn't bind ${f} to ${path} (${e.message}).`
					});
				}
			}
		}
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
					let e = {
						type: l.inner ? "INNER_SHADOW" : "DROP_SHADOW",
						color: l.color.value,
						offset: {
							x: l.x.value,
							y: l.y.value
						},
						radius: l.blur.value,
						spread: l.spread.value,
						visible: true,
						blendMode: "NORMAL"
					};
					const fields = [
						["color", l.color.path],
						["offsetX", l.x.path],
						["offsetY", l.y.path],
						["radius", l.blur.path],
						["spread", l.spread.path]
					];
					for (const [f, path] of fields) {
						const v = path ? varOf.get(path) : void 0;
						if (!v) continue;
						try {
							e = api.variables.setBoundVariableForEffect(e, f, v);
						} catch (err) {
							fail({
								level: "error",
								path: es.id,
								message: `${es.name}: couldn't bind ${f} to ${path} (${err.message}).`
							});
						}
					}
					return e;
				});
			} catch (e) {
				fail({
					level: "error",
					path: es.id,
					message: `${es.name}: ${e.message}`
				});
			}
			await step(es.name);
		}
		const styleIds = new Set([...plan.textStyles, ...plan.effectStyles].map((s) => s.id));
		for (const s of [...texts, ...effects]) {
			const id = getData(s, DKEYS.style);
			if (id && !styleIds.has(id) && !getData(s, DKEYS.removed)) setData(s, DKEYS.removed, "1");
		}
		const state = await readDtcg(api, new Map(plan.variables.map((v) => [v.path, v.collection])));
		const expected = plannedSnapshot(plan, refusedCollections, homeOf, valuesOf);
		const drift = [...Object.keys(expected.tokens).filter((p) => !sameJson(expected.tokens[p], state.snapshot.tokens[p])), ...Object.keys(expected.styles).filter((k) => !sameJson(expected.styles[k], state.snapshot.styles[k]))];
		const incomplete = failures.length > 0 || drift.length > 0;
		const fileFresh = Object.keys(state.snapshot.tokens).filter((p) => !before.snapshot.tokens[p]);
		const goneNow = Object.keys(before.snapshot.tokens).filter((p) => !state.snapshot.tokens[p]);
		const replaced = pairRenames(before.snapshot.tokens, state.snapshot.tokens, goneNow, fileFresh);
		const link = _objectSpread2(_objectSpread2({}, opts.link), {}, {
			snapshotHash: hash(state.snapshot),
			syncedAt: (/* @__PURE__ */ new Date()).toISOString(),
			fonts: fontNotes.length ? fontNotes : null,
			incomplete: incomplete ? {
				at: (/* @__PURE__ */ new Date()).toISOString(),
				issues: [...failures, ...drift.filter((p) => !failures.some((f) => f.path === p)).map((p) => ({
					level: "error",
					path: p,
					message: `${p} isn't in the file as the repository has it.`
				}))]
			} : null
		});
		setData(api.root, DKEYS.link, JSON.stringify(link));
		(_api$commitUndo2 = api.commitUndo) === null || _api$commitUndo2 === void 0 || _api$commitUndo2.call(api);
		onProgress({
			done: total,
			total,
			label: "Done"
		});
		return {
			created,
			updated,
			adopted,
			issues,
			drift,
			removed: state.removed,
			replaced,
			refusedCollections,
			rootRenamed,
			incomplete,
			link,
			state
		};
	}
	/** The plan's snapshot as the file should hold it: without what Figma refused, each token in the collection it lives in. */
	function plannedSnapshot(plan, refused, homeOf, valuesOf) {
		const tokens = {};
		for (const v of plan.variables) {
			var _homeOf$get, _valuesOf$get2;
			if (refused.includes(v.collection)) continue;
			tokens[v.path] = {
				collection: (_homeOf$get = homeOf.get(v.path)) !== null && _homeOf$get !== void 0 ? _homeOf$get : v.collection,
				type: v.type,
				values: Object.fromEntries(Object.entries((_valuesOf$get2 = valuesOf.get(v.path)) !== null && _valuesOf$get2 !== void 0 ? _valuesOf$get2 : v.values).map(([k, x]) => [k, snapValue(x)]))
			};
		}
		const styles = {};
		for (const [id, s] of Object.entries(plan.snapshot.styles)) if (Object.values(s.bound).every((p) => tokens[p])) styles[id] = s;
		return {
			tokens,
			styles
		};
	}
	/**
	* A collection's modes by key: by the keys the plugin stored, then by name
	* (never by position), then added. When Figma refuses a mode (its plan's
	* limit), the modes added here are taken back and the collection is refused.
	*/
	function ensureModes(c, pc, isNew) {
		const found = Object.fromEntries(modesOf(c));
		if (isNew) found[pc.modes[0].key] = c.defaultModeId;
		for (const p of pc.modes) {
			if (found[p.key]) continue;
			const m = c.modes.find((x) => norm(x.name) === norm(p.name) && !Object.values(found).includes(x.modeId));
			if (m) found[p.key] = m.modeId;
		}
		const added = [];
		for (const p of pc.modes) {
			if (found[p.key]) continue;
			try {
				found[p.key] = c.addMode(p.name);
				added.push(found[p.key]);
			} catch (e) {
				const limit = c.modes.length;
				for (const id of added) try {
					c.removeMode(id);
				} catch (_unused3) {}
				return { error: `${pc.axes.length ? pc.axes.join(" × ") : pc.name} needs ${pc.modes.length} modes; this Figma plan allows ${limit}. ${pc.name} was left as it was (${e.message}).` };
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
	function toFigma(api, value, varOf) {
		if ("literal" in value) return value.literal;
		const target = varOf.get(value.alias);
		return target ? api.variables.createVariableAlias(target) : null;
	}
	/** Deletes what the designer confirmed, of what the repository no longer has. */
	async function deleteRemoved(api, ids) {
		var _api$commitUndo3;
		const want = new Set(ids);
		let deleted = 0;
		for (const v of await api.variables.getLocalVariablesAsync()) if (want.has(v.id) && getData(v, DKEYS.removed)) {
			v.remove();
			deleted++;
		}
		for (const s of [...await api.getLocalTextStylesAsync(), ...await api.getLocalEffectStylesAsync()]) if (want.has(s.id) && getData(s, DKEYS.removed)) {
			s.remove();
			deleted++;
		}
		for (const c of await api.variables.getLocalVariableCollectionsAsync()) {
			var _getJson3;
			if (want.has(c.id) && getData(c, DKEYS.removed)) {
				c.remove();
				deleted++;
				continue;
			}
			const stale = (_getJson3 = getJson(c, `${DKEYS.removed}Modes`)) !== null && _getJson3 !== void 0 ? _getJson3 : [];
			const keep = stale.filter((m) => !want.has(`${c.id}:${m}`));
			for (const m of stale) {
				if (keep.includes(m)) continue;
				c.removeMode(m);
				deleted++;
			}
			if (keep.length !== stale.length) setData(c, `${DKEYS.removed}Modes`, keep.length ? JSON.stringify(keep) : "");
		}
		(_api$commitUndo3 = api.commitUndo) === null || _api$commitUndo3 === void 0 || _api$commitUndo3.call(api);
		return { deleted };
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/objectWithoutPropertiesLoose.js
	function _objectWithoutPropertiesLoose(r, e) {
		if (null == r) return {};
		var t = {};
		for (var n in r) if ({}.hasOwnProperty.call(r, n)) {
			if (e.includes(n)) continue;
			t[n] = r[n];
		}
		return t;
	}
	// \0@oxc-project+runtime@0.156.0/helpers/esm/objectWithoutProperties.js
	function _objectWithoutProperties(e, t) {
		if (null == e) return {};
		var o, r, i = _objectWithoutPropertiesLoose(e, t);
		if (Object.getOwnPropertySymbols) {
			var s = Object.getOwnPropertySymbols(e);
			for (r = 0; r < s.length; r++) o = s[r], t.includes(o) || {}.propertyIsEnumerable.call(e, o) && (i[o] = e[o]);
		}
		return i;
	}
	// src/handlers.ts
	var _excluded = ["plan"];
	function makeHandlers(figma, post) {
		return {
			dtcgLink: () => getJson(figma.root, DKEYS.link),
			dtcgRead: () => readDtcg(figma),
			dtcgPreview: ({ plan }) => previewOf(figma, plan),
			dtcgAdoption: ({ plan }) => adoptionOf(figma, plan),
			dtcgApply: async (_ref) => {
				var _figma$notify;
				let { plan } = _ref;
				const r = await applyDtcg(figma, plan, _objectWithoutProperties(_ref, _excluded), (progress) => post({
					type: "progress",
					progress
				}));
				(_figma$notify = figma.notify) === null || _figma$notify === void 0 || _figma$notify.call(figma, r.incomplete ? `${plan.name}: import incomplete` : `${plan.name}: ${r.state.counts.variables} variables · ${r.state.counts.textStyles} text styles · ${r.state.counts.effectStyles} effect styles`, { error: r.incomplete });
				return r;
			},
			dtcgDelete: ({ ids }) => deleteRemoved(figma, ids),
			dtcgSetLink: ({ link }) => setData(figma.root, DKEYS.link, link ? JSON.stringify(link) : ""),
			storageGet: ({ key }) => figma.clientStorage.getAsync(key),
			storageSet: ({ key, value }) => value === null || value === void 0 ? figma.clientStorage.deleteAsync(key) : figma.clientStorage.setAsync(key, value)
		};
	}
	// src/main.ts
	if (!Array.prototype.at) Object.defineProperty(Array.prototype, "at", {
		value(i) {
			const n = Math.trunc(i) || 0;
			return this[n < 0 ? this.length + n : n];
		},
		configurable: true,
		writable: true
	});
	var post = (msg) => figma.ui.postMessage(msg);
	figma.showUI(__html__, {
		width: 420,
		height: 640,
		themeColors: true
	});
	var handlers = makeHandlers(figma, post);
	figma.ui.onmessage = async (msg) => {
		if ((msg === null || msg === void 0 ? void 0 : msg.type) !== "call") return;
		try {
			const handler = handlers[msg.method];
			post({
				type: "reply",
				id: msg.id,
				ok: true,
				data: await handler(msg.params)
			});
		} catch (e) {
			var _e$message;
			post({
				type: "reply",
				id: msg.id,
				ok: false,
				error: (_e$message = e.message) !== null && _e$message !== void 0 ? _e$message : String(e)
			});
		}
	};
})();
