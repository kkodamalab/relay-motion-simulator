import { defineConfig } from "@playwright/test";
const remote = process.env.TEST_URL;
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL: remote || "http://127.0.0.1:4173/relay-motion-simulator/" },
  webServer: remote
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 4173",
        url: "http://127.0.0.1:4173/relay-motion-simulator/",
        reuseExistingServer: false,
      },
});
