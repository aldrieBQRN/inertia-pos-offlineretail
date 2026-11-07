import { test, expect } from '@playwright/test';
import { loginAsAdmin, unlockWithPin } from '../fixtures/auth.fixture.js';
import { TEST_ADMIN } from '../fixtures/test-data.js';
import { apiCall, gotoPos, ensureActiveShift, addProductToCart, cashCheckout, startNewOrder } from '../fixtures/pos.helpers.js';
import { cutInternet, watchPageHealth, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

/**
 * Full standalone run with the internet cut off: setup → unlock → manage catalog →
 * sell → review → settings → sign out/in. Fails if any request leaves the device.
 */
test.describe.serial('Standalone POS works with zero internet', () => {
    const sku = `OFF-${Date.now().toString().slice(-6)}`;
    let external;
    let problems;

    test.beforeEach(async ({ context, page, baseURL }) => {
        external = await cutInternet(context, baseURL);
        problems = watchPageHealth(page);
    });

    test.afterEach(() => {
        expectNoExternalRequests(external);
        expect(problems, problems.join('\n')).toEqual([]);
    });

    test('first-time setup (or unlock) reaches the dashboard', async ({ page }) => {
        await loginAsAdmin(page);
        await expect(page).toHaveURL(/.*dashboard/);
        await expect(page.getByText(TEST_ADMIN.name).first()).toBeVisible();
    });

    test('bundled fonts load locally with the exact brand families', async ({ page }) => {
        const fontResponses = [];
        page.on('response', (r) => { if (/\.(woff2?|ttf)(\?|$)/.test(r.url())) fontResponses.push(r.url()); });

        await loginAsAdmin(page);
        await page.reload({ waitUntil: 'networkidle' });

        const fonts = await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([
                document.fonts.load('400 16px Figtree'),
                document.fonts.load('600 16px Figtree'),
                document.fonts.load('700 26px "Cormorant Garamond"'),
                document.fonts.load('500 10px Manrope'),
            ]);
            const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`);
            return { loaded, body: getComputedStyle(document.body).fontFamily };
        });

        expect(fonts.body).toMatch(/^Figtree/);
        expect(fonts.loaded.join('|')).toMatch(/Figtree/);
        expect(fonts.loaded.join('|')).toMatch(/Cormorant Garamond/);
        expect(fonts.loaded.join('|')).toMatch(/Manrope/);
        expect(fontResponses.length).toBeGreaterThan(0);
        for (const url of fontResponses) expect(url).toContain('/build/assets/');
    });

    test('every navigation page renders', async ({ page }) => {
        await loginAsAdmin(page);
        for (const [path, heading] of [
            ['/dashboard', /Dashboard|Overview/i],
            ['/reports', /Report|Analytics/i],
            ['/inventory', /Inventory/i],
            ['/transactions', /Transaction/i],
            ['/shifts', /Shift/i],
            ['/settings', /Store Settings/i],
            ['/profile', /Account Settings/i],
        ]) {
            await page.goto(path, { waitUntil: 'networkidle' });
            await expect(page).toHaveURL(new RegExp(path));
            await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
        }
        await gotoPos(page).catch(async () => {
            // An empty catalog shows no items yet; the terminal itself must still render
            await page.goto('/pos', { waitUntil: 'networkidle' });
            await expect(page.locator('.pos-terminal')).toBeVisible();
        });
    });

    test('categories and products are managed locally', async ({ page }) => {
        await loginAsAdmin(page, '/inventory');
        const category = await apiCall(page, 'post', '/api/categories', { name: `Offline Goods ${sku}` });
        const categoryId = category.id ?? category.category?.id ?? category.data?.id;
        expect(categoryId).toBeTruthy();

        await apiCall(page, 'post', '/api/products', {
            name: `Offline Bread ${sku}`, sku, category_id: categoryId,
            price: 45, cost_price: 30, wholesale_price: 40, stock_quantity: 20,
        });

        await page.reload({ waitUntil: 'networkidle' });
        await page.getByPlaceholder('Search by SKU, product name, barcode...').fill(sku);
        await expect(page.getByText(`Offline Bread ${sku}`).first()).toBeVisible();
    });

    test('a cash sale is rung up at the POS and stock is deducted', async ({ page }) => {
        await loginAsAdmin(page, '/pos');
        await ensureActiveShift(page, 1000);

        const product = { sku, name: `Offline Bread ${sku}`, price: 4500 };
        await addProductToCart(page, product, 2);
        const { sale } = await cashCheckout(page, 9000);
        expect(sale.status ?? 'completed').toBe('completed');
        await startNewOrder(page);

        const products = await apiCall(page, 'get', '/api/products?all=true');
        const list = Array.isArray(products) ? products : (products.data ?? products.products ?? []);
        expect(list.find((p) => p.sku === sku)?.stock_quantity).toBe(18);
    });

    test('the sale appears in transactions and reports', async ({ page }) => {
        await loginAsAdmin(page, '/transactions');
        const txns = await apiCall(page, 'get', '/api/transactions?all=1');
        const rows = Array.isArray(txns) ? txns : (txns.data ?? []);
        expect(rows.length).toBeGreaterThan(0);

        const report = await apiCall(page, 'get', '/api/reports');
        expect(report.summary.total_orders).toBeGreaterThan(0);
    });

    test('store settings are saved locally', async ({ page }) => {
        await loginAsAdmin(page, '/settings');
        await page.evaluate(async (phone) => {
            const fd = new FormData();
            fd.append('store_name', document.querySelector('h3')?.textContent || 'E2E Test Store');
            fd.append('phone', phone);
            await window.axios.post('/api/settings', fd);
        }, '0917 555 0101');
        const settings = await apiCall(page, 'get', '/api/settings');
        expect(settings.phone).toBe('0917 555 0101');
    });

    test('sign out locks the POS and the PIN unlocks it again', async ({ page }) => {
        await loginAsAdmin(page, '/profile');
        await page.evaluate(() => window.axios.post('/logout'));
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/.*login/);
        await unlockWithPin(page);
        await expect(page).toHaveURL(/.*dashboard/, { timeout: 15000 });
    });
});
