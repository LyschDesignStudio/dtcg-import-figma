/* A repository is untrusted input: keys and file names that would reach an
   object's prototype (__proto__, constructor, prototype) are ignored, in
   every layout, and never change Object.prototype. */

import { afterEach, describe, expect, it } from "vitest";
import { detect, readAndPlan } from "../src/detect";
import { readFolder } from "../src/readers/files";
import { suggestMapping } from "../src/readers/mapped";
import { fixtureTexts } from "./fixtures";

const clean = () => expect(Object.keys(Object.prototype).concat(Object.getOwnPropertyNames(Object.prototype).filter((k) => !["constructor", "__defineGetter__", "__defineSetter__", "hasOwnProperty", "__lookupGetter__", "__lookupSetter__", "isPrototypeOf", "propertyIsEnumerable", "toString", "valueOf", "__proto__", "toLocaleString"].includes(k)))).toEqual([]);
afterEach(() => {
  for (const k of ["polluted", "contexts", "default", "$value", "$type"]) delete (Object.prototype as Record<string, unknown>)[k];
});

const POISON = JSON.stringify({ size: { $type: "number", $value: 1, $extensions: { "com.x": { mode: { dark: 2 } } } } }).replace('"size"', '"__proto__": {"polluted": {"$type":"number","$value":1,"$extensions":{"com.x":{"__proto__":{"dark":2},"mode":{"__proto__":3,"dark":2}}}}}, "constructor": {"prototype": {"polluted": {"$value": 1}}}, "size"');

describe("hostile repository", () => {
  it("hostile: __proto__ keys in a token file, with modes in $extensions, leave Object.prototype alone", () => {
    const texts = { "base.tokens.json": POISON };
    const r = readAndPlan(texts, { format: "mapped", mapping: { files: { "base.tokens.json": { kind: "base" } }, axes: {}, extension: { key: "com.x", defaults: {} } }, remBase: 16 });
    clean();
    expect(r.plan.variables.map((v) => v.path)).toEqual(["size"]);
    expect(r.read.issues.map((i) => i.message)).toContainEqual(expect.stringMatching(/__proto__, constructor or prototype; they were ignored/));
  });

  it("hostile: every layout reads a poisoned file without touching Object.prototype", () => {
    for (const layout of ["resolver", "tokens-studio", "mapped-files"] as const) {
      const texts = fixtureTexts(layout);
      const first = Object.keys(texts).find((p) => /color/.test(p))!;
      texts[first] = texts[first].replace(/^\{/, '{"__proto__": {"polluted": {"$type": "color", "$value": "#ff0000", "type": "color", "value": "#ff0000"}},');
      const files = readFolder(texts);
      const d = detect(Object.keys(texts), files);
      readAndPlan(texts, { format: d.suggested!, remBase: 16 });
      clean();
    }
  });

  it("hostile: files named __proto__.* or constructor.* give no axis of that name", () => {
    const tok = JSON.stringify({ a: { $type: "number", $value: 1 } });
    const files = readFolder({ "__proto__.dark.tokens.json": tok, "__proto__.light.tokens.json": tok, "constructor.x.tokens.json": tok });
    const m = suggestMapping(files);
    expect(Object.keys(m.axes ?? {}).filter((a) => ["__proto__", "constructor", "prototype"].includes(a))).toEqual([]);
    expect(m.files["constructor.x.tokens.json"]).toEqual({ kind: "base" });
    readAndPlan({ "__proto__.dark.tokens.json": tok }, { format: "mapped", remBase: 16 });
    clean();
  });

  it("hostile: a resolver $ref into __proto__ is refused as pointing at nothing", () => {
    const resolver = JSON.stringify({ version: "2025.10", sets: { base: { sources: [{ $ref: "#/__proto__" }, { $ref: "#/constructor/prototype" }] } }, resolutionOrder: [{ $ref: "#/sets/base" }] });
    expect(() => readAndPlan({ "x.resolver.json": resolver }, { format: "resolver", remBase: 16 })).toThrow(/"#\/__proto__" points at nothing/);
    clean();
  });
});
