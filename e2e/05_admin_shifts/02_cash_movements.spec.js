import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsCashier } from '../fixtures/auth.fixture.js';
import {
    pesos,
    apiCall,
    startFreshShift,
    closeActiveShiftViaApi,
    cashMovementModal,
    recordCashMovement,
} from '../fixtures/pos.helpers.js';

/**
 * Cash In / Cash Out is recorded from the Shift page (/shifts) on the store's single cash
 * drawer: there is no register or cashier to choose, the open shift's drawer is used.
 *
 * A dedicated shift is opened for this file and closed (balanced) afterwards.
 */
test.describe('Admin Shift Page — Cash In / Cash Out', () => {
    const FLOAT = 1000;
    let cashierContext;
    let cashierPage;
    let shift;

    test.beforeAll(async ({ browser }) => {
        cashierContext = await browser.newContext();
        cashierPage = await cashierContext.newPage();
        await loginAsCashier(cashierPage);
        shift = await startFreshShift(cashierPage, FLOAT, 'Automated E2E admin cash movement shift');
    });

    test.afterAll(async () => {
        await closeActiveShiftViaApi(cashierPage);
        await cashierContext.close();
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/shifts', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'Cash In / Out', exact: true })).toBeVisible();
    });

    /** Live drawer balance of the test shift, as reported to the admin (pesos). */
    const drawerBalance = async (page) => {
        const active = await apiCall(page, 'get', '/api/shifts/active');
        return Number(active.find((s) => s.id === shift.id).current_drawer_cash);
    };

    /** Opens Cash In/Out (which reloads the drawer balance). */
    async function openCashMovement(page) {
        await Promise.all([
            page.waitForResponse((r) => r.url().endsWith('/api/shifts/active') && r.request().method() === 'GET'),
            page.getByRole('button', { name: 'Cash In / Out', exact: true }).click(),
        ]);
        await expect(cashMovementModal.heading(page)).toBeVisible();
    }

    async function expectDrawerShown(page, balance) {
        await expect(cashMovementModal.available(page)).toHaveText(`Available in Drawer: ${pesos(balance)}`);
    }

    async function closeModal(page) {
        await page.getByRole('button', { name: /^Cancel/ }).click();
        await expect(cashMovementModal.heading(page)).toBeHidden();
    }

    async function expectMovementOnShift(page, movement) {
        const shifts = await apiCall(page, 'get', '/api/shifts?all=true');
        const record = shifts.find((s) => s.id === shift.id);
        expect(record.cash_movements.map((m) => m.id)).toContain(movement.id);
    }

    test('2.0 should not ask for a target register or cashier', async ({ page }) => {
        await openCashMovement(page);
        const dialog = cashMovementModal.dialog(page);
        await expect(dialog.locator('select')).toHaveCount(0);
        await expect(dialog.getByText(/Target|Cashier \/ Register|Physical Registers|Active Cashier Shifts/)).toHaveCount(0);
        // Only type, amount and reason are asked for
        await expect(dialog.getByText('Movement Type')).toBeVisible();
        await expect(cashMovementModal.amount(page)).toBeVisible();
        await expect(cashMovementModal.reason(page)).toBeVisible();
        await closeModal(page);
    });

    test('2.1 should record a Cash In from the Shift page', async ({ page }) => {
        const before = await drawerBalance(page);
        await openCashMovement(page);
        await expectDrawerShown(page, before);

        const reason = `E2E admin cash in ${Date.now()}`;
        const movement = await recordCashMovement(page, { type: 'Cash In / Deposit', amount: 300, reason });
        expect(movement.type).toBe('cash_in');
        expect(movement.shift_id).toBe(shift.id);
        expect(Number(movement.amount)).toBe(300);
        expect(movement.reason).toBe(reason);
        await expectMovementOnShift(page, movement);

        // Drawer balance increases by the cash in
        await openCashMovement(page);
        await expectDrawerShown(page, before + 300);
        await closeModal(page);
        expect(await drawerBalance(page)).toBeCloseTo(before + 300, 2);
    });

    test('2.2 should record a Cash Out from the Shift page', async ({ page }) => {
        const before = await drawerBalance(page);
        await openCashMovement(page);
        await expectDrawerShown(page, before);

        const reason = `E2E admin cash out ${Date.now()}`;
        const movement = await recordCashMovement(page, { type: 'Cash Out / Expense', amount: 125.5, reason });
        expect(movement.type).toBe('cash_out');
        expect(movement.shift_id).toBe(shift.id);
        expect(Number(movement.amount)).toBe(125.5);
        expect(movement.reason).toBe(reason);
        await expectMovementOnShift(page, movement);

        // Drawer balance decreases by the cash out
        await openCashMovement(page);
        await expectDrawerShown(page, before - 125.5);
        await closeModal(page);
        expect(await drawerBalance(page)).toBeCloseTo(before - 125.5, 2);
    });

    test('2.3 should block a Cash Out above the drawer balance', async ({ page }) => {
        const before = await drawerBalance(page);
        const overLimit = Number((before + 0.01).toFixed(2));
        const posted = [];
        page.on('request', (r) => r.url().endsWith('/api/shift/cash-movement') && r.method() === 'POST' && posted.push(r));

        await openCashMovement(page);
        await expectDrawerShown(page, before);
        await page.getByRole('button', { name: /^Cash Out \/ Expense/ }).click();
        await cashMovementModal.amount(page).fill(String(overLimit));
        await cashMovementModal.reason(page).fill('E2E over-limit attempt (must be rejected)');

        await expect(page.getByText('Insufficient Drawer Funds')).toBeVisible();
        await expect(page.getByText(
            `Cannot deduct ${pesos(overLimit)}. The cash drawer (Shift #${shift.id}) has only ${pesos(before)} available.`,
        )).toBeVisible();
        await expect(cashMovementModal.submit(page)).toHaveText('Insufficient Drawer Balance');
        await expect(cashMovementModal.submit(page)).toBeDisabled();

        await closeModal(page);
        expect(posted).toHaveLength(0);
        expect(await drawerBalance(page)).toBeCloseTo(before, 2);
    });
});
