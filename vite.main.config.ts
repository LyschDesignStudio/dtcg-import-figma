/* main: the Figma sandbox. One IIFE, no imports at runtime, a target the sandbox runs. */
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "es2017",
    minify: false,
    lib: { entry: "src/main.ts", formats: ["iife"], name: "dtcgImport", fileName: () => "code.js" },
  },
});
