import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import {
    TABS,
    tabOf,
    money,
    gotoInventory,
    getProducts,
    bySku,
    tabButton,
    tabCount,
    tabCounts,
    openTab,
    searchBox,
    categoryFilter,
    sortSelect,
    emptyState,
    pageLabel,
    productRows,
    productCards,
    readPageRows,
    readAllRows,
    readCards,
    expectedRow,
    expectListSize,
} from '../fixtures/inventory.helpers.js';

test.describe('Inventory — Catalog Tabs, Sort, Views & Search (Manager)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);
    });

    test('4.1 should show catalog tab counts that match the products listed under each tab', async ({ page }) => {
        const products = await getProducts(page);
        const skuMap = bySku(products);
        const expected = { all: products.length, in_stock: 0, low_stock: 0, out_of_stock: 0, archived: 0 };
        for (const p of products) expected[tabOf(p)]++;

        // Badge counts follow the application's stock thresholds
        const counts = await tabCounts(page);
        expect(counts).toEqual(expected);
        expect(counts.all).toBe(counts.in_stock + counts.low_stock + counts.out_of_stock + counts.archived);

        for (const key of Object.keys(TABS)) {
            await openTab(page, key, counts[key]);
            await expect(tabButton(page, key)).toContainText(TABS[key]);

            const rows = await readAllRows(page);
            expect(rows, `${TABS[key]} row count`).toHaveLength(counts[key]);
            expect(new Set(rows.map((r) => r.sku)).size).toBe(rows.length);

            for (const row of rows) {
                const product = skuMap.get(row.sku);
                expect(product, `row ${row.sku} exists in the catalog`).toBeTruthy();
                // Displayed product information matches the stored record
                expect(row).toEqual(expectedRow(product));
                if (key !== 'all') expect(tabOf(product), `${row.sku} belongs to ${TABS[key]}`).toBe(key);
            }

            if (key === 'all') {
                // All Catalog lists active and archived products alike (existing behaviour)
                expect(rows.map((r) => r.sku).sort()).toEqual(products.map((p) => p.sku).sort());
            }
            if (key === 'in_stock') expect(rows.every((r) => r.stock > 10)).toBe(true);
            if (key === 'low_stock') expect(rows.every((r) => r.stock > 0 && r.stock <= 10)).toBe(true);
            if (key === 'out_of_stock') expect(rows.every((r) => r.stock <= 0)).toBe(true);
            if (counts[key] === 0) await expect(emptyState(page)).toBeVisible();
        }
    });

    test('4.2 should sort products by every available sort option', async ({ page }) => {
        test.setTimeout(180000); // walks every page of the catalog for all 10 sort options
        const options = await sortSelect(page).locator('option').evaluateAll((opts) => opts.map((o) => ({ value: o.value, label: o.textContent })));
        expect(options).toEqual([
            { value: 'newest', label: 'Sort: Default' },
            { value: 'created_desc', label: 'Sort: Newest Added' },
            { value: 'created_asc', label: 'Sort: Oldest Added' },
            { value: 'name_asc', label: 'Sort: Name (A-Z)' },
            { value: 'name_desc', label: 'Sort: Name (Z-A)' },
            { value: 'stock_desc', label: 'Sort: Stock (High to Low)' },
            { value: 'stock_asc', label: 'Sort: Stock (Low to High)' },
            { value: 'price_desc', label: 'Sort: Price (High to Low)' },
            { value: 'price_asc', label: 'Sort: Price (Low to High)' },
            { value: 'margin_desc', label: 'Sort: Margin (High to Low)' },
        ]);
        await expect(sortSelect(page)).toHaveValue('newest');

        const skuMap = bySku(await getProducts(page));
        const margin = (p) => (p.price ? (p.price - (Number(p.cost_price) || 0)) / p.price : 0);
        const keyOf = {
            newest: (p) => p.id,
            created_desc: (p) => new Date(p.created_at).getTime(),
            created_asc: (p) => new Date(p.created_at).getTime(),
            stock_desc: (p) => Number(p.stock_quantity),
            stock_asc: (p) => Number(p.stock_quantity),
            price_desc: (p) => Number(p.price),
            price_asc: (p) => Number(p.price),
            margin_desc: margin,
        };
        const descending = ['newest', 'created_desc', 'stock_desc', 'price_desc', 'margin_desc'];

        const orders = {};
        for (const { value } of options) {
            await sortSelect(page).selectOption(value);
            await expect(pageLabel(page)).toHaveText(/^Page 1 of/);
            const rows = await readAllRows(page);
            orders[value] = rows.map((r) => r.sku);
            const items = rows.map((r) => skuMap.get(r.sku));

            if (value === 'name_asc' || value === 'name_desc') {
                // Compare in the browser so localeCompare matches the app exactly
                const sorted = await page.evaluate(({ names, desc }) => names.every((n, i) =>
                    i === 0 || (desc ? names[i - 1].localeCompare(n) >= 0 : names[i - 1].localeCompare(n) <= 0)),
                { names: items.map((p) => p.name), desc: value === 'name_desc' });
                expect(sorted, `${value} order`).toBe(true);
            } else {
                const keys = items.map(keyOf[value]);
                const desc = descending.includes(value);
                for (let i = 1; i < keys.length; i++) {
                    expect(desc ? keys[i - 1] >= keys[i] : keys[i - 1] <= keys[i], `${value} at position ${i}`).toBe(true);
                }
                if (value === 'newest') expect(new Set(keys).size).toBe(keys.length); // strict id order
            }
        }

        // Changing from Default actually reorders the list
        expect(orders.name_asc).not.toEqual(orders.newest);
        expect(orders.price_desc).not.toEqual(orders.newest);
    });

    test('4.3 should switch between list and card views without losing filters', async ({ page }) => {
        const products = await getProducts(page);
        // A search term that matches a small, card-page-sized set of products
        const term = products
            .map((p) => p.name.split(' ')[0].toLowerCase())
            .find((t) => {
                const n = products.filter((p) => p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).length;
                return t.length >= 3 && n >= 2 && n <= 9;
            });
        expect(term, 'test data: a search term matching 2-9 products').toBeTruthy();
        const expected = products
            .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term))
            .sort((a, b) => b.id - a.id);

        await page.getByTitle('List View').click();
        await searchBox(page).fill(term);
        await expectListSize(page, expected.length);

        for (let round = 1; round <= 2; round++) {
            // List view: rows with full details
            const rows = await readPageRows(page);
            expect(rows.map((r) => r.sku)).toEqual(expected.map((p) => p.sku));
            rows.forEach((row, i) => expect(row).toEqual(expectedRow(expected[i])));
            await expect(productCards(page)).toHaveCount(0);

            // Card view: same products, same details, same search
            await page.getByTitle('Card View').click();
            await expect(productRows(page)).toHaveCount(0);
            await expect(productCards(page)).toHaveCount(expected.length);
            expect(await page.evaluate(() => localStorage.getItem('pos_inv_view_mode'))).toBe('grid');
            await expect(searchBox(page)).toHaveValue(term);

            const cards = await readCards(page);
            expect(cards.map((c) => c.sku)).toEqual(expected.map((p) => p.sku));
            cards.forEach((card, i) => {
                const p = expected[i];
                expect(card.name).toBe(p.name);
                expect(card.stock).toBe(Number(p.stock_quantity));
                expect(card.archived).toBe(!p.is_active);
                expect(card.text).toContain(money(p.price));
                expect(card.text).toContain(p.category?.name || 'General');
            });

            await page.getByTitle('List View').click();
            await expectListSize(page, expected.length);
            expect(await page.evaluate(() => localStorage.getItem('pos_inv_view_mode'))).toBe('table');
            await expect(searchBox(page)).toHaveValue(term);
        }
    });

    test('4.4 should search products by name and show an empty state for no matches', async ({ page }) => {
        const products = await getProducts(page);
        const unique = products.find((p) => {
            const n = p.name.toLowerCase();
            return products.filter((o) => o.name.toLowerCase().includes(n) || o.sku.toLowerCase().includes(n)).length === 1;
        });
        expect(unique, 'test data: a product with a unique name').toBeTruthy();
        const total = await tabCount(page, 'all');

        await searchBox(page).fill(unique.name);
        await expect(productRows(page)).toHaveCount(1);
        const [row] = await readPageRows(page);
        expect(row).toEqual(expectedRow(unique));
        await expect(pageLabel(page)).toHaveCount(0);

        // Searching by SKU finds the same product
        await searchBox(page).fill(unique.sku);
        await expect(productRows(page)).toHaveCount(1);
        expect((await readPageRows(page))[0].name).toBe(unique.name);

        // No matches
        await searchBox(page).fill(`zz-no-such-product-${Date.now()}`);
        await expect(emptyState(page)).toBeVisible();
        await expect(page.getByText('Try changing your search terms, categories, or filters.').filter({ visible: true })).toBeVisible();
        await expect(productRows(page)).toHaveCount(0);

        // Clearing the search restores the full list
        await searchBox(page).fill('');
        await expectListSize(page, total);
        await expect(pageLabel(page)).toHaveText(`Page 1 of ${Math.ceil(total / 10)}`);
        await expect(categoryFilter(page)).toHaveValue('');
    });
});
