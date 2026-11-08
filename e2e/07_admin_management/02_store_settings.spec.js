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

    const resultsOnlyToggle = (page) =>
        page
            .getByRole('heading', { name: 'Scan & Search Results Only' })
            .locator('xpath=ancestor::div[contains(@class,"justify-between")][1]')
            .locator('button');

    const openHardwareTab = async (page) => {
        await page.getByRole('button', { name: /Workstation & Hardware/i }).first().click();
        await expect(page.getByRole('heading', { name: 'Scan & Search Results Only' })).toBeVisible();
    };

    test('2.3 should persist Scan & Search Results Only across refresh and POS', async ({ page }) => {
        await openHardwareTab(page);

        // Ensure known starting state: disabled
        await page.evaluate(() => localStorage.setItem('pos_show_results_only', 'false'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openHardwareTab(page);
        await expect(resultsOnlyToggle(page)).toHaveClass(/bg-gray-300/);

        // Enable and verify canonical localStorage value
        await resultsOnlyToggle(page).click();
        await expect(page.getByText('Results Only Mode Enabled')).toBeVisible({ timeout: 5000 });
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('true');

        // Refresh Settings — must retain enabled state
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openHardwareTab(page);
        await expect(resultsOnlyToggle(page)).toHaveClass(/bg-emerald-500/);
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('true');

        // POS Terminal must honor the persisted setting without re-login
        await page.goto('/pos', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Scan barcode or search to display products')).toBeVisible({ timeout: 10000 });
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('true');

        // Disable from Settings and confirm persistence + POS catalog returns
        await page.goto('/settings', { waitUntil: 'domcontentloaded' });
        await openHardwareTab(page);
        await resultsOnlyToggle(page).click();
        await expect(page.getByText('Results Only Mode Disabled')).toBeVisible({ timeout: 5000 });
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('false');

        await page.reload({ waitUntil: 'domcontentloaded' });
        await openHardwareTab(page);
        await expect(resultsOnlyToggle(page)).toHaveClass(/bg-gray-300/);

        await page.goto('/pos', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Scan barcode or search to display products')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('false');
    });

    test('2.4 should migrate legacy results-only localStorage value "1"', async ({ page }) => {
        await page.evaluate(() => localStorage.setItem('pos_show_results_only', '1'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await openHardwareTab(page);
        await expect(resultsOnlyToggle(page)).toHaveClass(/bg-emerald-500/);

        await page.goto('/pos', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('Scan barcode or search to display products')).toBeVisible({ timeout: 10000 });
        // POS write-back normalizes legacy "1" to canonical "true"
        expect(await page.evaluate(() => localStorage.getItem('pos_show_results_only'))).toBe('true');
    });
});
