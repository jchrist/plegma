import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Webview bundle only. The extension host is still bundled separately by
// esbuild. outDir shares `out/` with it, so never empty it.
export default defineConfig({
  plugins: [vue()],
  // The webview has no `process` global — replace NODE_ENV statically.
  define: { "process.env.NODE_ENV": '"production"' },
  build: {
    outDir: "out",
    emptyOutDir: false,
    // No sourcemaps in the shipped webview: the bundle ends with a
    // sourceMappingURL comment and DevTools tries to fetch the .map, but
    // the webview CSP (default-src 'none', see getWebviewHtml.js) blocks
    // it, logging a CSP violation on every open. (.vscodeignore already
    // excludes *.map from the vsix, so the fetch would 404 anyway.)
    sourcemap: false,
    lib: {
      entry: "src/webview/main.js",
      name: "PlegmaWebview",
      formats: ["iife"],
      fileName: () => "webview.js",
    },
  },
});
