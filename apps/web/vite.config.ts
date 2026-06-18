import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
