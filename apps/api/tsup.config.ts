import { defineConfig } from "tsup";

// Bundle the API into one ESM file. Workspace packages (@paylock/*) are
// TypeScript sources, so they are inlined; npm dependencies stay external.
export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  noExternal: [/^@paylock\//],
});
