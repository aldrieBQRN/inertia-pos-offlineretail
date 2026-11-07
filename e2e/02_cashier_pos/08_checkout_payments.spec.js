import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    money,
    getCatalog,
    pickProducts,
    addLinesToCart,
    addProductToCart,
    expectCartLine,
    openCheckout,
    paymentModal,
    cashReceivedInput,
    referenceInput,
    confirmSettlementButton,
    confirmSettlement,
    cashAboveTotal,
    cashCheckout,
    getTransaction,
    valueAfterLabel,
    successHeading,
    startNewOrder,
    emptyCartMessage,
} from '../fixtures/pos.helpers.js';

/** Adds two in-stock products (qty 1 each) and returns the expected total in cents. */
async function addTwoProducts(page) {
    const products = pickProducts(await getCatalog(page), 2);
    return addLinesToCart(page, products.map((product) => ({ product, qty: 1 })));
}

const REFERENCE_METHODS = [
    { title: 'GCash', category: /^E-Wallet/, button: /^GCash/, method: 'gcash', placeholder: 'GCASH Reference No...' },
    { title: 'Maya', category: /^E-Wallet/, button: /^Maya/, method: 'maya', placeholder: 'MAYA Reference No...' },
    { title: 'credit card', category: /^Card/, button: /^Credit/, method: 'credit_card', placeholder: 'Credit Card Approval Code...' },
    { title: 'debit card', category: /^Card/, button: /^Debit/, method: 'debit_card', placeholder: 'Debit/BancNet Terminal Ref...' },
];

test.describe('POS Checkout & Multi-Payment Flow', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    test('8.1 should complete cash checkout', async ({ page }) => {
        const total = await addTwoProducts(page);
        await openCheckout(page, total);

        // Cash is the default channel, pre-filled with the exact amount due
        await expect(cashReceivedInput(page)).toHaveValue(money(total));
        await expect(valueAfterLabel(page, 'Change Due')).toHaveText('0.00');

        // Insufficient cash shows a shortage and blocks settlement
        const short = total - 100;
        await cashReceivedInput(page).fill(String(short / 100));
        await expect(valueAfterLabel(page, 'Shortage')).toHaveText(money(total - short));
        await expect(confirmSettlementButton(page)).toBeDisabled();

        // Enough cash → change is computed
        const cash = cashAboveTotal(total);
        await cashReceivedInput(page).fill(String(cash / 100));
        await expect(cashReceivedInput(page)).toHaveValue(money(cash).replace(/\.00$/, ''));
        await expect(valueAfterLabel(page, 'Change Due')).toHaveText(money(cash - total));
        await expect(confirmSettlementButton(page)).toBeEnabled();

        const { sale_id } = await confirmSettlement(page);
        await expect(valueAfterLabel(page, 'Total Settled')).toHaveText(`₱${money(total)}`);
        await expect(valueAfterLabel(page, 'Cash Tendered')).toHaveText(`₱${money(cash)}`);
        await expect(valueAfterLabel(page, 'Change Given')).toHaveText(`₱${money(cash - total)}`);

        const sale = await getTransaction(page, sale_id);
        expect(sale.payment_method).toBe('cash');
        expect(sale.status).toBe('completed');
        expect(Number(sale.total_amount)).toBe(total);
        expect(Number(sale.cash_given)).toBe(cash);
        expect(Math.abs(Number(sale.change) - (cash - total))).toBeLessThanOrEqual(1);

        await startNewOrder(page);
    });

    test('8.2 should show printer-not-connected alert when printing a cash receipt', async ({ page }) => {
        const total = await addTwoProducts(page);
        await cashCheckout(page, total);
        await expect(successHeading(page)).toBeVisible();

        // No printer has been paired in this browser profile (printer-settings-storage is empty)
        await page.getByRole('button', { name: /^Print Receipt/ }).click();
        const alert = page.locator('.swal2-popup');
        await expect(alert.getByRole('heading', { name: 'Printer Not Connected' })).toBeVisible();
        await expect(alert).toContainText('You need to pair a printer to generate this receipt.');
        await expect(alert.getByRole('button', { name: /^Pair (USB|Bluetooth) Printer$/ })).toBeVisible();

        await alert.getByRole('button', { name: 'Cancel' }).click();
        await expect(alert).toBeHidden();

        // Receipt dialog is still available; start a new order
        await expect(successHeading(page)).toBeVisible();
        await startNewOrder(page);

        const [product] = pickProducts(await getCatalog(page), 1);
        await addProductToCart(page, product, 1);
        await expectCartLine(page, { product, qty: 1 });
    });

    test('8.3 should print receipt on a connected printer', async () => {
        test.skip(true,
            'BLOCKED/MANUAL: receipts are sent to a thermal printer over WebUSB (desktop) or Web Bluetooth (mobile) '
            + 'via usePrinterStore.executePrint. Headless Chromium has no USB/Bluetooth device and the suite has no '
            + 'printer mock, so successful printing must be verified manually with real hardware.');
    });

    for (const pm of REFERENCE_METHODS) {
        test(`8.${4 + REFERENCE_METHODS.indexOf(pm)} should complete ${pm.title} checkout`, async ({ page }) => {
            const total = await addTwoProducts(page);
            const reference = `E2E-${pm.method.toUpperCase()}-${Date.now()}`;

            await openCheckout(page, total);
            await paymentModal(page).getByRole('button', { name: pm.category }).click();
            await paymentModal(page).getByRole('button', { name: pm.button }).click();
            await expect(referenceInput(page)).toHaveAttribute('placeholder', pm.placeholder);

            // Reference number is required
            await expect(confirmSettlementButton(page)).toBeDisabled();
            await referenceInput(page).fill(reference);
            await expect(referenceInput(page)).toHaveValue(reference);
            await expect(confirmSettlementButton(page)).toBeEnabled();

            const { sale_id } = await confirmSettlement(page);
            await expect(valueAfterLabel(page, 'Total Settled')).toHaveText(`₱${money(total)}`);
            await expect(valueAfterLabel(page, 'Channel')).toHaveText(pm.method);
            await expect(valueAfterLabel(page, 'Ref Code')).toHaveText(reference);

            const sale = await getTransaction(page, sale_id);
            expect(sale.payment_method).toBe(pm.method);
            expect(sale.payment_reference).toBe(reference);
            expect(Number(sale.total_amount)).toBe(total);
            expect(sale.cash_given).toBeNull();

            await startNewOrder(page);
            await expect(emptyCartMessage(page)).toBeVisible();
        });
    }
});
