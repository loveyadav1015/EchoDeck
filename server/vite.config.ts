import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "ui",
  build: {
    outDir: "../dist-ui",
    emptyOutDir: true,
    rolldownOptions: {
      input: fileURLToPath(new URL("./ui/card.html", import.meta.url)),
    },
  },
  plugins: [viteSingleFile()],
});