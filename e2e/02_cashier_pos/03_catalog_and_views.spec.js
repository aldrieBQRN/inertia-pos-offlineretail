import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    money,
    getCatalog,
    pickProducts,
    searchInput,
    catalogItems,
    listRowName,
    listRowPrice,
    openQtyModal,
    qtyModalForm,
    qtyInput,
    qtyModalHeading,
    expectCartLine,
} from '../fixtures/pos.helpers.js';

const sortNames = (names) => [...names].sort((a, b) => a.localeCompare(b));

test.describe('POS Catalog, Search, Wholesale & Views', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    test('3.1 should filter products by category', async ({ page }) => {
        const catalog = await getCatalog(page);
        await expect(catalogItems(page)).toHaveCount(catalog.length);

        // Category with the most active products (but not the whole catalog)
        const byCategory = new Map();
        for (const p of catalog.filter((p) => p.category)) {
            byCategory.set(p.category.id, [...(byCategory.get(p.category.id) || []), p]);
        }
        const [, expectedProducts] = [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)[0];
        const category = expectedProducts[0].category;
        expect(expectedProducts.length).toBeLessThan(catalog.length);

        await page.locator('button[title^="Category Filter"]').click();
        await expect(page.getByRole('button', { name: /^All Categories/ })).toBeVisible();
        await page.getByRole('button', { name: category.name, exact: true }).click();

        // Product list changes to exactly the products of that category
        await expect(catalogItems(page)).toHaveCount(expectedProducts.length);
        const shownNames = await catalogItems(page).evaluateAll((rows) =>
            rows.map((r) => r.children[1].firstElementChild.textContent.trim()));
        expect(sortNames(shownNames)).toEqual(sortNames(expectedProducts.map((p) => p.name)));

        // Every displayed row carries the selected category badge
        const badges = await catalogItems(page).evaluateAll((rows) =>
            rows.map((r) => r.children[1].querySelector('span.bg-blue-50')?.textContent.trim()));
        expect(new Set(badges)).toEqual(new Set([category.name]));

        // Reset back to all categories
        await page.locator('button[title^="Category Filter"]').click();
        await page.getByRole('button', { name: /^All Categories/ }).click();
        await expect(catalogItems(page)).toHaveCount(catalog.length);
    });

    test('3.2 should search products', async ({ page }) => {
        const catalog = await getCatalog(page);
        const term = pickProducts(catalog, 1)[0].name.split(' ')[0].toLowerCase();
        const expected = catalog.filter((p) =>
            p.name.toLowerCase().includes(term) || p.sku?.toLowerCase().includes(term));
        expect(expected.length).toBeLessThan(catalog.length);

        await searchInput(page).fill(term);
        await expect(catalogItems(page)).toHaveCount(expected.length);
        const shown = await catalogItems(page).evaluateAll((rows) =>
            rows.map((r) => r.children[1].firstElementChild.textContent.trim()));
        expect(sortNames(shown)).toEqual(sortNames(expected.map((p) => p.name)));
        for (const row of await catalogItems(page).all()) {
            await expect(row).toContainText(new RegExp(term, 'i'));
        }

        // Search with no match shows the empty state
        await searchInput(page).fill(`zz-no-such-product-${Date.now()}`);
        await expect(catalogItems(page)).toHaveCount(0);
        await expect(page.getByText('No products matched your search')).toBeVisible();

        // Clear search restores the full catalog
        await page.getByTitle('Clear search').click();
        await expect(searchInput(page)).toHaveValue('');
        await expect(catalogItems(page)).toHaveCount(catalog.length);
    });

    test('3.3 should switch between list and card views', async ({ page }) => {
        const listHeader = page.getByText('Product Name / Category');
        const firstItem = catalogItems(page).first();

        // Default layout (fresh session) is List View
        await expect(listHeader).toBeVisible();
        await expect(firstItem.locator('h3')).toHaveCount(0);

        await page.getByTitle('Card View').click();
        await expect(listHeader).toBeHidden();
        await expect(firstItem.locator('h3')).toBeVisible();
        await expect(firstItem.locator('img, svg').first()).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('pos_product_view'))).toBe('card');

        await page.getByTitle(/^List View/).click();
        await expect(listHeader).toBeVisible();
        await expect(firstItem.locator('h3')).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('pos_product_view'))).toBe('list');
    });

    test('3.4 should apply wholesale pricing', async ({ page }) => {
        const catalog = await getCatalog(page);
        const [product] = pickProducts(catalog, 1, {
            filter: (p) => p.wholesale_price !== null && p.wholesale_price !== p.price,
        });

        const wholesaleToggle = page.locator('label').filter({ hasText: 'Wholesale' });
        const wholesaleCheckbox = wholesaleToggle.locator('input[type="checkbox"]');

        await searchInput(page).fill(product.sku);
        const row = catalogItems(page).filter({ hasText: product.sku });
        await expect(row).toHaveCount(1);
        await expect(listRowName(row)).toHaveText(product.name);

        // Normal price
        await expect(wholesaleCheckbox).not.toBeChecked();
        await expect(listRowPrice(row)).toHaveText(money(product.price));

        // Enable wholesale → list shows wholesale price
        await wholesaleToggle.click();
        await expect(wholesaleCheckbox).toBeChecked();
        await expect(listRowPrice(row)).toHaveText(money(product.wholesale_price));

        // Wholesale price is what gets charged in the cart
        await openQtyModal(page, product);
        await expect(qtyModalForm(page)).toContainText(money(product.wholesale_price));
        await qtyInput(page).fill('1');
        await qtyModalForm(page).getByRole('button', { name: /^Add to Cart/ }).click();
        await expect(qtyModalHeading(page)).toBeHidden();
        await expectCartLine(page, { product, qty: 1, unit: product.wholesale_price });

        // Disable wholesale → normal price returns
        await searchInput(page).fill(product.sku);
        await wholesaleToggle.click();
        await expect(wholesaleCheckbox).not.toBeChecked();
        await expect(listRowPrice(row)).toHaveText(money(product.price));
    });
});
