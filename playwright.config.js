// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  /* Run tests sequentially to avoid overwhelming single-threaded php artisan serve */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on single-threaded dev server */
  workers: 1,
  /* Generous timeout for local PHP server database transactions and page hydration */
  timeout: 60000,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',

  /* Shared settings for all the projects below. */
  use: {
    /* Base URL for your local Laravel server */
    baseURL: process.env.PW_BASE_URL || 'http://127.0.0.1:8000',

    slowMo: process.env.PW_SLOWMO
      ? Number(process.env.PW_SLOWMO)
      : 0,

    /* Collect trace when retrying the failed test. */
    trace: 'on-first-retry',

    /* Helps avoid "flaky" tests by waiting for the page to load */
    actionTimeout: 0,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    /* NOTE: I am commenting out Firefox and Webkit because you
       only installed Chromium. This prevents errors when running tests.
    */
    /*
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    */
  ],

  /* Optional: Automatically start your local dev server before starting tests.
     This is useful if you don't want to manually run 'php artisan serve' every time.
  */
  // webServer: {
  //   command: 'php artisan serve',
  //   url: 'http://127.0.0.1:8000',
  //   reuseExistingServer: true,
  // },
});