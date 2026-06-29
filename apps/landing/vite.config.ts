import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { marketDemandResponse } from "./src/worker";

export default defineConfig({
  root: __dirname,
  plugins: [
    {
      name: "market-demand-api",
      configureServer(server) {
        server.middlewares.use("/api/market-demand", async (_request, response) => {
          const marketDemand = await marketDemandResponse();
          const body = await marketDemand.text();

          response.statusCode = marketDemand.status;
          marketDemand.headers.forEach((value, key) => {
            response.setHeader(key, value);
          });
          response.end(body);
        });
      },
    },
    tailwindcss(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
