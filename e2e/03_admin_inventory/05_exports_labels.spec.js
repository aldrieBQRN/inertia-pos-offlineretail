import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import {
    apiCall,
    gotoInventory,
    getProducts,
    searchBox,
    findRow,
    productRows,
    captureDownload,
    readXlsx,
} from '../fixtures/inventory.helpers.js';

const EXCEL_HEADERS = ['SKU / Barcode', 'Product Name', 'Category Name', 'Retail Price', 'Wholesale Price', 'Cost Price', 'Stock Quantity'];
const TEMPLATE_HEADERS = ['Barcode/SKU', 'Product Name', 'Category Name', 'Retail Price', 'Wholesale Price', 'Cost Price', 'Stock Quantity'];

async function openDataMenu(page) {
    await page.getByRole('button', { name: 'Data & Export' }).click();
    await expect(page.getByText('Reports & Export')).toBeVisible();
}

test.describe('Inventory — Downloads & Print Labels (Manager)', () => {
    let products;
    let storeName;

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);
        products = await getProducts(page);
        storeName = (await apiCall(page, 'get', '/api/settings')).store_name;
    });

    test('5.1 should export the full inventory to Excel', async ({ page }) => {
        await openDataMenu(page);
        const { path, name } = await captureDownload(page, () => page.getByRole('button', { name: 'Export to Excel (.xlsx)' }).click());
        expect(name).toMatch(/_Inventory_Backup_.+\.xlsx$/);
        expect(fs.statSync(path).size).toBeGreaterThan(0);

        const { sheet, rows } = await readXlsx(path);
        expect(sheet).toBe('Inventory Report');
        const headerIndex = rows.findIndex((r) => r.slice(0, 7).join('|') === EXCEL_HEADERS.join('|'));
        expect(headerIndex, 'header row present').toBeGreaterThanOrEqual(0);

        // One row per catalog product, with the stored values
        const dataRows = rows.slice(headerIndex + 1).filter((r) => products.some((p) => p.sku === r[0]));
        expect(dataRows).toHaveLength(products.length);
        for (const p of products.slice(0, 15)) {
            const r = dataRows.find((row) => row[0] === p.sku);
            expect(r[1]).toBe(p.name);
            expect(r[2]).toBe(p.category?.name || 'Uncategorized');
            expect(Number(r[3])).toBeCloseTo(p.price / 100, 2);
            expect(Number(r[6])).toBe(Number(p.stock_quantity));
        }
    });

    test('5.2 should export the currently filtered inventory to PDF', async ({ page }) => {
        const [target, other] = products;
        await findRow(page, target.sku);

        await openDataMenu(page);
        const { path, name } = await captureDownload(page, () => page.getByRole('button', { name: 'Export to PDF Document' }).click());
        expect(name).toMatch(/_Inventory_Report_.+\.pdf$/);

        const pdf = fs.readFileSync(path);
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.length).toBeGreaterThan(1000);
        const content = pdf.toString('latin1');
        // Exports the filtered list (search = target SKU): target is included, other products are not
        expect(content).toContain(target.sku);
        expect(content).not.toContain(other.sku);
    });

    test('5.3 should download the product import template', async ({ page }) => {
        await openDataMenu(page);
        const { path, name } = await captureDownload(page, () => page.getByRole('button', { name: 'Download Template' }).click());
        expect(name).toMatch(/_Products_Template\.xlsx$/);
        const { sheet, rows } = await readXlsx(path);
        expect(sheet).toBe('Products Template');
        expect(rows.some((r) => r.slice(0, 7).join('|') === TEMPLATE_HEADERS.join('|'))).toBe(true);
    });

    test('5.4 should download a product barcode label as a PNG image', async ({ page }) => {
        const product = products.find((p) => p.is_active);
        const row = await findRow(page, product.sku);
        const { path, name } = await captureDownload(page, () => row.getByTitle('Save PNG Barcode').click());

        const productPrefix = product.name.substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
        expect(name).toBe(`${(storeName || 'POS STORE').replace(/[^a-zA-Z0-9_-]/g, '_')}_${productPrefix}_barcode.png`);

        // A real 400x200 PNG (40x20mm label ratio)
        const png = fs.readFileSync(path);
        expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(png.readUInt32BE(16)).toBe(400);
        expect(png.readUInt32BE(20)).toBe(200);
        await expect(page.locator('.swal2-popup').getByRole('heading', { name: 'Saved!' })).toBeVisible();
    });

    test('5.5 should prepare barcode labels for printing with the product details', async ({ page }) => {
        const product = products.find((p) => p.is_active);
        const row = await findRow(page, product.sku);
        await row.getByTitle('Print Barcode Label').click();

        await expect(page.getByRole('heading', { name: 'Print Labels' })).toBeVisible();
        await expect(page.getByText(product.name, { exact: true }).last()).toBeVisible();
        const qty = page.locator('input[type="number"][max="200"]');
        await expect(qty).toHaveValue('1');
        await qty.fill('3');
        await page.getByRole('button', { name: /Thermal Roll/ }).click();

        // Capture the generated label document and stub only the native print dialog,
        // which headless Chromium cannot automate (final physical print is a manual check).
        await page.evaluate(() => {
            window.__labelPrints = [];
            new MutationObserver((mutations) => mutations.forEach((m) => m.addedNodes.forEach((node) => {
                if (node.tagName !== 'IFRAME') return;
                const win = node.contentWindow;
                win.print = () => window.__labelPrints.push([...win.document.querySelectorAll('.label')].map((l) => ({
                    store: l.querySelector('.store-name')?.textContent,
                    name: l.querySelector('.product-name')?.textContent,
                    price: l.querySelector('.price')?.textContent,
                    barcode: l.querySelector('img.barcode')?.getAttribute('src')?.slice(0, 22),
                })));
            }))).observe(document.body, { childList: true });
        });

        await page.getByRole('button', { name: 'Print Now' }).click();
        await expect(page.getByRole('heading', { name: 'Print Labels' })).toBeHidden();
        await expect.poll(() => page.evaluate(() => window.__labelPrints.length)).toBe(1);

        const [labels] = await page.evaluate(() => window.__labelPrints);
        expect(labels).toHaveLength(3);
        const price = (product.price / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
        for (const label of labels) {
            expect(label).toEqual({
                store: storeName || 'POS STORE',
                name: product.name.substring(0, 25),
                price,
                barcode: 'data:image/png;base64,',
            });
        }
        await expect(productRows(page)).toHaveCount(1);
        await expect(searchBox(page)).toHaveValue(product.sku);
    });
});
