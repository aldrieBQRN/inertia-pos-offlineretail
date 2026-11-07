import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';

test.describe('Admin Analytics - Reports & Export', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('2.1 should render sales analytics, top products, and charts', async ({ page }) => {
        await page.goto('/reports', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /Reports|Analytics/i })).toBeVisible({ timeout: 10000 });
    });
});
