import { test, expect } from '@playwright/test';
import {
    continueTo, fillStoreDetails, fillAdminAccount, fillSignIn, fillRecovery, unlockWithPin,
} from '../fixtures/auth.fixture.js';
import { TEST_ADMIN, STORE_LOGO_PNG } from '../fixtures/test-data.js';
import { apiCall } from '../fixtures/pos.helpers.js';
import { cutInternet, watchPageHealth, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

/**
 * First-Time Setup wizard on a FRESH local database, with the internet cut off.
 * Runs before every other spec (file order). On an already configured install the
 * wizard cannot be shown again, so this file is skipped; use a new database to run it.
 */
test.describe.serial('First-Time Setup wizard (offline)', () => {
    let fresh = false;

    test.beforeAll(async ({ request }) => {
        const res = await request.get('/', { maxRedirects: 0 });
        fresh = (res.headers().location || '').includes('/setup');
    });

    test.beforeEach(() => {
        test.skip(!fresh, 'Needs a fresh, unconfigured database (setup has already been completed).');
    });

    test('opens on a fresh install and completes all four steps', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);
        const problems = watchPageHealth(page);

        await page.goto('/');
        await expect(page).toHaveURL(/\/setup$/);
        await expect(page.getByRole('img', { name: 'Inertia Solutions' })).toBeVisible();
        const progress = page.getByRole('navigation', { name: 'Setup progress' });
        for (const label of ['Store Details', 'Admin Account', 'Sign-in Method', 'Account Recovery']) {
            await expect(progress.getByText(label)).toBeVisible();
        }

        /* ---------- Step 1: Store Details ---------- */
        await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'Enter the store name.' })).toBeVisible();

        // Wrong type and oversized files are rejected before upload
        await page.locator('#store_logo').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
        await expect(page.getByRole('alert').filter({ hasText: 'PNG, JPG or WEBP' })).toBeVisible();
        await page.locator('#store_logo').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 10) });
        await expect(page.getByRole('alert').filter({ hasText: 'larger than 2 MB' })).toBeVisible();
        await expect(page.getByAltText('Store logo preview')).toHaveCount(0);

        // A valid logo is previewed, can be removed and selected again
        await page.locator('#store_logo').setInputFiles(STORE_LOGO_PNG);
        await expect(page.getByAltText('Store logo preview')).toBeVisible();
        await page.getByRole('button', { name: 'Remove' }).click();
        await expect(page.getByAltText('Store logo preview')).toHaveCount(0);

        await fillStoreDetails(page, { withLogo: true });
        await expect(page.getByRole('button', { name: 'Replace' })).toBeVisible();
        await continueTo(page, 'Admin Account');

        /* ---------- Step 2: Admin Account ---------- */
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'Enter your full name.' })).toBeVisible();
        await fillAdminAccount(page);
        await continueTo(page, 'Sign-in Method');

        /* ---------- Step 3: Sign-in Method ---------- */
        await fillSignIn(page, '1234');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'simple sequence' })).toBeVisible();

        await fillSignIn(page, '1111');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'same digit' })).toBeVisible();

        await fillSignIn(page, TEST_ADMIN.pin, '2581');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'does not match' })).toBeVisible();

        // Password option shows the password fields and enforces strength
        await page.getByRole('button', { name: 'Password', exact: true }).click();
        await page.locator('#credential').fill('password');
        await page.locator('#credential_confirmation').fill('password');
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'at least 12 characters' })).toBeVisible();

        await fillSignIn(page);
        await expect(page.locator('#credential')).toHaveAttribute('inputmode', 'numeric');
        await continueTo(page, 'Account Recovery');

        /* ---------- Step 4: Account Recovery ---------- */
        await page.getByRole('button', { name: 'Complete Setup' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'Choose a question.' }).first()).toBeVisible();

        // A question chosen once cannot be picked again in another slot
        await page.locator('#recovery_question_0').selectOption(TEST_ADMIN.recovery[0].question);
        await expect(page.locator('#recovery_question_1 option', { hasText: TEST_ADMIN.recovery[0].question })).toBeDisabled();

        // Back keeps what was entered
        await page.getByRole('button', { name: 'Back' }).click();
        await expect(page.getByRole('heading', { level: 2, name: 'Sign-in Method' })).toBeVisible();
        await expect(page.locator('#credential')).toHaveValue(TEST_ADMIN.pin);
        await continueTo(page, 'Account Recovery');

        await fillRecovery(page);
        await page.getByRole('button', { name: 'Complete Setup' }).click();

        /* ---------- Done: back on the unlock screen ---------- */
        await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
        await expect(page.getByText('Setup complete. Unlock the POS with your new 4-digit PIN.')).toBeVisible();
        await expect(page.getByRole('img', { name: 'Inertia Solutions' })).toBeVisible();
        await expect(page.getByRole('img', { name: TEST_ADMIN.store_name })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Forgot PIN?' })).toBeVisible();

        // Setup cannot be opened again
        await page.goto('/setup');
        await expect(page).toHaveURL(/\/login$/);

        expect(problems).toEqual([]);
        expectNoExternalRequests(external);
    });

    test('the new PIN unlocks the POS, profile details carry over and the logo is stored locally', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await page.goto('/login');
        await unlockWithPin(page, '9137');
        await expect(page.getByRole('alert')).toContainText(/Incorrect PIN/i, { timeout: 10000 });

        await unlockWithPin(page);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        // Admin Account details appear on the existing Profile page
        await page.goto('/profile');
        for (const value of [TEST_ADMIN.name, TEST_ADMIN.phone_number, TEST_ADMIN.address, TEST_ADMIN.city, TEST_ADMIN.province, TEST_ADMIN.country]) {
            await expect(page.getByText(value, { exact: true }).first()).toBeVisible();
        }
        await expect(page.getByText('4-digit PIN', { exact: true })).toBeVisible();

        // Store details and the locally stored logo
        const settings = await apiCall(page, 'get', '/api/settings');
        expect(settings.store_name).toBe(TEST_ADMIN.store_name);
        expect(settings.address).toBe(TEST_ADMIN.store_address);
        expect(settings.logo_path).toMatch(/^\/storage\/logos\//);
        const logo = await page.request.get(settings.logo_path);
        expect(logo.status()).toBe(200);
        expect(logo.headers()['content-type']).toMatch(/^image\//);

        expectNoExternalRequests(external);
    });
});
