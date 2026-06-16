const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["extension.js"],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node16",
  outfile: "out/extension.js",
  // vscode is provided by the runtime, never bundle it.
  external: ["vscode"],
  sourcemap: !production,
  minify: production,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log("[esbuild] watching…");
  } else {
    await esbuild.build(buildOptions);
    console.log("[esbuild] build complete → out/extension.js");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
