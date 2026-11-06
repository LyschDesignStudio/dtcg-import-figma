/* A browser page for looking at the panel (preview/): the UI over fakes. Not built into the plugin. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "preview",
  plugins: [react()],
  server: { fs: { allow: [".."] } },
});
