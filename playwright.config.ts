import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 75000,
  outputDir: "test-results/playwright",
  webServer:
    process.env.VELVET_LOCAL_TESTS === "true"
      ? [
          {
            command:
              process.env.VELVET_UX_FIXTURE === "true"
                ? "node --import tsx tests/fixtures/ux-server.ts"
                : process.env.VELVET_INSURANCE_TESTS === "true"
                  ? "node --import tsx tests/fixtures/insurance-server.ts"
                  : "node --import tsx apps/server/src/index.ts",
            url: "http://127.0.0.1:3097/health",
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
            env: {
              PORT: "3097",
              TURN_SECONDS:
                process.env.VELVET_UX_FIXTURE === "true" ? "120" : "20",
              BETTING_SECONDS:
                process.env.VELVET_UX_FIXTURE === "true" ? "120" : "20",
              PUBLIC_ORIGIN: "http://localhost:5197",
              DATA_FILE: "./.tools/test-data/browser-wallets.json",
              TRUST_PROXY: "false",
              ROULETTE_BETTING_SECONDS:
                process.env.VELVET_UX_FIXTURE === "true" ? "120" : "30",
              ROULETTE_SPIN_SECONDS:
                process.env.VELVET_UX_FIXTURE === "true" ? "12" : "6",
              ROULETTE_RESULT_SECONDS:
                process.env.VELVET_UX_FIXTURE === "true" ? "30" : "4",
            },
          },
          {
            command:
              "node_modules/.bin/vite apps/web --host 127.0.0.1 --port 5197 --strictPort",
            url: "http://127.0.0.1:5197",
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
            env: { BACKEND_URL: "http://127.0.0.1:3097" },
          },
        ]
      : undefined,
  use: {
    baseURL:
      process.env.SERVER_URL ||
      (process.env.VELVET_LOCAL_TESTS === "true"
        ? "http://localhost:5197"
        : "http://localhost:8097"),
    headless: true,
  },
  reporter: "list",
});
