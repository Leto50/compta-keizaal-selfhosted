import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tools/statistics-preview",
  testMatch: "*.pw.ts",
  outputDir: ".output/statistics-validation/results",
  reporter: [
    ["list"],
    [
      "html",
      { outputFolder: ".output/statistics-validation/report", open: "never" },
    ],
  ],
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: {
      ...(process.env.STATISTICS_CHROMIUM_PATH
        ? { executablePath: process.env.STATISTICS_CHROMIUM_PATH }
        : {}),
      args: ["--no-sandbox"],
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
  webServer: {
    command: "pnpm preview:statistics",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
  },
})
