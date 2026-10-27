import { defineConfig, devices } from '@playwright/test';
import { execSync } from 'node:child_process';

// Runs against the local Supabase stack (`npm run db:start`). Its URL and keys
// are read from the CLI so nothing is hard-coded.
const status = JSON.parse(execSync('npx supabase status -o json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
process.env.E2E_SUPABASE_URL = status.API_URL;
process.env.E2E_SUPABASE_SECRET_KEY = status.SECRET_KEY;

const port = 5174;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}/cascadeFinance/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}/cascadeFinance/`,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_SUPABASE_URL: status.API_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    },
  },
});
