import { defineConfig } from "vite";

// base: "./" so the built dist/ works when hosted from an itch.io
// subfolder (itch serves games from a non-root path).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
  },
});
