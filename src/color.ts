/* A DTCG color ({ colorSpace, components, alpha?, hex? }, or a hex string)
   into Figma's sRGB channels. srgb, hsl and hwb convert exactly; the other
   spaces go through CIE XYZ and are clipped to sRGB's gamut, and the caller
   lists them. A color that can't be read is null: never black. */

import { normalizeHex } from "./shared/stable";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ColorResult = { rgba: Rgba; clipped: boolean; converted: boolean } | { error: string };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
type Vec = [number, number, number];

function hexToRgba(hex: string): Rgba | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const byte = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: byte(1), g: byte(3), b: byte(5), a: h.length === 9 ? byte(7) : 1 };
}

/* ───── transfer functions and matrices (CSS Color 4) ───── */

const toLinear = (c: number) => {
  const a = Math.abs(c);
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c: number) => {
  const a = Math.abs(c);
  return a > 0.0031308 ? Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055) : 12.92 * c;
};
const mul = (m: number[][], v: Vec): Vec => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]) as Vec;

const XYZ65_TO_LINEAR_SRGB = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const LINEAR_P3_TO_XYZ65 = [
  [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
  [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
  [0, 0.04511338185890264, 1.043944368900976],
];
const LINEAR_REC2020_TO_XYZ65 = [
  [0.6369580483012914, 0.14461690358620832, 0.1688809751641721],
  [0.2627002120112671, 0.6779980715188708, 0.05930171646986196],
  [0, 0.028072693049087428, 1.060985057710791],
];
const LINEAR_A98_TO_XYZ65 = [
  [0.5766690429101305, 0.1855582379065463, 0.1882286462349947],
  [0.29734497525053605, 0.6273635662554661, 0.07529145849399788],
  [0.02703136138641234, 0.07068885253582723, 0.9913375368376388],
];
const LINEAR_PROPHOTO_TO_XYZ50 = [
  [0.7977604896723027, 0.13518583717574031, 0.0313493495815248],
  [0.2880711282292934, 0.7118432178101014, 0.00008565396060525902],
  [0, 0, 0.8251046025104601],
];
const XYZ50_TO_XYZ65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const OKLAB_TO_LMS = [
  [1, 0.3963377773761749, 0.2158037573099136],
  [1, -0.1055613458156586, -0.0638541728258133],
  [1, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ65 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];

function labToXyz50([l, a, b]: Vec): Vec {
  const k = 24389 / 27;
  const e = 216 / 24389;
  const fy = (l + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const x = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k;
  const y = l > k * e ? ((l + 16) / 116) ** 3 : l / k;
  const z = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k;
  return [x * 0.3457 / 0.3585, y, z * (1 - 0.3457 - 0.3585) / 0.3585];
}
const polar = ([l, c, h]: Vec): Vec => {
  const r = ((Number.isNaN(h) ? 0 : h) * Math.PI) / 180;
  return [l, c * Math.cos(r), c * Math.sin(r)];
};

function hslToRgb([h, s, l]: Vec): Vec {
  s /= 100;
  l /= 100;
  const f = (n: number) => {
    const k = (n + (Number.isNaN(h) ? 0 : h) / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}
function hwbToRgb([h, w, b]: Vec): Vec {
  w /= 100;
  b /= 100;
  if (w + b >= 1) {
    const g = w / (w + b);
    return [g, g, g];
  }
  return hslToRgb([h, 100, 50]).map((c) => c * (1 - w - b) + w) as Vec;
}

/** Gamma-encoded sRGB (possibly out of 0–1) for a space and its components; null for a space it doesn't know. */
function toSrgb(space: string, c: Vec): { rgb: Vec; exact: boolean } | null {
  switch (space) {
    case "srgb": return { rgb: c, exact: true };
    case "hsl": return { rgb: hslToRgb(c), exact: true };
    case "hwb": return { rgb: hwbToRgb(c), exact: true };
    case "srgb-linear": return { rgb: c.map(toGamma) as Vec, exact: false };
    case "display-p3": return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(LINEAR_P3_TO_XYZ65, c.map(toLinear) as Vec)).map(toGamma) as Vec, exact: false };
    case "a98-rgb": {
      const lin = c.map((v) => Math.sign(v) * Math.abs(v) ** 2.19921875) as Vec;
      return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(LINEAR_A98_TO_XYZ65, lin)).map(toGamma) as Vec, exact: false };
    }
    case "rec2020": {
      const a = 1.09929682680944;
      const b = 0.018053968510807;
      const lin = c.map((v) => (Math.abs(v) < b * 4.5 ? v / 4.5 : Math.sign(v) * ((Math.abs(v) + a - 1) / a) ** (1 / 0.45))) as Vec;
      return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(LINEAR_REC2020_TO_XYZ65, lin)).map(toGamma) as Vec, exact: false };
    }
    case "prophoto-rgb": {
      const lin = c.map((v) => (Math.abs(v) <= 16 / 512 ? v / 16 : Math.sign(v) * Math.abs(v) ** 1.8)) as Vec;
      return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(XYZ50_TO_XYZ65, mul(LINEAR_PROPHOTO_TO_XYZ50, lin))).map(toGamma) as Vec, exact: false };
    }
    case "xyz-d65": case "xyz": return { rgb: mul(XYZ65_TO_LINEAR_SRGB, c).map(toGamma) as Vec, exact: false };
    case "xyz-d50": return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(XYZ50_TO_XYZ65, c)).map(toGamma) as Vec, exact: false };
    case "lab": return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(XYZ50_TO_XYZ65, labToXyz50(c))).map(toGamma) as Vec, exact: false };
    case "lch": return toSrgb("lab", polar(c));
    case "oklab": {
      const lms = mul(OKLAB_TO_LMS, c).map((v) => v ** 3) as Vec;
      return { rgb: mul(XYZ65_TO_LINEAR_SRGB, mul(LMS_TO_XYZ65, lms)).map(toGamma) as Vec, exact: false };
    }
    case "oklch": return toSrgb("oklab", polar(c));
    default: return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * A color value in Figma's terms. `converted`: it wasn't sRGB, HSL or HWB
 * (listed); `clipped`: it was outside sRGB's gamut and was brought in.
 */
