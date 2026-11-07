import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';
import {
    apiCall,
    gotoInventory,
    getProducts,
    getCategories,
    uniqueToken,
    tabCounts,
    expectTabCounts,
    openTab,
    searchBox,
    emptyState,
    findRow,
    rowBySku,
    readPageRows,
    expectSwal,
    expectSwalClosed,
    swalConfirm,
    swal,
    productField,
    fillProductForm,
    saveProductForm,
    openLedger,
    ledgerRows,
    ledgerTab,
    ledgerSearch,
    ledgerEmpty,
    readLedgerRows,
    tabNumber,
    openActivityFeed,
    feedTab,
    feedCards,
    feedSearch,
    feedEmpty,
    readFeedCards,
    captureDownload,
    readXlsx,
} from '../fixtures/inventory.helpers.js';

/**
 * Full product lifecycle on a dedicated temporary product (no transaction history):
 * add → edit → restock → stock movement ledger → activity feed → delete.
 */
test.describe.serial('Inventory — Product Lifecycle (Admin)', () => {
    const token = uniqueToken();
    const manager = TEST_ADMIN.name;
    const created = {
        sku: `E2E-INV-${token}`,
        name: `E2E Inventory Item ${token}`,
        stock_quantity: 0,
        cost_price: '45.50',
        price: '99.75',
        wholesale_price: '80.25',
    };
    const edited = { name: `E2E Edited Item ${token}`, cost_price: '50.00', price: '120.40', wholesale_price: '95.10' };
    const RESTOCK_QTY = 5;
    let categoryA;
    let categoryB;
    let product;

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);
    });

    test.afterAll(async ({ browser }) => {
        // Safety net: remove the temporary product if a test failed before the delete step
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await gotoInventory(page);
        const leftover = (await getProducts(page)).find((p) => p.sku === created.sku);
        if (leftover) await apiCall(page, 'delete', `/api/products/${leftover.id}`);
        await page.close();
    });

    test('1.1 should add a product with the entered details', async ({ page }) => {
        const categories = await getCategories(page);
        [categoryA, categoryB] = categories;
        const before = await tabCounts(page);

        await page.getByRole('button', { name: 'Add Product' }).click();
        await expect(page.getByRole('heading', { name: 'New Product' })).toBeVisible();
        await expect(page.locator('#is_active_checkbox')).toBeChecked();
        await fillProductForm(page, { ...created, category_id: categoryA.id });
        product = await saveProductForm(page);

        // Stored exactly as entered (prices in cents)
        expect(product).toMatchObject({
            sku: created.sku,
            name: created.name,
            category_id: categoryA.id,
            price: 9975,
            cost_price: 4550,
            wholesale_price: 8025,
            stock_quantity: 0,
            is_active: true,
        });

        // Listed with the entered details and counted under Out of Stock
        await expectTabCounts(page, { ...before, all: before.all + 1, out_of_stock: before.out_of_stock + 1 });
        await findRow(page, created.sku);
        expect((await readPageRows(page))[0]).toEqual({
            sku: created.sku,
            name: created.name,
            category: categoryA.name,
            cost: '45.50',
            retail: '99.75',
            wholesale: '80.25',
            stock: 0,
        });

        // Findable by name, and only under Out of Stock
        await searchBox(page).fill(created.name);
        await expect(rowBySku(page, created.sku)).toHaveCount(1);
        for (const [tab, present] of [['out_of_stock', 1], ['low_stock', 0], ['in_stock', 0], ['archived', 0]]) {
            await page.locator(`button[data-tab="${tab}"]`).click();
            await expect(rowBySku(page, created.sku)).toHaveCount(present);
        }
    });

    test('1.2 should edit the product and show only the updated values', async ({ page }) => {
        const row = await findRow(page, created.sku);
        await row.getByTitle('Edit Product').click();
        await expect(page.getByRole('heading', { name: 'Update Product' })).toBeVisible();

        // Form is pre-filled with the saved values
        await expect(productField(page, 'sku')).toHaveValue(created.sku);
        await expect(productField(page, 'name')).toHaveValue(created.name);
        await expect(productField(page, 'category_id')).toHaveValue(String(categoryA.id));
        await expect(productField(page, 'stock_quantity')).toHaveValue('0');
        await expect(productField(page, 'cost_price')).toHaveValue(created.cost_price);
        await expect(productField(page, 'price')).toHaveValue(created.price);
        await expect(productField(page, 'wholesale_price')).toHaveValue(created.wholesale_price);

        await fillProductForm(page, { ...edited, category_id: categoryB.id });
        product = await saveProductForm(page);
        expect(product).toMatchObject({
            id: product.id,
            sku: created.sku,
            name: edited.name,
            category_id: categoryB.id,
            price: 12040,
            cost_price: 5000,
            wholesale_price: 9510,
            stock_quantity: 0,
        });

        await findRow(page, created.sku);
        expect((await readPageRows(page))[0]).toEqual({
            sku: created.sku,
            name: edited.name,
            category: categoryB.name,
            cost: '50.00',
            retail: '120.40',
            wholesale: '95.10',
            stock: 0,
        });

        // Old name is gone; new name finds the product
        await searchBox(page).fill(created.name);
        await expect(emptyState(page)).toBeVisible();
        await searchBox(page).fill(edited.name);
        await expect(rowBySku(page, created.sku)).toHaveCount(1);
    });

    test('1.3 should restock the product by exactly the entered quantity', async ({ page }) => {
        const before = await tabCounts(page);
        const row = await findRow(page, created.sku);
        await row.getByTitle('Restock Inventory').click();

        await expectSwal(page, `Restock: ${edited.name}`);
        await expect(swal(page)).toContainText(/Current Stock:\s*0 Left/);
        await expect(swal(page)).toContainText(/Cost Price:\s*50\.00/);
        await swal(page).locator('input.swal2-input').fill(String(RESTOCK_QTY));
        await expect(page.locator('#swal-total-cost')).toHaveText('250.00');

        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${product.id}/stock`) && r.request().method() === 'POST'),
            swalConfirm(page, 'Update Stock'),
        ]);
        expect(await response.json()).toMatchObject({ new_stock: RESTOCK_QTY });
        await expectSwal(page, 'Stock Updated');

        // 0 + 5 = 5: moves from Out of Stock to Low Stock Alerts
        await expect(row.locator('td').nth(6)).toHaveText(`${RESTOCK_QTY} Left`);
        await expectTabCounts(page, {
            ...before, out_of_stock: before.out_of_stock - 1, low_stock: before.low_stock + 1,
        });
        await searchBox(page).fill('');
        await openTab(page, 'low_stock');
        await searchBox(page).fill(created.sku);
        await expect(rowBySku(page, created.sku)).toHaveCount(1);
        expect((await getProducts(page)).find((p) => p.id === product.id).stock_quantity).toBe(RESTOCK_QTY);
    });

    test('1.4 should record creation, edit and restock in the Stock Movement ledger', async ({ page }) => {
        const row = await findRow(page, created.sku);
        const history = await openLedger(page, row, product);
        await expect(page.getByText(`SKU: ${created.sku}`, { exact: true })).toBeVisible();
        await expect(page.getByText(`${RESTOCK_QTY} units`, { exact: true })).toBeVisible();

        // Tab counts
        await expect(ledgerRows(page)).toHaveCount(3);
        expect(await tabNumber(ledgerTab(page, 'All Movements'))).toBe(3);
        expect(await tabNumber(ledgerTab(page, 'POS Sales'))).toBe(0);
        expect(await tabNumber(ledgerTab(page, 'Restocks'))).toBe(1);
        expect(await tabNumber(ledgerTab(page, 'Initial Catalog'))).toBe(1);
        expect(await tabNumber(ledgerTab(page, 'Adjustments'))).toBe(1);
        expect(history.timeline).toHaveLength(3);

        // Each movement matches the operation that created it
        const rows = await readLedgerRows(page);
        const find = (type) => rows.find((r) => r.type === type);
        expect(find('Initial Catalog')).toMatchObject({
            qty: '0 units',
            description: `Created product: ${created.name} (SKU: ${created.sku})`,
        });
        expect(find('Adjustment')).toMatchObject({
            qty: '0 units',
            description: `Updated product: ${edited.name} (SKU: ${created.sku})`,
        });
        expect(find('Restock')).toMatchObject({
            qty: `+${RESTOCK_QTY} units`,
            description: `Restocked ${RESTOCK_QTY} unit(s) for: ${edited.name} (Stock: 0 → ${RESTOCK_QTY})`,
        });
        for (const r of rows) {
            expect(r.user).toContain(manager);
            expect(r.reference).toMatch(/^LOG-\d{5}$/);
        }

        // Filter tabs
        await ledgerTab(page, 'POS Sales').click();
        await expect(ledgerEmpty(page)).toBeVisible();
        await ledgerTab(page, 'Restocks').click();
        await expect(ledgerRows(page)).toHaveCount(1);
        expect((await readLedgerRows(page))[0].type).toBe('Restock');
        await ledgerTab(page, 'Initial Catalog').click();
        await expect(ledgerRows(page)).toHaveCount(1);
        expect((await readLedgerRows(page))[0].type).toBe('Initial Catalog');
        await ledgerTab(page, 'Adjustments').click();
        await expect(ledgerRows(page)).toHaveCount(1);
        expect((await readLedgerRows(page))[0].type).toBe('Adjustment');
        await ledgerTab(page, 'All Movements').click();
        await expect(ledgerRows(page)).toHaveCount(3);
        await expect(page.getByText('3 movement entries in product audit ledger')).toBeVisible();
    });

    test('1.5 should search the Stock Movement ledger', async ({ page }) => {
        await openLedger(page, await findRow(page, created.sku), product);

        await ledgerSearch(page).fill('Restocked');
        await expect(ledgerRows(page)).toHaveCount(1);
        expect((await readLedgerRows(page))[0].type).toBe('Restock');

        await ledgerSearch(page).fill(manager);
        await expect(ledgerRows(page)).toHaveCount(3);

        await ledgerSearch(page).fill(`zz-no-movement-${token}`);
        await expect(ledgerEmpty(page)).toBeVisible();
        await expect(ledgerRows(page)).toHaveCount(0);

        await ledgerSearch(page).fill('');
        await expect(ledgerRows(page)).toHaveCount(3);
    });

    test('1.6 should export the Stock Movement ledger to Excel', async ({ page }) => {
        await openLedger(page, await findRow(page, created.sku), product);
        const { path, name } = await captureDownload(page, () => page.getByRole('button', { name: 'Export Excel' }).click());

        const safeName = edited.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        expect(name).toMatch(new RegExp(`^${safeName}_Stock_Ledger_.+\\.xlsx$`));
        const { rows } = await readXlsx(path);
        const cells = rows.flat();
        expect(cells.some((c) => c.includes(created.sku))).toBe(true);
        for (const description of [
            `Created product: ${created.name} (SKU: ${created.sku})`,
            `Updated product: ${edited.name} (SKU: ${created.sku})`,
            `Restocked ${RESTOCK_QTY} unit(s) for: ${edited.name} (Stock: 0 → ${RESTOCK_QTY})`,
        ]) {
            expect(cells, `export contains "${description}"`).toContain(description);
        }
    });

    test('1.7 should show Activity Feed tab counts that match the listed activities', async ({ page }) => {
        const logs = await openActivityFeed(page);
        const tabs = { 'POS Sales': 'POS Sale', Restocks: 'Restock', 'New Items': 'New Product', Edits: 'Adjustment', Categories: 'Category' };

        expect(await tabNumber(feedTab(page, 'All'))).toBe(logs.length);
        await expect(feedCards(page)).toHaveCount(logs.length);

        let sum = 0;
        for (const [label, badge] of Object.entries(tabs)) {
            const count = await tabNumber(feedTab(page, label));
            await feedTab(page, label).click();
            await expect(feedCards(page).or(feedEmpty(page)).first()).toBeVisible();
            const cards = await readFeedCards(page);
            expect(cards, `${label}: tab count equals listed activities`).toHaveLength(count);
            expect(cards.every((c) => c.badge === badge), `${label}: every activity is a "${badge}"`).toBe(true);
            sum += count;
        }
        expect(sum, 'every activity belongs to exactly one tab').toBe(logs.length);
    });

    test('1.8 should show the test product activities with correct details and support search', async ({ page }) => {
        await openActivityFeed(page);
        await feedSearch(page).fill(token);
        const cards = await readFeedCards(page);
        const card = (prefix) => cards.find((c) => c.description.startsWith(prefix));

        // New product: exactly one entry (the audit log), no duplicate catalog-registration entry
        expect(card('Created product:')).toMatchObject({
            badge: 'New Product',
            user: manager,
            description: `Created product: ${created.name} (SKU: ${created.sku})`,
        });
        expect(card('Registered new product:')).toBeUndefined();
        expect(cards.filter((c) => c.badge === 'New Product')).toHaveLength(1);
        // Edit
        expect(card('Updated product:')).toMatchObject({
            badge: 'Adjustment',
            user: manager,
            description: `Updated product: ${edited.name} (SKU: ${created.sku})`,
        });
        // Restock
        expect(card('Restocked')).toMatchObject({
            badge: 'Restock',
            user: manager,
            description: `Restocked ${RESTOCK_QTY} unit(s) for: ${edited.name} (Stock: 0 → ${RESTOCK_QTY})`,
        });
        expect(card('Restocked').reference).toMatch(/^LOG-\d{5}$/);
        // Unrelated activities are excluded
        expect(cards.every((c) => c.description.includes(token))).toBe(true);

        // Each test activity is listed under its tab
        for (const [label, prefix] of [['New Items', 'Created product:'], ['Edits', 'Updated product:'], ['Restocks', 'Restocked']]) {
            await feedTab(page, label).click();
            await expect(feedCards(page).filter({ hasText: prefix }).filter({ hasText: token })).toHaveCount(1);
        }
        await feedTab(page, 'All').click();

        await feedSearch(page).fill(`zz-no-activity-${token}`);
        await expect(feedEmpty(page)).toBeVisible();
        await expect(feedCards(page)).toHaveCount(0);

        await feedSearch(page).fill('');
        expect(await feedCards(page).count()).toBe(await tabNumber(feedTab(page, 'All')));

        // The Excel export classifies the same activities the same way (columns: Date, Type, Staff, Description, Ref)
        const { path, name } = await captureDownload(page, () => page.getByRole('button', { name: 'Export Excel' }).click());
        expect(name).toMatch(/_Inventory_Activity_.+\.xlsx$/);
        const { rows } = await readXlsx(path);
        const exportedType = (prefix) => rows.find((r) => r[3]?.startsWith(prefix) && r[3].includes(token))?.[1];
        expect(exportedType('Created product:')).toBe('New Product');
        expect(exportedType('Updated product:')).toBe('Adjustment');
        expect(exportedType('Restocked')).toBe('Restock');
    });

    test('1.9 should permanently delete a product without transaction history', async ({ page }) => {
        const before = await tabCounts(page);
        const row = await findRow(page, created.sku);
        await row.getByTitle('Delete Product').click();
        await expectSwal(page, 'Delete this product?',
            'This action will remove the item from the inventory. Note: Items with sales history cannot be deleted.');

        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/products/${product.id}`) && r.request().method() === 'DELETE'),
            swalConfirm(page, 'Confirm Delete'),
        ]);
        expect(response.status()).toBe(200);
        await expectSwal(page, 'Deleted!', 'Product successfully removed.');
        await swal(page).getByRole('button', { name: 'OK' }).click();
        await expectSwalClosed(page);

        // Gone from the active catalog and NOT archived
        await expect(emptyState(page)).toBeVisible();
        await expectTabCounts(page, { ...before, all: before.all - 1, low_stock: before.low_stock - 1 });
        await openTab(page, 'archived');
        await searchBox(page).fill(created.sku);
        await expect(emptyState(page)).toBeVisible();
        expect((await getProducts(page)).some((p) => p.sku === created.sku)).toBe(false);
    });
});
