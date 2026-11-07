import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';

test.describe('Admin Analytics - Dashboard Overview', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('1.1 should render dashboard metric cards and graphs', async ({ page }) => {
        await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /Dashboard/i })).toBeVisible({ timeout: 10000 });

        const statsCard = page.locator('text=/Sales|Profit|Orders|Revenue/i').first();
        await expect(statsCard).toBeVisible({ timeout: 5000 });
    });
});
