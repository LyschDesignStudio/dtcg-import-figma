/* ui: the iframe. Built to dist/ui/, then scripts/inline-ui.mjs folds the JS
   and CSS into the single dist/ui.html Figma loads. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/ui",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
