import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';

test.describe('Admin Store Settings', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/settings', { waitUntil: 'domcontentloaded' });
    });

    test('2.1 should render store settings sections', async ({ page }) => {
        await expect(page).toHaveURL(/.*settings/);
        await expect(page.getByRole('heading', { name: /Store Settings/i })).toBeVisible({ timeout: 5000 });
        await expect(page.getByRole('button', { name: /Workstation & Hardware/i }).first()).toBeVisible();
    });

    test('2.2 should not show removed multi-store / online sections', async ({ page }) => {
        await expect(page.getByText(/Registers & Lanes/i)).toHaveCount(0);
        await expect(page.getByText(/Policies & Compliance/i)).toHaveCount(0);
    });
});
