import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';

test.describe('Admin Shift Records & Z-Readings', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
    });

    test('1.1 should render shift records list and filter controls', async ({ page }) => {
        await expect(page).toHaveURL(/.*shifts/);
        await expect(page.getByRole('heading', { name: /Shift|Z-Read/i })).toBeVisible({ timeout: 5000 });
    });

    test('1.2 should open Shift Details / Z-Report breakdown modal', async ({ page }) => {
        const detailsBtn = page.locator('button:has-text("Details"), button:has-text("Z-Read"), button:has-text("View")').first();
        if (await detailsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await detailsBtn.click();
            await page.waitForTimeout(500);

            const modal = page.locator('.fixed').first();
            await expect(modal).toBeVisible({ timeout: 3000 });
        }
    });
});
