import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import { addProductToCart, cashCheckout } from '../fixtures/pos.helpers.js';
import {
    apiCall,
    tabOf,
    gotoInventory,
    getProducts,
    bySku,
    tabCounts,
    expectTabCounts,
    openTab,
    searchBox,
    emptyState,
    findRow,
    rowBySku,
    readPageRows,
    expectedRow,
    expectSwal,
    expectSwalClosed,
    swalConfirm,
    swal,
    openLedger,
    ledgerRows,
    ledgerTab,
    readLedgerRows,
    tabNumber,
    openActivityFeed,
    feedTab,
    readFeedCards,
} from '../fixtures/inventory.helpers.js';

const peso = (pesos) => Number(pesos).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Uses existing seeded products and their real POS transactions (no fake records).
 * 2.2 completes one genuine POS checkout (1 unit) because the Activity Feed only shows the
 * 50 most recent activities. Every product archived here is restored again.
 */
test.describe.serial('Inventory — Sales History, Archive & Restore (Manager)', () => {
    let historyProduct; // seeded product with POS transaction history
    let archiveProduct; // seeded active product used for manual archive/restore
    let saleProduct; // seeded active product sold once through the POS in 2.2
    let saleItems; // [{ invoice, quantity, subtotal, cashier }] for historyProduct

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);

        if (!historyProduct) {
            const [products, sales] = await Promise.all([getProducts(page), apiCall(page, 'get', '/api/transactions?all=true')]);
            const itemsByProduct = new Map();
            for (const sale of sales) {
                for (const item of sale.items || []) {
                    if (!item.product_id) continue;
                    const list = itemsByProduct.get(item.product_id) || [];
                    list.push({ invoice: sale.invoice_number, quantity: item.quantity, subtotal: item.subtotal, cashier: sale.cashier?.name });
                    itemsByProduct.set(item.product_id, list);
                }
            }
            const active = products.filter((p) => p.is_active);
            historyProduct = active
                .filter((p) => itemsByProduct.has(p.id))
                .sort((a, b) => itemsByProduct.get(b.id).length - itemsByProduct.get(a.id).length || a.id - b.id)[0];
            archiveProduct = active
                .filter((p) => !itemsByProduct.has(p.id) && !p.sku.startsWith('E2E-'))
                .sort((a, b) => b.stock_quantity - a.stock_quantity || a.id - b.id)[0];
            saleProduct = active
                .filter((p) => ![historyProduct?.id, archiveProduct?.id].includes(p.id) && !p.sku.startsWith('E2E-') && p.stock_quantity >= 1)
                .sort((a, b) => b.stock_quantity - a.stock_quantity || a.id - b.id)[0];
            expect(historyProduct, 'test data: an active product with POS sales').toBeTruthy();
            expect(archiveProduct, 'test data: an active product without POS sales').toBeTruthy();
            expect(saleProduct, 'test data: a third active, in-stock product').toBeTruthy();
            saleItems = itemsByProduct.get(historyProduct.id);
        }
    });

    test.afterAll(async ({ browser }) => {
        // Safety net: never leave seeded products archived
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await gotoInventory(page);
        const products = await getProducts(page);
        for (const seeded of [historyProduct, archiveProduct].filter(Boolean)) {
            const current = products.find((p) => p.id === seeded.id);
            if (current && !current.is_active) await apiCall(page, 'patch', `/api/products/${seeded.id}/toggle-active`);
        }
        await page.close();
    });

    test('2.1 should list a product\'s POS sales in its Stock Movement ledger', async ({ page }) => {
        expect(saleItems.length, 'within the ledger API limit of 50 sale lines').toBeLessThanOrEqual(50);
        const history = await openLedger(page, await findRow(page, historyProduct.sku), historyProduct);
        const sales = history.timeline.filter((t) => t.type === 'sale');
        expect(sales).toHaveLength(saleItems.length);
        expect(await tabNumber(ledgerTab(page, 'POS Sales'))).toBe(sales.length);
        expect(await tabNumber(ledgerTab(page, 'All Movements'))).toBe(history.timeline.length);

        await ledgerTab(page, 'POS Sales').click();
        await expect(ledgerRows(page)).toHaveCount(sales.length);
        const rows = await readLedgerRows(page);
        expect(rows.every((r) => r.type === 'POS Sale')).toBe(true);

        // Each POS movement corresponds to a real sale line of this product
        // quantity is a decimal column ("1.00"): the delta renders numerically, the description uses the stored value
        const expected = saleItems.map((i) => `${i.invoice}|-${Number(i.quantity)} units|Sold ${i.quantity} unit(s) via POS (₱${peso(i.subtotal / 100)})`).sort();
        const actual = rows.map((r) => `${r.reference}|${r.qty}|${r.description}`).sort();
        expect(actual).toEqual(expected);
        for (const r of rows) {
            const item = saleItems.find((i) => i.invoice === r.reference);
            expect(r.user).toContain(item.cashier);
        }
    });

    test('2.2 should match a POS sale in the Activity Feed to its transaction', async ({ page, browser }) => {
        // The feed shows only the 50 most recent activities, so older seeded sales may be outside it.
        // Complete one real POS checkout as the cashier so a sale is guaranteed to be in the window.
        const cashierContext = await browser.newContext();
        let sale;
        try {
            const cashier = await cashierContext.newPage();
            await loginAsCashier(cashier);
            await ensureActiveShift(cashier);
            await addProductToCart(cashier, saleProduct, 1);
            ({ sale } = await cashCheckout(cashier, saleProduct.price));
        } finally {
            await cashierContext.close();
        }
        const [item] = sale.items;

        await openActivityFeed(page);
        await feedTab(page, 'POS Sales').click();
        const cards = await readFeedCards(page);
        expect(cards.every((c) => c.badge === 'POS Sale')).toBe(true);

        // The feed entry matches the transaction: product, quantity, invoice and cashier
        const card = cards.find((c) => c.reference === sale.invoice_number);
        expect(card, `feed entry for ${sale.invoice_number}`).toBeTruthy();
        expect(card).toEqual({
            badge: 'POS Sale',
            user: sale.cashier.name,
            reference: sale.invoice_number,
            description: `Sold ${item.quantity}x ${saleProduct.name} via POS (Inv: ${sale.invoice_number})`,
        });
        expect(item.product_id).toBe(saleProduct.id);
        expect(Number(item.quantity)).toBe(1);
    });

    test('2.3 should archive instead of delete a product with transaction history', async ({ page }) => {
        const before = await tabCounts(page);
        const original = expectedRow(historyProduct);
        const row = await findRow(page, historyProduct.sku);

        await row.getByTitle('Delete Product').click();
        await expectSwal(page, 'Delete this product?');
        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${historyProduct.id}`) && r.request().method() === 'DELETE'),
            swalConfirm(page, 'Confirm Delete'),
        ]);
        expect(response.status()).toBe(409);
        expect(await response.json()).toMatchObject({ error: 'linked_to_transactions' });

        await expectSwal(page, 'Cannot Delete Product',
            'This product has sales history and cannot be permanently deleted. Would you like to Archive it instead to hide it from the POS terminal?');
        await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${historyProduct.id}/toggle-active`)),
            swalConfirm(page, 'Yes, Archive it!'),
        ]);
        await expectSwal(page, 'Archived!', 'The product has been archived successfully.');
        await swal(page).getByRole('button', { name: 'OK' }).click();
        await expectSwalClosed(page);

        // Archived, not deleted: still in the catalog with its data intact
        const fromTab = tabOf(historyProduct);
        await expectTabCounts(page, { ...before, [fromTab]: before[fromTab] - 1, archived: before.archived + 1 });
        const stored = (await getProducts(page)).find((p) => p.id === historyProduct.id);
        expect(stored).toMatchObject({ sku: historyProduct.sku, name: historyProduct.name, price: historyProduct.price, stock_quantity: historyProduct.stock_quantity, is_active: false });

        await searchBox(page).fill('');
        await openTab(page, fromTab);
        await searchBox(page).fill(historyProduct.sku);
        await expect(emptyState(page)).toBeVisible();
        await searchBox(page).fill('');
        await openTab(page, 'archived');
        await searchBox(page).fill(historyProduct.sku);
        expect((await readPageRows(page))[0]).toEqual(original);

        // Deleting it again while archived is still refused
        await rowBySku(page, historyProduct.sku).getByTitle('Delete Product').click();
        await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${historyProduct.id}`) && r.request().method() === 'DELETE'),
            swalConfirm(page, 'Confirm Delete'),
        ]);
        await expectSwal(page, 'Cannot Delete Product',
            'This product has sales history and is already archived. It cannot be permanently deleted for auditing purposes.');
        await swal(page).getByRole('button', { name: 'OK' }).click();
        await expect(rowBySku(page, historyProduct.sku)).toHaveCount(1);
    });

    test('2.4 should restore the archived product with transaction history', async ({ page }) => {
        await openTab(page, 'archived');
        const row = await findRow(page, historyProduct.sku);
        await row.getByTitle('Restore Product').click();
        await expectSwal(page, 'Restore this product?',
            `Restoring "${historyProduct.name}" will make it available again on the POS sales screen.`);
        await swalConfirm(page, 'Yes, Restore!');
        await expectSwal(page, 'Updated!', 'Product has been successfully restored.');
        await swal(page).getByRole('button', { name: 'OK' }).click();

        await expect(emptyState(page)).toBeVisible();
        expect((await getProducts(page)).find((p) => p.id === historyProduct.id).is_active).toBe(true);
    });

    test('2.5 should manually archive an active product', async ({ page }) => {
        const before = await tabCounts(page);
        const original = expectedRow(archiveProduct);
        const row = await findRow(page, archiveProduct.sku);

        await row.getByTitle('Archive Product').click();
        await expectSwal(page, 'Archive this product?',
            `Archiving "${archiveProduct.name}" will hide it from the POS sales screen, but keep its sales logs.`);
        await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${archiveProduct.id}/toggle-active`)),
            swalConfirm(page, 'Yes, Archive!'),
        ]);
        await expectSwal(page, 'Updated!', 'Product has been successfully archived.');
        await swal(page).getByRole('button', { name: 'OK' }).click();

        const fromTab = tabOf(archiveProduct);
        await expectTabCounts(page, { ...before, [fromTab]: before[fromTab] - 1, archived: before.archived + 1 });

        await searchBox(page).fill('');
        await openTab(page, fromTab);
        await searchBox(page).fill(archiveProduct.sku);
        await expect(emptyState(page)).toBeVisible();

        await searchBox(page).fill('');
        await openTab(page, 'archived');
        await searchBox(page).fill(archiveProduct.sku);
        expect((await readPageRows(page))[0]).toEqual(original);
        await expect(rowBySku(page, archiveProduct.sku).getByTitle('Restore Product')).toBeVisible();
        expect((await getProducts(page)).find((p) => p.id === archiveProduct.id).is_active).toBe(false);
    });

    test('2.6 should restore the manually archived product to its stock tab', async ({ page }) => {
        const before = await tabCounts(page);
        await openTab(page, 'archived');
        const row = await findRow(page, archiveProduct.sku);
        await row.getByTitle('Restore Product').click();
        await expectSwal(page, 'Restore this product?');
        await swalConfirm(page, 'Yes, Restore!');
        await expectSwal(page, 'Updated!', 'Product has been successfully restored.');
        await swal(page).getByRole('button', { name: 'OK' }).click();

        const toTab = tabOf(archiveProduct);
        await expect(emptyState(page)).toBeVisible();
        await expectTabCounts(page, { ...before, [toTab]: before[toTab] + 1, archived: before.archived - 1 });

        await searchBox(page).fill('');
        await openTab(page, toTab);
        await searchBox(page).fill(archiveProduct.sku);
        expect((await readPageRows(page))[0]).toEqual(expectedRow(archiveProduct));
        await expect(rowBySku(page, archiveProduct.sku).getByTitle('Archive Product')).toBeVisible();
        const skuMap = bySku(await getProducts(page));
        expect(skuMap.get(archiveProduct.sku).is_active).toBe(true);
    });
});
