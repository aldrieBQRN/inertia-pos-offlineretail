import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    getCatalog,
    pickProducts,
    addLinesToCart,
    addProductToCart,
    cartRows,
    cartItemCount,
    emptyCartMessage,
    expectCartLine,
    expectCartTotals,
    discountLineLabel,
    checkoutButton,
} from '../fixtures/pos.helpers.js';

test.describe('POS Cart Operations & Hotkeys', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    test('5.1 should calculate cart totals correctly', async ({ page }) => {
        const products = pickProducts(await getCatalog(page), 3, { minStock: 3 });
        const lines = [
            { product: products[0], qty: 1 },
            { product: products[1], qty: 2 },
            { product: products[2], qty: 3 },
        ];

        const expectedSubtotal = await addLinesToCart(page, lines);

        await expect(cartRows(page)).toHaveCount(3);
        for (const line of lines) {
            await expectCartLine(page, line);
        }
        await expect(cartItemCount(page)).toHaveText('6 items');
        await expect(discountLineLabel(page)).toHaveCount(0);
        await expectCartTotals(page, { subtotal: expectedSubtotal });
    });

    test('5.2 should clear the cart', async ({ page }) => {
        const products = pickProducts(await getCatalog(page), 5);
        const lines = products.map((product) => ({ product, qty: 1 }));
        const subtotal = await addLinesToCart(page, lines);

        await expect(cartRows(page)).toHaveCount(5);
        await expectCartTotals(page, { subtotal });

        await page.locator('button[title^="Clear Cart"]').click();
        await expect(page.getByRole('heading', { name: 'Clear Cart?' })).toBeVisible();
        await page.getByRole('button', { name: 'Yes, clear it!' }).click();

        await expect(cartRows(page)).toHaveCount(0);
        await expect(emptyCartMessage(page)).toBeVisible();
        await expect(cartItemCount(page)).toHaveText('0 items');
        await expectCartTotals(page, { subtotal: 0 });
        await expect(checkoutButton(page)).toBeDisabled();
        await expect(page.getByRole('button', { name: /^Save Order/ })).toBeDisabled();

        // Ready for a new order
        await addProductToCart(page, products[0], 1);
        await expectCartLine(page, { product: products[0], qty: 1 });
        await expect(cartItemCount(page)).toHaveText('1 item');
        await expectCartTotals(page, { subtotal: products[0].price });
        await expect(checkoutButton(page)).toBeEnabled();
    });
});
