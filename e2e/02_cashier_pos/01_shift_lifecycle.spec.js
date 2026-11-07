import { test, expect } from '@playwright/test';
import { loginAsCashier, loginAsAdmin } from '../fixtures/auth.fixture.js';
import {
    money,
    pesos,
    apiCall,
    gotoPos,
    ensureActiveShift,
    adminCashMovementViaApi,
    valueAfterLabel,
    shiftActiveLabel,
    floatLabel,
    drawerLabel,
    noShiftLabel,
    ensureNoActiveShift,
    startFreshShift,
    getCurrentShift,
    getActiveTerminalId,
    getCatalog,
    pickProducts,
    addLinesToCart,
    cashCheckout,
    openCheckout,
    paymentModal,
    referenceInput,
    confirmSettlement,
    startNewOrder,
    openShiftModal,
    closeShiftModal,
    closeShiftViaUi,
    varianceValue,
} from '../fixtures/pos.helpers.js';

/** Adds two in-stock products and completes a cash checkout. Returns the sale total in cents. */
async function makeCashSale(page) {
    const products = pickProducts(await getCatalog(page), 2);
    const total = await addLinesToCart(page, products.map((product) => ({ product, qty: 1 })));
    await cashCheckout(page, total);
    await startNewOrder(page);
    return total;
}

/** Fresh shift + one cash sale; returns the expected drawer amount in cents. */
async function shiftWithOneCashSale(page, floatPesos) {
    await startFreshShift(page, floatPesos, 'Automated E2E close-shift scenario');
    const saleTotal = await makeCashSale(page);
    const expectedDrawer = floatPesos * 100 + saleTotal;
    await expect(drawerLabel(page)).toHaveText(`Drawer: ${money(expectedDrawer)}`);
    return { saleTotal, expectedDrawer };
}

async function expectZReadSummary(page, closed, { floatPesos, saleTotal, expectedDrawer, counted }) {
    await expect(valueAfterLabel(page, 'Starting Cash Float')).toHaveText(pesos(floatPesos));
    await expect(valueAfterLabel(page, '+ Cash Sales Collected')).toHaveText(`+${money(saleTotal)}`);
    await expect(valueAfterLabel(page, 'Expected in Drawer')).toHaveText(money(expectedDrawer));
    await expect(valueAfterLabel(page, 'Actual Count Turnover')).toHaveText(money(counted));

    expect(closed.status).toBe('closed');
    expect(closed.transactions_count).toBe(1);
    expect(Number(closed.starting_cash)).toBeCloseTo(floatPesos, 2);
    expect(Number(closed.cash_sales)).toBeCloseTo(saleTotal / 100, 2);
    expect(Number(closed.expected_cash)).toBeCloseTo(expectedDrawer / 100, 2);
    expect(Number(closed.actual_cash)).toBeCloseTo(counted / 100, 2);
    expect(Number(closed.difference)).toBeCloseTo((counted - expectedDrawer) / 100, 2);
}

async function dismissZRead(page) {
    await page.getByTitle('Close (Esc)').click();
    await expect(closeShiftModal.summaryHeading(page)).toBeHidden();
    await expect(noShiftLabel(page)).toBeVisible();
}

