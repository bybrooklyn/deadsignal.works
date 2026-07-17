import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Each browser project exercises every route with an accessibility scan.
  // Keep those layout- and AX-heavy checks serial within a project so slower
  // CI runners do not turn valid browser behavior into timing failures.
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Keep browser pressure bounded in every environment. Gecko and WebKit can
  // otherwise stall synchronous layout queries when many pages start at once.
  workers: 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4323',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: 'bunx wrangler dev --local --port 4323',
    url: 'http://127.0.0.1:4323',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