export function readColor(value: unknown): ColorResult {
  if (typeof value === "string") {
    const rgba = hexToRgba(value);
    if (rgba) return { rgba, clipped: false, converted: false };
    const m = value.trim().match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return { rgba: { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: clamp01(a) }, clipped: false, converted: false };
    }
    return { error: `"${value}" isn't a color the plugin reads (a hex, rgb() or a DTCG color object).` };
  }
  if (!value || typeof value !== "object") return { error: "isn't a color." };
  const v = value as { colorSpace?: unknown; components?: unknown; alpha?: unknown; hex?: unknown };
  const alpha = v.alpha === undefined ? 1 : isNum(v.alpha) ? clamp01(v.alpha) : NaN;
  if (Number.isNaN(alpha)) return { error: "has an alpha that isn't a number." };
  const space = String(v.colorSpace ?? "");
  const comps = Array.isArray(v.components) ? v.components.map((c) => (c === "none" ? NaN : c)) : null;
  if (!comps || comps.length !== 3 || comps.some((c) => typeof c !== "number")) {
    if (typeof v.hex === "string" && hexToRgba(v.hex)) return { rgba: { ...hexToRgba(v.hex)!, a: alpha }, clipped: false, converted: false };
    return { error: `has components that aren't three numbers.` };
  }
  const conv = toSrgb(space, comps as Vec);
  if (!conv) {
    if (typeof v.hex === "string" && hexToRgba(v.hex)) return { rgba: { ...hexToRgba(v.hex)!, a: alpha }, clipped: false, converted: true };
    return { error: `is in the color space "${space}", which the plugin doesn't know.` };
  }
  const rgb = conv.rgb.map((c) => (Number.isNaN(c) ? 0 : c));
  const out = rgb.some((c) => c < -1e-4 || c > 1 + 1e-4);
  return { rgba: { r: clamp01(rgb[0]), g: clamp01(rgb[1]), b: clamp01(rgb[2]), a: alpha }, clipped: out, converted: !conv.exact };
}

/** Lowercase #rrggbb, or #rrggbbaa when not opaque: the snapshot's form.
    Each channel is first taken to 32 bits, as Figma stores it: an alpha of 0.7 is 178.5 of 255 and rounds up, but Figma's
    0.69999999 rounds down, and the file would never match the repository. Both sides go through here, so both round alike. */
export function rgbaHex({ r, g, b, a = 1 }: { r: number; g: number; b: number; a?: number }): string {
  const byte = (v: number) => Math.max(0, Math.min(255, Math.round(Math.fround(v) * 255))).toString(16).padStart(2, "0");
  return normalizeHex(`#${byte(r)}${byte(g)}${byte(b)}${byte(a)}`)!;
}
