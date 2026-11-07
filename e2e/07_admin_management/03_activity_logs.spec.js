import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';
import { cutInternet, watchPageHealth, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

const tableRows = (page) => page.locator('table tbody tr');

test.describe('Admin Activity Logs & Audit Trail', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/activity-logs', { waitUntil: 'domcontentloaded' });
    });

    test('3.1 should render activity logs timeline and filter options', async ({ page }) => {
        await expect(page).toHaveURL(/.*activity-logs/);
        await expect(page.getByRole('heading', { name: /Activity Logs|Audit Trail/i })).toBeVisible({ timeout: 5000 });
    });

    test('3.2 is reachable from the main navigation and lists activity offline', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);
        const problems = watchPageHealth(page);

        await page.goto('/dashboard');
        await page.locator('a[href$="/activity-logs"]').filter({ visible: true }).first().click();
        await expect(page).toHaveURL(/\/activity-logs$/);

        // Sign-ins by the single Admin are listed
        await expect(tableRows(page).first()).toBeVisible();
        await expect(page.getByRole('columnheader', { name: 'Performed By' })).toBeVisible();
        await expect(tableRows(page).filter({ hasText: 'Logged In' }).first()).toContainText(TEST_ADMIN.name);

        // No staff/role concepts remain
        await expect(page.locator('select option', { hasText: /All Staff/ })).toHaveCount(0);
        await expect(page.getByText(/Staff Member|Staff & Accounts/)).toHaveCount(0);

        expect(problems).toEqual([]);
        expectNoExternalRequests(external);
    });

    test('3.3 search, category tabs and action filter narrow the list', async ({ page }) => {
        const search = page.getByPlaceholder('Search by log ID (e.g. LOG-00039), action, or description...');

        await search.fill('Admin signed in');
        await expect(tableRows(page).first()).toContainText('Admin signed in');
        for (const row of await tableRows(page).all()) {
            await expect(row).toContainText('Admin signed in');
        }

        await search.fill('no-such-activity-xyz');
        await expect(page.getByText('No activity logs found').first()).toBeVisible();
        await search.fill('');

        await page.locator('button[data-tab="security"]').click();
        await expect(tableRows(page).first()).toContainText('Security & Account');

        await page.locator('select').filter({ has: page.locator('option', { hasText: /^All Actions/ }) }).selectOption('login_success');
        for (const row of await tableRows(page).all()) {
            await expect(row).toContainText('Logged In');
        }
    });

    test('3.4 activity details open in the audit inspector', async ({ page }) => {
        await page.getByPlaceholder('Search by log ID (e.g. LOG-00039), action, or description...').fill('Admin signed in');
        await tableRows(page).first().getByTitle('View Audit Details & Changes').click();

        const inspector = page.locator('div.fixed').filter({ has: page.getByRole('heading', { name: 'Activity Details & Audit Inspector' }) });
        await expect(inspector).toBeVisible();
        await expect(inspector.getByText('Performed By', { exact: true })).toBeVisible();
        await expect(inspector.getByText(TEST_ADMIN.name).first()).toBeVisible();
        await expect(inspector.getByText('Admin signed in')).toBeVisible();

        await page.getByRole('button', { name: 'Done' }).click();
        await expect(page.getByRole('heading', { name: 'Activity Details & Audit Inspector' })).toBeHidden();
    });
});
