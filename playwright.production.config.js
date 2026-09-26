import { defineConfig } from "@playwright/test";

const external = process.env.GAME_TEST_URL;
export default defineConfig({
  testDir: "./smoke",
  use: {
    baseURL: external ?? "http://127.0.0.1:4173/monster-hotel/",
    headless: true,
  },
  webServer: external
    ? undefined
    : {
        command:
          "npm run preview -- --port 4173 --strictPort --base=/monster-hotel/",
        url: "http://127.0.0.1:4173/monster-hotel/",
        reuseExistingServer: false,
      },
});
