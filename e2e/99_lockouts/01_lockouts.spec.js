import { test, expect } from '@playwright/test';
import { loginAsAdmin, unlockWithPin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';
import { cutInternet, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

/**
 * Brute-force protection on the unlock screen and on account recovery.
 *
 * Runs LAST on purpose (folder 99_): the final test leaves account recovery locked
 * for 15 minutes on this machine. The unlock screen itself is left working.
 */
test.describe.serial('Lockouts (offline)', () => {
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await page.close();
    });

    test('five wrong PINs lock the unlock screen, even for the correct PIN', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        const tryPin = (pin) => Promise.all([
            page.waitForResponse((r) => r.url().endsWith('/login') && r.request().method() === 'POST'),
            unlockWithPin(page, pin),
        ]);

        await page.goto('/login');
        for (let attempt = 1; attempt <= 5; attempt++) {
            await tryPin('9137');
            await expect(page.getByRole('alert')).toContainText(/Incorrect PIN/i, { timeout: 10000 });
            await expect(page.getByLabel('0 of 4 digits entered')).toBeVisible();
        }

        await tryPin(TEST_ADMIN.pin);
        await expect(page.getByRole('alert')).toContainText(/Too many/i, { timeout: 10000 });
        await expect(page).toHaveURL(/\/login$/);

        expectNoExternalRequests(external);
    });

    test('a successful account recovery lifts the unlock lockout', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await page.goto('/recover');
        for (const [i, { answer }] of TEST_ADMIN.recovery.entries()) {
            await page.locator(`#answer_${i}`).fill(answer);
        }
        await page.getByRole('button', { name: 'Verify Answers' }).click();

        await page.getByRole('button', { name: '4-digit PIN' }).click();
        await page.locator('#credential').fill(TEST_ADMIN.pin);
        await page.locator('#credential_confirmation').fill(TEST_ADMIN.pin);
        await page.getByRole('button', { name: 'Save New Sign-in' }).click();
        await page.getByRole('link', { name: 'Return to Unlock Screen' }).click();

        await unlockWithPin(page, TEST_ADMIN.pin);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        expectNoExternalRequests(external);
    });

    test('five wrong recovery attempts lock recovery, even for the correct answers', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await page.goto('/recover');
        for (let attempt = 1; attempt <= 5; attempt++) {
            for (const i of [0, 1, 2]) {
                await page.locator(`#answer_${i}`).fill(`wrong ${attempt}`);
            }
            await page.getByRole('button', { name: 'Verify Answers' }).click();
            await expect(page.getByRole('alert')).toHaveText('The answers could not be verified.');
        }

        for (const [i, { answer }] of TEST_ADMIN.recovery.entries()) {
            await page.locator(`#answer_${i}`).fill(answer);
        }
        await page.getByRole('button', { name: 'Verify Answers' }).click();
        await expect(page.getByRole('alert')).toContainText('Too many attempts');
        await expect(page.getByRole('heading', { name: 'Forgot your PIN?' })).toBeVisible();

        expectNoExternalRequests(external);
    });
});
