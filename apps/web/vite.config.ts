import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/socket.io": {
        target: process.env.BACKEND_URL || "http://localhost:3000",
        ws: true,
      },
      "/health": process.env.BACKEND_URL || "http://localhost:3000",
    },
  },
});
