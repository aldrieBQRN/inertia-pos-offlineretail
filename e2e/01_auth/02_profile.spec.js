import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';

test.describe('Admin Profile Page', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    });

    test('2.1 should render profile settings and user details', async ({ page }) => {
        await expect(page).toHaveURL(/.*profile/);
        const nameInput = page.locator('input[name="name"], input#name').first();
        if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(nameInput).not.toBeEmpty();
        }
    });
});
