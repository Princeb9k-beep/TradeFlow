import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In split local dev, proxy API calls to the FastAPI backend on :8000.
// In the single-app deploy, FastAPI serves this build and same-origin calls just work.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/auth": "http://localhost:8000",
      "/trading": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
