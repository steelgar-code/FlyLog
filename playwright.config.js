const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT) || 4173;
// Optional: point at a specific Chromium binary if the default lookup fails.
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined;

module.exports = defineConfig({
  testDir: 'tests',
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } },
  }],
  webServer: {
    command: 'node tests/support/server.js',
    url: `http://localhost:${PORT}/index.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
