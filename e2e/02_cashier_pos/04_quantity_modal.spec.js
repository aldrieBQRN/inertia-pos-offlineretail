import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    getCatalog,
    pickProducts,
    searchInput,
    catalogItems,
    listRowStock,
    openQtyModal,
    qtyModalForm,
    qtyModalHeading,
    qtyInput,
    cartRows,
    emptyCartMessage,
    expectCartLine,
    expectCartTotals,
} from '../fixtures/pos.helpers.js';

test.describe('POS Quantity Modal & Stock Constraints', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    test('4.1 should prevent adding quantity above available stock', async ({ page }) => {
        const [product] = pickProducts(await getCatalog(page), 1, { minStock: 2 });
        const stock = product.stock_quantity;

        await openQtyModal(page, product);
        await expect(qtyModalForm(page)).toContainText(`Available in stock: ${stock}`);
        await expect(qtyInput(page)).toHaveAttribute('max', String(stock));

        // Excessive quantity: the form refuses to submit (native range validation on the qty input)
        await qtyInput(page).fill(String(stock + 1));
        await qtyModalForm(page).getByRole('button', { name: /^Add to Cart/ }).click();

        await expect(qtyModalHeading(page)).toBeVisible();
        const validity = await qtyInput(page).evaluate((el) => ({
            valid: el.checkValidity(),
            rangeOverflow: el.validity.rangeOverflow,
            message: el.validationMessage,
        }));
        expect(validity.valid).toBe(false);
        expect(validity.rangeOverflow).toBe(true);
        expect(validity.message).toContain(String(stock));
        await expect(emptyCartMessage(page)).toBeVisible();
        await expect(cartRows(page)).toHaveCount(0);

        // Valid quantity is accepted
        const validQty = 2;
        await qtyInput(page).fill(String(validQty));
        expect(await qtyInput(page).evaluate((el) => el.checkValidity())).toBe(true);
        await qtyModalForm(page).getByRole('button', { name: /^Add to Cart/ }).click();
        await expect(qtyModalHeading(page)).toBeHidden();

        await expect(cartRows(page)).toHaveCount(1);
        await expectCartLine(page, { product, qty: validQty });
        await expectCartTotals(page, { subtotal: product.price * validQty });

        // Catalog shows the remaining stock after the cart reservation
        await searchInput(page).fill(product.sku);
        const row = catalogItems(page).filter({ hasText: product.sku });
        await expect(listRowStock(row)).toHaveText(String(stock - validQty));
    });
});
