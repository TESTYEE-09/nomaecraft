import { resolve } from "path";
import { defineConfig } from "vite";
import { comlink } from "vite-plugin-comlink";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "~": resolve(__dirname, "src"),
    },
  },
  plugins: [comlink()],
  worker: {
    plugins: () => [comlink()],
  },
  server: {
    port: 8123,
  },
});
