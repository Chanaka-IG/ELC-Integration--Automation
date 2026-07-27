import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  testDir: './tests',
  // The OHRM delta-report cursor and the 5-min Celigo schedule are shared state.
  // Sync E2E tests MUST run serially — parallel tests would consume each
  // other's change events. UI-only suites may override this per-project later.
  fullyParallel: false,
  workers: 1,
  retries: 0, // sync tests are not safely retryable (events are consumed once)
  timeout: 10 * 60 * 1000, // one full test can span consumer + 5-min flow schedule
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never' }], // evidence pack: screenshots, traces, steps
  ],
  use: {
    baseURL: process.env.OHRM_URL,
    trace: 'on', // always capture — traces are the QA evidence
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: 'e2e-sync',
      testDir: './tests/e2e',
    },
    {
      name: 'negative',
      testDir: './tests/negative',
    },
  ],
});