test.describe('POS Shift Lifecycle & Drawer', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
    });

    test('1.1 should open a cashier shift', async ({ page }) => {
        await ensureNoActiveShift(page);
        const before = await getCurrentShift(page);
        const expectedOpening = Number(before.expected_opening_cash);
        const terminalId = await getActiveTerminalId(page);
        const terminal = (await apiCall(page, 'get', '/api/terminals')).find((t) => t.id === terminalId);
        const startingCash = 2007;
        const notes = `E2E opening notes ${Date.now()}`;

        await page.locator('button[title^="Open Shift"]').click();
        await expect(openShiftModal.heading(page)).toBeVisible();
        // The modal pre-fills in an effect after opening, then focuses Starting Cash: wait for that
        await expect(openShiftModal.startingCash(page)).toBeFocused();

        // Modal proposes the calculated drawer balance as the starting float
        await expect(valueAfterLabel(page, 'Calculated Drawer Balance')).toHaveText(pesos(expectedOpening));
        await expect(openShiftModal.startingCash(page)).toHaveValue(expectedOpening.toFixed(2));

        await openShiftModal.startingCash(page).fill(startingCash.toFixed(2));
        await expect(openShiftModal.startingCash(page)).toHaveValue('2007.00');
        const variance = startingCash - expectedOpening;
        if (Math.abs(variance) > 0.01) {
            await expect(valueAfterLabel(page, 'Opening Handover Variance:'))
                .toHaveText(`${variance > 0 ? '+' : ''}${pesos(variance)}`);
        }
        await openShiftModal.notes(page).fill(notes);
        await expect(openShiftModal.notes(page)).toHaveValue(notes);

        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith('/api/shift/open') && r.request().method() === 'POST'),
            openShiftModal.submit(page).click(),
        ]);
        expect(response.status()).toBe(201);
        const { shift } = await response.json();

        const confirmation = page.locator('.swal2-popup');
        await expect(confirmation.getByRole('heading', { name: 'Shift Opened' })).toBeVisible();
        await expect(confirmation).toContainText(`Starting float of 2,007.00 recorded for ${terminal.name}.`);
        await expect(confirmation).toBeHidden({ timeout: 5000 });

        // Terminal header reflects the open shift
        await expect(openShiftModal.heading(page)).toBeHidden();
        await expect(shiftActiveLabel(page)).toHaveText(`Shift #${shift.id} Active`);
        await expect(floatLabel(page)).toHaveText('Float: 2,007.00');
        await expect(drawerLabel(page)).toHaveText('Drawer: 2,007.00');
        await expect(page.locator('button[title^="Close Shift"]')).toBeVisible();

        // Starting cash and notes are recorded on the shift
        const current = await getCurrentShift(page);
        expect(current.has_active_shift).toBe(true);
        expect(current.shift.id).toBe(shift.id);
        expect(current.shift.status).toBe('open');
        expect(current.shift.terminal_id).toBe(terminalId);
        expect(Number(current.shift.starting_cash)).toBe(startingCash);
        expect(current.shift.opening_notes).toBe(notes);
        expect(Number(current.shift.expected_opening_cash)).toBeCloseTo(expectedOpening, 2);
        expect(Number(current.shift.opening_discrepancy)).toBeCloseTo(variance, 2);
    });

    test('1.2 should not expose Cash In/Out in the cashier terminal', async ({ page }) => {
        // Cash movements are a Manager/Admin function on the Shift page (see e2e/05_admin_shifts).
        await ensureActiveShift(page);

        // The shift toolbar is rendered (Close Shift is available) but has no Cash In/Out control
        await expect(page.locator('button[title^="Close Shift"]')).toBeVisible();
        await expect(page.locator('button[title*="Cash In"], button[title*="Cash Out"]')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Cash In|Cash Out|Cash\s*In\/Out/i })).toHaveCount(0);
        await expect(page.locator('.pos-terminal').getByText(/Cash In|Cash Out|In\/Out/i)).toHaveCount(0);

        // The former F4 shortcut does not open the Cash In/Out modal
        await page.keyboard.press('F4');
        await expect(page.getByRole('heading', { name: /Cash In \/ Cash Out/ })).toHaveCount(0);
        await expect(shiftActiveLabel(page)).toBeVisible();
    });

    test('1.3 should close shift with correct counted cash', async ({ page }) => {
        const floatPesos = 1000;
        const { saleTotal, expectedDrawer } = await shiftWithOneCashSale(page, floatPesos);

        const closed = await closeShiftViaUi(page, (expectedDrawer / 100).toFixed(2));
        await expectZReadSummary(page, closed, { floatPesos, saleTotal, expectedDrawer, counted: expectedDrawer });
        await expect(varianceValue(page, 'Cash Drawer Status')).toHaveText('BALANCED (0.00)');
        expect(Number(closed.difference)).toBeCloseTo(0, 2);

        await dismissZRead(page);
    });

    test('1.4 should record an overage', async ({ page }) => {
        const floatPesos = 1000;
        const { saleTotal, expectedDrawer } = await shiftWithOneCashSale(page, floatPesos);
        const counted = expectedDrawer + 5000; // ₱50.00 over

        const closed = await closeShiftViaUi(page, (counted / 100).toFixed(2));
        await expectZReadSummary(page, closed, { floatPesos, saleTotal, expectedDrawer, counted });
        await expect(varianceValue(page, 'Cash Drawer Overage')).toHaveText('+50.00');
        expect(Number(closed.difference)).toBeCloseTo(50, 2);

        await dismissZRead(page);
    });

    test('1.5 should record a shortage', async ({ page }) => {
        const floatPesos = 1000;
        const { saleTotal, expectedDrawer } = await shiftWithOneCashSale(page, floatPesos);
        const counted = expectedDrawer - 2575; // ₱25.75 short

        const closed = await closeShiftViaUi(page, (counted / 100).toFixed(2));
        await expectZReadSummary(page, closed, { floatPesos, saleTotal, expectedDrawer, counted });
        await expect(varianceValue(page, 'Cash Drawer Shortage')).toHaveText('-25.75');
        expect(Number(closed.difference)).toBeCloseTo(-25.75, 2);

        await dismissZRead(page);
    });

    test('1.6 should show correct Float and Drawer values', async ({ page, browser }) => {
        // Drawer = Float + cash sales + cash in − cash out (non-cash sales excluded).
        // Cash in/out is recorded by the Manager/Admin against this cashier's shift.
        const floatCents = 200700;
        const shift = await startFreshShift(page, floatCents / 100, 'Automated E2E float/drawer verification');
        await expect(floatLabel(page)).toHaveText('Float: 2,007.00');
        await expect(drawerLabel(page)).toHaveText('Drawer: 2,007.00');
        let expectedDrawer = floatCents;

        const cashSale = await makeCashSale(page);
        expectedDrawer += cashSale;
        await expect(drawerLabel(page)).toHaveText(`Drawer: ${money(expectedDrawer)}`);

        // GCash sale does not change the cash drawer
        const products = pickProducts(await getCatalog(page), 1);
        const gcashTotal = await addLinesToCart(page, [{ product: products[0], qty: 1 }]);
        await openCheckout(page, gcashTotal);
        await paymentModal(page).getByRole('button', { name: /^E-Wallet/ }).click();
        await paymentModal(page).getByRole('button', { name: /^GCash/ }).click();
        await referenceInput(page).fill(`E2E-DRAWER-${Date.now()}`);
        await confirmSettlement(page);
        await startNewOrder(page);
        await expect(drawerLabel(page)).toHaveText(`Drawer: ${money(expectedDrawer)}`);

        const adminContext = await browser.newContext();
        try {
            const adminPage = await adminContext.newPage();
            await loginAsAdmin(adminPage);

            await adminCashMovementViaApi(adminPage, {
                type: 'cash_in', amount: 50, reason: 'E2E drawer verification cash in',
            });
            expectedDrawer += 5000;
            await gotoPos(page);
            await expect(drawerLabel(page)).toHaveText(`Drawer: ${money(expectedDrawer)}`);

            await adminCashMovementViaApi(adminPage, {
                type: 'cash_out', amount: 25.02, reason: 'E2E drawer verification cash out',
            });
            expectedDrawer -= 2502;
            await gotoPos(page);
            await expect(drawerLabel(page)).toHaveText(`Drawer: ${money(expectedDrawer)}`);
            await expect(floatLabel(page)).toHaveText('Float: 2,007.00');
        } finally {
            await adminContext.close();
        }

        const current = await getCurrentShift(page);
        expect(current.starting_cash).toBeCloseTo(2007, 2);
        expect(current.cash_sales).toBeCloseTo(cashSale / 100, 2);
        expect(current.running_expected_cash).toBeCloseTo(expectedDrawer / 100, 2);
        expect(current.transactions_count).toBe(2);
    });
});
