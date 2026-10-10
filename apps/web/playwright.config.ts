import { defineConfig, devices } from '@playwright/test';

const webOrigin = 'http://localhost:3101';
const apiOrigin = 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI === undefined ? 0 : 2,
  use: {
    baseURL: webOrigin,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'corepack pnpm exec next dev -p 3101',
    cwd: __dirname,
    url: webOrigin,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_PUBLIC_API_ORIGIN: apiOrigin,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
