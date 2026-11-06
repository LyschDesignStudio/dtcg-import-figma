/* Small, dependency-free helpers shared by the reader, the planner and the
   Figma side: hex and number normalization, a stable stringify and a hash. */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Lowercase #rrggbb, or #rrggbbaa when not opaque. Null when it isn't a hex color. */
export function normalizeHex(value: string): string | null {
  const m = value.trim().match(HEX_RE);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  if (hex.length === 8 && hex.endsWith("ff")) hex = hex.slice(0, 6);
  return `#${hex}`;
}

/** Figma stores numbers as float32 (0.8 comes back as 0.800000011920929): four decimals is the precision that survives. */
export const normalizeNumber = (n: number) => Math.round(n * 10000) / 10000 + 0;

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().filter((k) => (value as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** cyrb53: a fast 53-bit string hash, as 14 hex digits. Not cryptographic; a change detector. */
function cyrb53(str: string) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** The hash of any JSON value, independent of key order. */
export const hash = (value: unknown) => cyrb53(stableStringify(value));
