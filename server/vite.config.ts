import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  root: "ui",
  build: {
    outDir: "../dist-ui",
    emptyOutDir: true,
  },
  plugins: [viteSingleFile()],
});
