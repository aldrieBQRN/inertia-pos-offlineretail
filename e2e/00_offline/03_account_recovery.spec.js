import { test, expect } from '@playwright/test';
import { loginAsAdmin, unlockWithPin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';
import { cutInternet, watchPageHealth, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

const NEW_PIN = '3691';
const questionTexts = TEST_ADMIN.recovery.map((r) => r.question || r.custom);

async function openRecovery(page) {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot PIN?' }).click();
    await expect(page).toHaveURL(/\/recover$/);
    await expect(page.getByRole('heading', { name: 'Forgot your PIN?' })).toBeVisible();
}

async function answer(page, answers) {
    for (const [i, value] of answers.entries()) {
        await page.locator(`#answer_${i}`).fill(value);
    }
    await page.getByRole('button', { name: 'Verify Answers' }).click();
}

async function setNewPin(page, pin) {
    await expect(page.getByRole('heading', { name: 'Set a new sign-in method' })).toBeVisible();
    await page.getByRole('button', { name: '4-digit PIN' }).click();
    await page.locator('#credential').fill(pin);
    await page.locator('#credential_confirmation').fill(pin);
    await page.getByRole('button', { name: 'Save New Sign-in' }).click();
    await expect(page.getByRole('heading', { name: 'Sign-in reset' })).toBeVisible({ timeout: 15000 });
}

/**
 * "Forgot PIN" offline recovery with security questions. The internet is cut off for
 * every test. The last test restores the fixture PIN so later specs can unlock.
 */
test.describe.serial('Account recovery (offline)', () => {
    test.beforeAll(async ({ browser }) => {
        // Make sure the install is configured (runs setup on a fresh database)
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await page.close();
    });

    test('Forgot PIN opens recovery and shows only the questions', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);
        const problems = watchPageHealth(page);

        await openRecovery(page);
        for (const [i, question] of questionTexts.entries()) {
            await expect(page.locator(`label[for="answer_${i}"]`)).toHaveText(question);
        }

        // Stored answers are never sent to the browser
        const html = await page.content();
        for (const { answer: value } of TEST_ADMIN.recovery) {
            expect(html).not.toContain(value);
        }

        expect(problems).toEqual([]);
        expectNoExternalRequests(external);
    });

    test('incorrect answers fail with a generic message', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await openRecovery(page);
        await answer(page, [TEST_ADMIN.recovery[0].answer, TEST_ADMIN.recovery[1].answer, 'Wrong colour']);

        await expect(page.getByRole('alert')).toHaveText('The answers could not be verified.');
        await expect(page.getByRole('heading', { name: 'Forgot your PIN?' })).toBeVisible();
        // The answer fields are cleared, and nothing says which answer was wrong
        await expect(page.locator('#answer_0')).toHaveValue('');

        expectNoExternalRequests(external);
    });

    test('correct answers allow a new PIN; the old PIN stops working', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await openRecovery(page);
        // Answers are not case- or spacing-sensitive
        await answer(page, TEST_ADMIN.recovery.map((r) => `  ${r.answer.toUpperCase()} `));

        // Weak PINs are still rejected here
        await expect(page.getByRole('heading', { name: 'Set a new sign-in method' })).toBeVisible();
        await page.getByRole('button', { name: '4-digit PIN' }).click();
        await page.locator('#credential').fill('1234');
        await page.locator('#credential_confirmation').fill('1234');
        await page.getByRole('button', { name: 'Save New Sign-in' }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'simple sequence' })).toBeVisible();

        await setNewPin(page, NEW_PIN);
        await page.getByRole('link', { name: 'Return to Unlock Screen' }).click();
        await expect(page).toHaveURL(/\/login$/);

        // Old PIN no longer works
        await unlockWithPin(page, TEST_ADMIN.pin);
        await expect(page.getByRole('alert')).toContainText(/Incorrect PIN/i, { timeout: 10000 });
        await expect(page).toHaveURL(/\/login$/);

        // New PIN unlocks the POS
        await unlockWithPin(page, NEW_PIN);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        expectNoExternalRequests(external);
    });

    test('recovery can be repeated (restores the original PIN)', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);

        await openRecovery(page);
        await answer(page, TEST_ADMIN.recovery.map((r) => r.answer));
        await setNewPin(page, TEST_ADMIN.pin);

        await page.goto('/login');
        await unlockWithPin(page, TEST_ADMIN.pin);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        expectNoExternalRequests(external);
    });
});
