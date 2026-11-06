/* Folds dist/ui/index.html's script and stylesheet into dist/ui.html: a
   Figma plugin's UI is one HTML string, with no files beside it. */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "../dist/ui");
let html = readFileSync(join(dir, "index.html"), "utf8");
const read = (src) => readFileSync(join(dir, src.replace(/^\.\//, "")), "utf8");

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => `<script type="module">${read(src).replace(/<\/script/g, "<\\/script")}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${read(href)}</style>`);
if (/\s(src|href)="\.\/assets\//.test(html)) throw new Error("inline-ui: a file was left out of ui.html");

writeFileSync(join(dir, "../ui.html"), html);
rmSync(dir, { recursive: true });
console.log(`dist/ui.html  ${(html.length / 1024).toFixed(0)} kB`);
