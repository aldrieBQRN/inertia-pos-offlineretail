import { expect } from '@playwright/test';
import { TEST_ADMIN, STORE_LOGO_PNG } from './test-data.js';
import { ensureActiveShift as ensurePosShift } from './pos.helpers.js';

const continueButton = (page) => page.getByRole('button', { name: /^(Continue|Checking…)$/ });

/** Clicks Continue and waits for the wizard to show the next step heading. */
export async function continueTo(page, nextHeading) {
    await continueButton(page).click();
    await expect(page.getByRole('heading', { level: 2, name: nextHeading })).toBeVisible({ timeout: 15000 });
}

export async function fillStoreDetails(page, { withLogo = true } = {}) {
    await expect(page.getByRole('heading', { level: 2, name: 'Store Details' })).toBeVisible();
    await page.locator('#store_name').fill(TEST_ADMIN.store_name);
    if (withLogo) {
        await page.locator('#store_logo').setInputFiles(STORE_LOGO_PNG);
        await expect(page.getByAltText('Store logo preview')).toBeVisible();
    }
    await page.locator('#store_address').fill(TEST_ADMIN.store_address);
    await page.locator('#store_phone').fill(TEST_ADMIN.store_phone);
}

export async function fillAdminAccount(page) {
    await page.locator('#admin_name').fill(TEST_ADMIN.name);
    await page.locator('#phone_number').fill(TEST_ADMIN.phone_number);
    await page.locator('#address').fill(TEST_ADMIN.address);
    await page.locator('#city').fill(TEST_ADMIN.city);
    await page.locator('#province').fill(TEST_ADMIN.province);
    await page.locator('#country').fill(TEST_ADMIN.country);
}

export async function fillSignIn(page, pin = TEST_ADMIN.pin, confirmation = pin) {
    await page.getByRole('button', { name: '4-digit PIN' }).click();
    await page.locator('#credential').fill(pin);
    await page.locator('#credential_confirmation').fill(confirmation);
}

export async function fillRecovery(page, entries = TEST_ADMIN.recovery) {
    for (const [i, entry] of entries.entries()) {
        if (entry.custom) {
            await page.locator(`#recovery_question_${i}`).selectOption('custom');
            await page.locator(`#recovery_custom_${i}`).fill(entry.custom);
        } else {
            await page.locator(`#recovery_question_${i}`).selectOption(entry.question);
        }
        await page.locator(`#recovery_answer_${i}`).fill(entry.answer);
    }
}

/**
 * Completes the 4-step First-Time Setup wizard on a fresh install and lands on the unlock screen.
 */
export async function completeFirstTimeSetup(page) {
    await fillStoreDetails(page);
    await continueTo(page, 'Admin Account');
    await fillAdminAccount(page);
    await continueTo(page, 'Sign-in Method');
    await fillSignIn(page);
    await continueTo(page, 'Account Recovery');
    await fillRecovery(page);
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15000 });
    await expect(page.getByText(/Setup complete/)).toBeVisible();
}

/**
 * Unlocks the POS with the Admin PIN using the on-screen keypad's keyboard support.
 */
export async function unlockWithPin(page, pin = TEST_ADMIN.pin) {
    // Wait for the keypad to be interactive (React hydrated) before typing
    await expect(page.getByRole('button', { name: '0', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.keyboard.type(pin, { delay: 30 });
}

/**
 * Sign in as the single Admin (runs First-Time Setup first on a fresh install).
 */
export async function loginAsAdmin(page, landing = '/dashboard') {
    await page.goto(landing, { waitUntil: 'domcontentloaded' });

    if (page.url().includes('/setup')) {
        await completeFirstTimeSetup(page);
    }

    if (page.url().includes('/login')) {
        await unlockWithPin(page);
        await expect(page).not.toHaveURL(/.*login/, { timeout: 15000 });
        if (!page.url().includes(landing)) await page.goto(landing, { waitUntil: 'domcontentloaded' });
    }
}

/**
 * The Admin runs the POS Terminal directly (there are no separate cashier accounts).
 */
export async function loginAsCashier(page) {
    await loginAsAdmin(page, '/pos');
    await expect(page).toHaveURL(/.*pos/, { timeout: 15000 });
}

/**
 * Ensures the register has an active shift; opens one if currently closed
 */
export async function ensureActiveShift(page, startingCash = '1000') {
    await ensurePosShift(page, Number(startingCash));
}
