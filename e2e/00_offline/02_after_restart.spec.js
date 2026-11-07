import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import { apiCall } from '../fixtures/pos.helpers.js';
import { cutInternet, expectNoExternalRequests } from '../fixtures/offline.helpers.js';

/**
 * Run after restarting the POS server: everything recorded earlier must still be
 * in the local database, still without any internet access.
 */
test('data persists across an application restart', async ({ context, page, baseURL }) => {
    const external = await cutInternet(context, baseURL);

    await page.goto('/setup');
    await expect(page).not.toHaveURL(/.*setup/); // already configured: setup stays closed

    await loginAsAdmin(page);

    const products = await apiCall(page, 'get', '/api/products?all=true');
    const list = Array.isArray(products) ? products : (products.data ?? products.products ?? []);
    expect(list.some((p) => String(p.sku).startsWith('OFF-'))).toBeTruthy();

    const txns = await apiCall(page, 'get', '/api/transactions?all=1');
    expect((Array.isArray(txns) ? txns : (txns.data ?? [])).length).toBeGreaterThan(0);

    const settings = await apiCall(page, 'get', '/api/settings');
    expect(settings.phone).toBe('0917 555 0101');

    // The store logo uploaded during setup is still stored and served locally
    expect(settings.logo_path).toMatch(/^\/storage\/logos\//);
    const logo = await page.request.get(settings.logo_path);
    expect(logo.status()).toBe(200);
    expect(logo.headers()['content-type']).toMatch(/^image\//);

    expectNoExternalRequests(external);
});
