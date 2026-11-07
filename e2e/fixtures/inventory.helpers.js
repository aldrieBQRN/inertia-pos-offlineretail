import { expect } from '@playwright/test';
import { apiCall } from './pos.helpers.js';

export { apiCall };

/**
 * Shared helpers for the Inventory E2E suite (e2e/03_admin_inventory).
 * Selectors come from resources/js/Pages/Inventory.jsx and Components/CategoryManager.jsx.
 *
 * Business rules taken from the implementation (Inventory.jsx `stats` / `filteredProducts`):
 *   Healthy In Stock : active && stock > 10
 *   Low Stock Alerts : active && 0 < stock <= 10
 *   Out of Stock     : active && stock <= 0
 *   Archived Items   : !is_active
 *   All Catalog      : every product (active + archived)
 * Prices are stored in cents and rendered with en-US grouping (no currency sign in the table).
 */

export const TABS = {
    all: 'All Catalog',
    in_stock: 'Healthy In Stock',
    low_stock: 'Low Stock Alerts',
    out_of_stock: 'Out of Stock',
    archived: 'Archived Items',
};

export const LOW_STOCK_MAX = 10;

export const money = (cents) => ((Number(cents) || 0) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Which tab a product belongs to (besides All Catalog). */
export function tabOf(product) {
    const qty = Number(product.stock_quantity) || 0;
    if (!product.is_active) return 'archived';
    if (qty <= 0) return 'out_of_stock';
    if (qty <= LOW_STOCK_MAX) return 'low_stock';
    return 'in_stock';
}

export const uniqueToken = () => `${Date.now()}${Math.floor(Math.random() * 90 + 10)}`;

/* ------------------------------------------------------------------ */
/* Page & data                                                         */
/* ------------------------------------------------------------------ */

export async function gotoInventory(page) {
    await page.goto('/inventory', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Inventory Management' })).toBeVisible();
    await page.waitForFunction(() => !!window.axios);
    await expect(productRows(page).or(emptyState(page)).first()).toBeVisible();
}

export const getProducts = (page) => apiCall(page, 'get', '/api/products?all=true');
export const getCategories = (page) => apiCall(page, 'get', '/api/categories');
export const bySku = (products) => new Map(products.map((p) => [p.sku, p]));

/* ------------------------------------------------------------------ */
/* Tabs, toolbar, list/cards                                           */
/* ------------------------------------------------------------------ */

export const tabButton = (page, key) => page.locator(`button[data-tab="${key}"]`);
export const tabCount = async (page, key) => Number((await tabButton(page, key).locator('span').last().innerText()).trim());

export async function tabCounts(page) {
    const counts = {};
    for (const key of Object.keys(TABS)) counts[key] = await tabCount(page, key);
    return counts;
}

/** Waits until the tab badges show the expected counts (they refresh after a silent product reload). */
export async function expectTabCounts(page, expected) {
    await expect.poll(() => tabCounts(page), { message: 'catalog tab counts' }).toEqual(expected);
}

export const searchBox = (page) => page.getByPlaceholder('Search by SKU, product name, barcode...');
export const categoryFilter = (page) => page.locator('select').filter({ has: page.locator('option', { hasText: /^All Categories/ }) });
export const sortSelect = (page) => page.locator('select').filter({ has: page.locator('option[value="newest"]') });
export const emptyState = (page) => page.getByText('No items found').filter({ visible: true });
export const pageLabel = (page) => page.getByText(/^Page \d+ of \d+$/);

/** Product rows of the list (table) view. */
export const productRows = (page) => page.locator('table tbody tr:has(input[type="checkbox"])');

/** Product cards of the card (grid) view. */
export const productCards = (page) => page.locator('div.grid > div:has(h3[title])').filter({ visible: true });

/** The list row for an exact SKU (product must be on the current page). */
export const rowBySku = (page, sku) => productRows(page).filter({ has: page.getByText(sku, { exact: true }) });

/** Waits until the list shows the expected number of rows for `total` matching products. */
export async function expectListSize(page, total) {
    if (total === 0) {
        await expect(emptyState(page)).toBeVisible();
        await expect(productRows(page)).toHaveCount(0);
    } else {
        await expect(productRows(page)).toHaveCount(Math.min(10, total));
    }
}

export async function openTab(page, key, expectedTotal) {
    await tabButton(page, key).click();
    await expectListSize(page, expectedTotal ?? await tabCount(page, key));
}

/** Reads the visible list rows (current page). */
export function readPageRows(page) {
    return productRows(page).evaluateAll((rows) => rows.map((r) => {
        const td = r.querySelectorAll(':scope > td');
        const ws = td[5].innerText.match(/WS:\s*([\d,.]+)/);
        return {
            sku: td[1].innerText.trim(),
            name: td[2].querySelector('div[title]')?.innerText.trim(),
            category: td[3].innerText.trim(),
            cost: td[4].innerText.trim(),
            retail: td[5].querySelector('div')?.innerText.trim(),
            wholesale: ws ? ws[1] : null,
            stock: parseInt(td[6].innerText, 10),
        };
    }));
}

/** Reads every row of the current filter by walking the pagination. */
export async function readAllRows(page) {
    const rows = await readPageRows(page);
    if (await pageLabel(page).count() === 0) return rows;

    // textContent (innerText is upper-cased by CSS)
    const totalPages = Number((await pageLabel(page).textContent()).match(/of (\d+)/)[1]);
    for (let n = 2; n <= totalPages; n++) {
        await page.getByRole('button', { name: /^Next/ }).click();
        await expect(pageLabel(page)).toHaveText(`Page ${n} of ${totalPages}`);
        rows.push(...await readPageRows(page));
    }
    return rows;
}

/** Reads the visible product cards. */
export function readCards(page) {
    return productCards(page).evaluateAll((cards) => cards.map((c) => {
        const text = c.textContent.replace(/\s+/g, ' ');
        return {
            name: c.querySelector('h3[title]')?.textContent.trim(),
            sku: [...c.querySelectorAll('span')].map((s) => s.textContent.trim())
                .find((t) => t.startsWith('Barcode:'))?.replace(/^Barcode:\s*/, ''),
            stock: parseInt([...c.querySelectorAll('span')].map((s) => s.textContent.trim())
                .find((t) => /^-?\d+ Left$/.test(t)), 10),
            archived: /\bArchived\b/.test(text),
            text,
        };
    }));
}

/** Searches the catalog and returns the row for the SKU. */
export async function findRow(page, sku) {
    await searchBox(page).fill(sku);
    const row = rowBySku(page, sku);
    await expect(row).toHaveCount(1);
    return row;
}

/** Expected rendering of a product row from its API record. */
export function expectedRow(product) {
    return {
        sku: product.sku,
        name: product.name,
        category: product.category?.name || 'General',
        cost: product.cost_price ? money(product.cost_price) : '—',
        retail: money(product.price),
        wholesale: product.wholesale_price ? money(product.wholesale_price) : null,
        stock: Number(product.stock_quantity) || 0,
    };
}

/* ------------------------------------------------------------------ */
/* SweetAlert dialogs                                                  */
/* ------------------------------------------------------------------ */

export const swal = (page) => page.locator('.swal2-popup');

export async function expectSwal(page, title, text) {
    await expect(swal(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
    if (text) await expect(swal(page).locator('.swal2-html-container')).toHaveText(text);
}

export async function swalConfirm(page, label) {
    await swal(page).getByRole('button', { name: label, exact: true }).click();
}

/** Dismisses a timed success alert (or waits for it to auto-close). */
export async function expectSwalClosed(page) {
    await expect(swal(page)).toBeHidden({ timeout: 10000 });
}

/* ------------------------------------------------------------------ */
/* Product form                                                        */
/* ------------------------------------------------------------------ */

export const productField = (page, name) => page.locator(`#product-form [name="${name}"]`);

export async function fillProductForm(page, data) {
    if (data.sku !== undefined) await productField(page, 'sku').fill(data.sku);
    if (data.name !== undefined) await productField(page, 'name').fill(data.name);
    if (data.category_id !== undefined) await productField(page, 'category_id').selectOption(String(data.category_id));
    if (data.stock_quantity !== undefined) await productField(page, 'stock_quantity').fill(String(data.stock_quantity));
    if (data.cost_price !== undefined) await productField(page, 'cost_price').fill(data.cost_price);
    if (data.price !== undefined) await productField(page, 'price').fill(data.price);
    if (data.wholesale_price !== undefined) await productField(page, 'wholesale_price').fill(data.wholesale_price);
    if (data.is_active !== undefined) await page.locator('#is_active_checkbox').setChecked(data.is_active);
}

/** Submits the product modal and returns the saved product from the API response. */
export async function saveProductForm(page) {
    const [response] = await Promise.all([
        page.waitForResponse((r) => /\/api\/products(\/\d+)?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Save Product' }).click(),
    ]);
    expect(response.ok(), await response.text()).toBeTruthy();
    await expect(page.locator('#product-form')).toBeHidden();
    await expectSwal(page, 'Saved!');
    await expectSwalClosed(page);
    return response.json();
}

/* ------------------------------------------------------------------ */
/* Stock movement ledger & activity feed                               */
/* ------------------------------------------------------------------ */

export const ledgerTable = (page) => page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Movement Type' }) });
export const ledgerRows = (page) => ledgerTable(page).locator('tbody tr');
export const ledgerSearch = (page) => page.getByPlaceholder('Filter ledger by cashier name, invoice number, or description...');
export const ledgerTab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });
export const ledgerEmpty = (page) => page.getByText('No stock movements found');

export function readLedgerRows(page) {
    return ledgerRows(page).evaluateAll((rows) => rows.map((r) => {
        // textContent: several cells are upper-cased by CSS
        const td = r.querySelectorAll(':scope > td');
        const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
        return {
            type: text(td[1]),
            qty: text(td[2]),
            user: text(td[3]),
            reference: text(td[4]),
            description: text(td[5]),
        };
    }));
}

/** Opens the product's Stock Movement ledger and waits for fresh history from the API. */
export async function openLedger(page, row, product) {
    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/products/${product.id}/history`)),
        row.getByTitle('View Stock Movement & Sales History').click(),
    ]);
    const history = await response.json();
    await expect(page.getByRole('heading', { name: product.name, exact: true })).toBeVisible();
    await expect(ledgerRows(page).or(ledgerEmpty(page)).first()).toBeVisible();
    await expect(ledgerRows(page)).toHaveCount(history.timeline.length);
    return history;
}

export const feedHeading = (page) => page.getByRole('heading', { name: 'Inventory Activity Audit Feed' });
export const feedSearch = (page) => page.getByPlaceholder('Filter audit log by staff name, product SKU, keyword, or invoice...');
export const feedTab = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });
export const feedCards = (page) => page.locator('div.group:has(> div.pt-1 > p)');
export const feedEmpty = (page) => page.getByText('No matching activities found');

export function readFeedCards(page) {
    // Card children: [timeline dot] [header: badge row + timestamp] [div.pt-1 > p description]
    return feedCards(page).evaluateAll((cards) => cards.map((c) => {
        const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
        const badgeRow = c.children[1].children[0];
        const refBadge = badgeRow.children[2];
        return {
            badge: text(badgeRow.children[0]),
            user: text(badgeRow.children[1].querySelector(':scope > span')),
            reference: refBadge ? text(refBadge).replace(/^Ref:\s*/, '') : null,
            description: text(c.querySelector(':scope > div.pt-1 > p')),
        };
    }));
}

export const tabNumber = async (button) => Number((await button.locator('span').last().innerText()).trim());

/** Opens the Activity Feed and waits for the fresh feed from the API. */
export async function openActivityFeed(page) {
    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/inventory/recent-activity')),
        page.getByRole('button', { name: 'Activity Feed' }).click(),
    ]);
    await expect(feedHeading(page)).toBeVisible();
    const data = (await response.json()).data;
    await expect(feedCards(page)).toHaveCount(data.length);
    return data;
}

/* ------------------------------------------------------------------ */
/* Downloads                                                           */
/* ------------------------------------------------------------------ */

export async function captureDownload(page, trigger) {
    const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const path = await download.path();
    return { download, path, name: download.suggestedFilename() };
}

/** All non-empty cell values of the first worksheet, as strings, row by row. */
export async function readXlsx(path) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow((row) => {
        rows.push(row.values.slice(1).map((v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') return String(v.text ?? v.result ?? v.richText?.map((t) => t.text).join('') ?? '');
            return String(v);
        }));
    });
    return { sheet: sheet.name, rows };
}
