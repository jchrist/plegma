import * as esbuild from "esbuild";

// Extension host bundle (Node, CommonJS) — plain JS, no type-check.
// The webview (Vue SFCs) is bundled separately by Vite:
//   vp build --config webview.vite.config.mjs
// `npm run compile` runs both; `npm run watch` runs this file in watch mode
// plus `vp build --watch` (see package.json).

const watch = process.argv.includes("--watch");

async function build() {
  const extCtx = await esbuild.context({
    entryPoints: ["src/extension.js"],
    bundle: true,
    outfile: "out/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: true,
  });

  if (watch) {
    await extCtx.watch();
    console.log("Watching extension host for changes...");
  } else {
    await extCtx.rebuild();
    await extCtx.dispose();
    console.log("Build complete: out/extension.js");
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});