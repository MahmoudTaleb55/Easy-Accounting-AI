import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy, independently-cacheable vendor libraries out of the
        // single ~2.2 MB entry chunk so (a) they load in parallel and (b) a
        // change to app code doesn't bust the vendor cache. Using the
        // function form rather than a hardcoded module map means we only ever
        // chunk modules that are actually in the client graph — a server-only
        // dependency can never create a phantom/empty chunk. Conservative,
        // dependency-based splitting only (no route-level dynamic imports),
        // so there's no behavioural change, just better chunking.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || /[\\/]node_modules[\\/]react[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("lucide-react")) return "vendor-icons";
          return "vendor";
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});