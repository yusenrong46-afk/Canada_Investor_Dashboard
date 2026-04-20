import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      host: env.VITE_HOST || "127.0.0.1",
      port: Number(env.VITE_PORT || 5173),
      strictPort: false,
      proxy: {
        "/api": env.VITE_API_PROXY_TARGET || "http://127.0.0.1:4000",
      },
    },
  };
});
