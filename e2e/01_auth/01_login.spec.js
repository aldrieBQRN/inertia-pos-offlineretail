import { test, expect } from '@playwright/test';
import { loginAsAdmin, unlockWithPin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';

test.describe('First-Time Setup & Admin Unlock', () => {
    test.beforeAll(async ({ browser }) => {
        // Make sure the install has been set up (runs First-Time Setup once on a fresh database)
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await page.close();
    });

    test('1.1 should show the PIN unlock screen with the Admin name', async ({ page }) => {
        await page.goto('/login');
        await expect(page.getByRole('heading', { name: new RegExp(`Welcome back, ${TEST_ADMIN.name.split(' ')[0]}`) })).toBeVisible();
        await expect(page.getByRole('button', { name: '0', exact: true })).toBeVisible();
        await expect(page.locator('#email')).toHaveCount(0);
    });

    test('1.2 should reject a wrong PIN and stay locked', async ({ page }) => {
        await page.goto('/login');
        await unlockWithPin(page, '9137');
        await expect(page.getByRole('alert')).toContainText(/Incorrect PIN/i, { timeout: 10000 });
        await expect(page).toHaveURL(/.*login/);
    });

    test('1.3 should unlock with the correct PIN and land on the dashboard', async ({ page }) => {
        await page.goto('/login');
        await unlockWithPin(page);
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
    });

    test('1.4 should not offer setup again once configured', async ({ page }) => {
        await page.goto('/setup');
        await expect(page).toHaveURL(/.*login/);
    });

    test('1.5 should sign out and require the PIN again', async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/profile');
        await page.request.post('/logout', {
            headers: { 'X-XSRF-TOKEN': decodeURIComponent((await page.context().cookies()).find(c => c.name === 'XSRF-TOKEN')?.value || '') },
        });
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/.*login/);
    });
});
