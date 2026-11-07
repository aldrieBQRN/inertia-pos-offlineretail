import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    money,
    getCatalog,
    pickProducts,
    addLinesToCart,
    cartRows,
    cartItemCount,
    emptyCartMessage,
    expectCartLine,
    expectCartTotals,
    recallButton,
    expectRecallBadge,
    getHeldOrders,
} from '../fixtures/pos.helpers.js';

const recallHeading = (page) => page.getByRole('heading', { name: /Recall Saved Orders/ });
const heldOrderCard = (page, note) => page.locator('[data-held-order-index]').filter({ hasText: note });

/** Opens Recall Saved Orders and waits for the list refresh it triggers (GET /api/held-orders). */
async function openRecallModal(page) {
    await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/held-orders') && r.request().method() === 'GET'),
        recallButton(page).click(),
    ]);
    await expect(recallHeading(page)).toBeVisible();
}

async function saveCurrentOrder(page, note) {
    await page.getByRole('button', { name: /^Save Order/ }).click();
    const dialog = page.locator('.swal2-popup');
    await expect(dialog.getByRole('heading', { name: 'Save Order' })).toBeVisible();
    await expect(dialog.getByText('Reference Note (Optional)')).toBeVisible();
    await dialog.locator('input.swal2-input').fill(note);

    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/held-orders') && r.request().method() === 'POST'),
        dialog.getByRole('button', { name: 'Save Order' }).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: 'Order Saved' })).toBeVisible();
}

test.describe('POS Held Orders (Park & Recall)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    test('7.1 should save an order and delete it from Recall Saved Orders', async ({ page }) => {
        const products = pickProducts(await getCatalog(page), 2, { minStock: 2 });
        const lines = [{ product: products[0], qty: 2 }, { product: products[1], qty: 1 }];
        const note = `E2E Save ${Date.now()}`;
        const heldBefore = (await getHeldOrders(page)).length;

        const subtotal = await addLinesToCart(page, lines);
        await saveCurrentOrder(page, note);

        // Cart is parked: cleared, and the Recall counter increments
        await expect(emptyCartMessage(page)).toBeVisible();
        await expectRecallBadge(page, heldBefore + 1);

        // Saved order persisted with its products
        const saved = (await getHeldOrders(page)).find((o) => o.reference_note === note);
        expect(saved).toBeTruthy();
        expect(saved.total_amount).toBe(subtotal);
        expect(saved.cart_data.map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, price: i.price })))
            .toEqual(lines.map(({ product, qty }) => ({ id: product.id, name: product.name, quantity: qty, price: product.price })));

        // Visible in Recall Saved Orders with its total and item count
        await openRecallModal(page);
        const card = heldOrderCard(page, note);
        await expect(card).toHaveCount(1);
        await expect(card).toContainText(money(subtotal));
        await expect(card).toContainText('3 items');

        // Delete it
        await card.getByTitle('Discard (Backspace)').click();
        await expect(page.getByRole('heading', { name: 'Discard Order?' })).toBeVisible();
        const [deleted] = await Promise.all([
            page.waitForResponse((r) => r.url().includes(`/api/held-orders/${saved.id}`) && r.request().method() === 'DELETE'),
            page.getByRole('button', { name: 'Yes, discard it' }).click(),
        ]);
        expect(deleted.ok()).toBeTruthy();

        await expect(card).toHaveCount(0);
        expect((await getHeldOrders(page)).some((o) => o.id === saved.id)).toBe(false);

        await page.getByRole('button', { name: /^Cancel/ }).click();
        await expect(recallHeading(page)).toBeHidden();
        await expectRecallBadge(page, heldBefore);
    });

    test('7.2 should recall a saved order into the cart', async ({ page }) => {
        const products = pickProducts(await getCatalog(page), 5, { minStock: 2 });
        const lines = products.map((product, i) => ({ product, qty: i % 2 === 0 ? 1 : 2 }));
        const note = `E2E Recall ${Date.now()}`;
        const heldBefore = (await getHeldOrders(page)).length;

        const subtotal = await addLinesToCart(page, lines);
        await expect(cartRows(page)).toHaveCount(5);
        await saveCurrentOrder(page, note);
        await expect(emptyCartMessage(page)).toBeVisible();
        await expectRecallBadge(page, heldBefore + 1);

        await openRecallModal(page);
        const card = heldOrderCard(page, note);
        await expect(card).toContainText(money(subtotal));
        await expect(card).toContainText('7 items');

        await card.click();
        await card.getByRole('button', { name: 'Recall', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Recall Order?' })).toBeVisible();
        await page.getByRole('button', { name: 'Yes, recall' }).click();

        await expect(recallHeading(page)).toBeHidden();
        await expect(page.getByRole('heading', { name: 'Order Recalled' })).toBeVisible();

        // Products, quantities and amounts are restored
        await expect(cartRows(page)).toHaveCount(5);
        for (const line of lines) {
            await expectCartLine(page, line);
        }
        await expect(cartItemCount(page)).toHaveText('7 items');
        await expectCartTotals(page, { subtotal });

        // Recalling consumes the saved order
        await expectRecallBadge(page, heldBefore);
        await expect.poll(async () => (await getHeldOrders(page)).some((o) => o.reference_note === note)).toBe(false);
    });
});
