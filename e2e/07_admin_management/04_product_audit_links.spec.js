import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import { STORE_LOGO_PNG } from '../fixtures/test-data.js';
import { cutInternet, expectNoExternalRequests } from '../fixtures/offline.helpers.js';
import {
    gotoInventory, getProducts, findRow, openLedger, ledgerRows, openActivityFeed, feedSearch, feedCards, uniqueToken,
} from '../fixtures/inventory.helpers.js';

const inspector = (page) => page.locator('div.fixed').filter({ has: page.getByRole('heading', { name: 'Activity Details & Audit Inspector' }) });

/** Creates (or updates) a product through the app API with an image upload, in the page context. */
async function saveProductWithImage(page, { url, fields }) {
    return page.evaluate(async ({ url, fields, png }) => {
        const form = new FormData();
        Object.entries(fields).forEach(([k, v]) => form.append(k, v));
        const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
        form.append('image', new File([bytes], 'item.png', { type: 'image/png' }));
        return (await window.axios.post(url, form)).data;
    }, { url, fields, png: STORE_LOGO_PNG.buffer.toString('base64') });
}

test.describe.serial('Product audit details & LOG links (offline)', () => {
    const token = uniqueToken();
    const name = `E2E Audit Item ${token}`;
    const sku = `E2E-AUD-${token}`;
    let product;

    test('creating a product with an image logs every field', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);
        await loginAsAdmin(page);
        await gotoInventory(page);

        const categories = await page.evaluate(async () => (await window.axios.get('/api/categories')).data);
        const category = (Array.isArray(categories) ? categories : categories.data)[0];
        product = await saveProductWithImage(page, {
            url: '/api/products',
            fields: {
                name, sku, category_id: category.id, price: '120.50', cost_price: '80', wholesale_price: '110',
                stock_quantity: '25', low_stock_threshold: '4',
            },
        });

        // Open it from the Inventory Activity Audit Feed's LOG reference
        await page.reload();
        await openActivityFeed(page);
        await feedSearch(page).fill(sku);
        const card = feedCards(page).filter({ hasText: `Created product: ${name}` });
        await expect(card).toHaveCount(1);
        await card.getByRole('link', { name: /^LOG-\d{5}$/ }).click();

        await expect(page).toHaveURL(/\/activity-logs\?log=\d+$/);
        const box = inspector(page);
        await expect(box).toBeVisible();
        await expect(box.getByText(`Created product: ${name} (SKU: ${sku}) with product image`)).toBeVisible();
        for (const [label, value] of [
            ['Name / Title', name], ['Barcode / SKU', sku], ['Category', category.name], ['Selling Price', '₱120.50'],
            ['Cost Price', '₱80.00'], ['Wholesale Price', '₱110.00'], ['Stock Quantity', '25 units'],
            ['Low Stock Alert Level', '4'], ['Status', 'Active'],
        ]) {
            await expect(box.locator('div').filter({ has: page.getByText(label, { exact: true }) }).filter({ hasText: value }).first()).toBeVisible();
        }
        const image = box.getByRole('img', { name: 'Product image' });
        await expect(image).toBeVisible();
        expect(await image.evaluate((img) => img.naturalWidth)).toBeGreaterThan(0);

        // The search box is pre-filtered to that entry
        await page.getByRole('button', { name: 'Done' }).click();
        await expect(page.getByPlaceholder(/Search by log ID/)).toHaveValue(/^LOG-\d{5}$/);
        await expect(page.locator('table tbody tr')).toHaveCount(1);

        expectNoExternalRequests(external);
    });

    test('updating the price and image shows the full before/after record', async ({ context, page, baseURL }) => {
        const external = await cutInternet(context, baseURL);
        await loginAsAdmin(page);
        await gotoInventory(page);

        await saveProductWithImage(page, { url: `/api/products/${product.id}`, fields: { _method: 'PUT', price: '135' } });

        // Open it from the item's Stock Movement ledger LOG reference
        await page.reload();
        const fresh = (await getProducts(page)).find((p) => p.id === product.id);
        const row = await findRow(page, sku);
        await openLedger(page, row, fresh);
        await ledgerRows(page).filter({ hasText: 'Updated product' }).getByRole('link', { name: /^LOG-\d{5}$/ }).click();

        await expect(page).toHaveURL(/\/activity-logs\?log=\d+$/);
        const box = inspector(page);
        await expect(box.getByText(`Updated product: ${name} (SKU: ${sku}) (product image replaced)`)).toBeVisible();
        await expect(box.getByText('Field Changes & Modifications')).toBeVisible();

        const priceRow = box.locator('tr').filter({ hasText: 'Selling Price' });
        await expect(priceRow).toContainText('₱120.50');
        await expect(priceRow).toContainText('₱135.00');
        // Unchanged fields are listed too
        await expect(box.locator('tr').filter({ hasText: 'Barcode / SKU' })).toContainText(sku);
        await expect(box.locator('tr').filter({ hasText: 'Category' })).toBeVisible();

        // Previous and new image are both shown
        const imageRow = box.locator('tr').filter({ hasText: 'Product Image' });
        await expect(imageRow.getByRole('img', { name: 'Product image' })).toHaveCount(2);

        expectNoExternalRequests(external);
    });
});
