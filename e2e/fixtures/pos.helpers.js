import { expect } from '@playwright/test';

/**
 * Shared helpers for the Cashier POS Terminal E2E suite (e2e/02_cashier_pos).
 *
 * Selectors are taken from the real implementation:
 *   resources/js/Pages/PosTerminal.jsx, Components/CartSidebar.jsx, PaymentModal.jsx,
 *   DiscountModal.jsx, OpenShiftModal.jsx, CashMovementModal.jsx, ShiftModal.jsx
 *
 * Amounts: products are stored in cents (integer). Shift values (float, drawer,
 * cash movements) are stored in pesos. The UI formats both with en-US grouping.
 */

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

export const money = (cents) => (Math.round(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export const pesos = (amount) => money(Math.round(Number(amount) * 100));

const xpathLiteral = (text) => (text.includes('"') ? `'${text}'` : `"${text}"`);
const cssAttr = (text) => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Value cell that sits right after a label <span> (totals, summaries, receipts). */
export const valueAfterLabel = (page, label) =>
    page.locator(`xpath=//span[normalize-space()=${xpathLiteral(label)}]/following-sibling::span[1]`);

const valueAfterLabelPrefix = (page, prefix) =>
    page.locator(`xpath=//span[starts-with(normalize-space(), ${xpathLiteral(prefix)})]/following-sibling::span[1]`);

/* ------------------------------------------------------------------ */
/* In-page API access (reuses the app's axios instance → CSRF handled) */
/* ------------------------------------------------------------------ */

export async function apiCall(page, method, url, data) {
    const result = await page.evaluate(async ({ method, url, data }) => {
        try {
            const res = await window.axios({ method, url, data });
            return { ok: true, data: res.data };
        } catch (e) {
            return { ok: false, status: e.response?.status, message: e.response?.data?.message || e.message };
        }
    }, { method, url, data });

    if (!result.ok) {
        throw new Error(`${method.toUpperCase()} ${url} failed (${result.status}): ${result.message}`);
    }
    return result.data;
}

/* ------------------------------------------------------------------ */
/* Navigation & shift state                                            */
/* ------------------------------------------------------------------ */

export const shiftActiveLabel = (page) => page.getByText(/^Shift #\d+ Active$/);
export const floatLabel = (page) => page.getByText(/^Float: /);
export const drawerLabel = (page) => page.getByText(/^Drawer: /);
export const noShiftLabel = (page) => page.getByText('No Active Shift · Selling Blocked');

export async function gotoPos(page) {
    // PosTerminal refreshes shift data once on mount; wait for it so modals opened afterwards
    // (which reset when shift data changes) are not reset mid-interaction.
    await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/shift/current') && r.request().method() === 'GET'),
        page.goto('/pos', { waitUntil: 'domcontentloaded' }),
    ]);
    await expect(page.locator('.pos-terminal')).toBeVisible();
    // PosTerminal stores the selected register in localStorage once terminals are loaded
    await page.waitForFunction(() => !!window.axios && !!localStorage.getItem('pos_terminal_id'));
    await expect(catalogItems(page).first()).toBeVisible();
}

export const getActiveTerminalId = (page) =>
    page.evaluate(() => Number(localStorage.getItem('pos_terminal_id')) || null);

export async function getCurrentShift(page) {
    const terminalId = await getActiveTerminalId(page);
    return apiCall(page, 'get', `/api/shift/current${terminalId ? `?terminal_id=${terminalId}` : ''}`);
}

/** Closes the cashier's own open shift as balanced (setup only — not an assertion path). */
export async function closeActiveShiftViaApi(page) {
    const [shift, user] = await Promise.all([getCurrentShift(page), apiCall(page, 'get', '/api/user')]);
    if (!shift.has_active_shift || shift.shift.user_id !== user.id) return null;

    return apiCall(page, 'post', '/api/shift/close', {
        actual_cash: Math.max(0, Number(Number(shift.running_expected_cash).toFixed(2))),
        expenses: 0,
        closing_notes: 'Automated E2E setup: balanced auto-close',
    });
}

export async function openShiftViaApi(page, startingCash, notes = 'Automated E2E setup shift') {
    const terminalId = await getActiveTerminalId(page);
    const res = await apiCall(page, 'post', '/api/shift/open', {
        starting_cash: startingCash,
        opening_notes: notes,
        terminal_id: terminalId,
    });
    return res.shift;
}

/** Leaves the POS with no active shift for the cashier. */
export async function ensureNoActiveShift(page) {
    await gotoPos(page);
    if (await closeActiveShiftViaApi(page)) {
        await gotoPos(page);
    }
    await expect(noShiftLabel(page)).toBeVisible();
}

/** Ensures an active shift exists (opens one with `startingCash` if none). */
export async function ensureActiveShift(page, startingCash = 1000) {
    await gotoPos(page);
    const current = await getCurrentShift(page);
    if (!current.has_active_shift) {
        await openShiftViaApi(page, startingCash);
        await gotoPos(page);
    }
    await expect(shiftActiveLabel(page)).toBeVisible();
}

/** Closes any active shift and opens a brand-new one so Float/Drawer start from a known state. */
export async function startFreshShift(page, startingCash, notes) {
    await gotoPos(page);
    await closeActiveShiftViaApi(page);
    const shift = await openShiftViaApi(page, startingCash, notes);
    await gotoPos(page);
    await expect(shiftActiveLabel(page)).toHaveText(`Shift #${shift.id} Active`);
    await expect(floatLabel(page)).toHaveText(`Float: ${pesos(startingCash)}`);
    return shift;
}

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

export const searchInput = (page) => page.getByPlaceholder('Search product or scan barcode...');
export const catalogItems = (page) => page.locator('[data-catalog-item-index]');

/** List view row columns: [0] barcode, [1] name/category, [2] stock, [3] price. */
export const listRowName = (row) => row.locator(':scope > div').nth(1).locator(':scope > div').first();
export const listRowStock = (row) => row.locator(':scope > div').nth(2);
export const listRowPrice = (row) => row.locator(':scope > div').nth(3).locator(':scope > div').first();

export async function getCatalog(page) {
    return apiCall(page, 'get', '/api/products?all=true&active=true');
}

/**
 * Picks `count` distinct sellable products from the live catalog, highest stock first,
 * so tests never depend on a specific seeded product still being in stock.
 */
export function pickProducts(catalog, count, { minStock = 1, filter = () => true, exclude = [] } = {}) {
    const picked = catalog
        .filter((p) => p.sku && p.price > 0 && p.stock_quantity >= minStock && p.stock_quantity < 99999)
        .filter((p) => !exclude.includes(p.id) && filter(p))
        .sort((a, b) => b.stock_quantity - a.stock_quantity || a.id - b.id)
        .slice(0, count);

    if (picked.length < count) {
        throw new Error(`Test data: need ${count} active products with stock >= ${minStock}, found ${picked.length}. Re-seed the database.`);
    }
    return picked;
}

/* ------------------------------------------------------------------ */
/* Quantity modal & cart                                               */
/* ------------------------------------------------------------------ */

export const qtyModalHeading = (page) => page.getByRole('heading', { name: 'Enter Item Quantity' });
export const qtyModalForm = (page) => page.locator('form').filter({ hasText: 'Quantity Count' });
export const qtyInput = (page) => qtyModalForm(page).locator('input[type="number"]');

/** Finds a product by SKU in the catalog and opens the quantity modal for it. */
export async function openQtyModal(page, product) {
    await searchInput(page).fill(product.sku);
    const row = catalogItems(page).filter({ hasText: product.sku });
    await expect(row).toHaveCount(1);
    await row.click();
    await expect(qtyModalHeading(page)).toBeVisible();
    await expect(qtyModalForm(page)).toContainText(product.name);
}

export async function addProductToCart(page, product, quantity = 1) {
    await openQtyModal(page, product);
    await qtyInput(page).fill(String(quantity));
    await qtyModalForm(page).getByRole('button', { name: /^Add to Cart/ }).click();
    await expect(qtyModalHeading(page)).toBeHidden();
    await expect(searchInput(page)).toHaveValue('');
}

/** Adds [{ product, qty }] lines and returns the expected subtotal in cents. */
export async function addLinesToCart(page, lines) {
    for (const { product, qty } of lines) {
        await addProductToCart(page, product, qty);
    }
    return lines.reduce((sum, { product, qty, unit }) => sum + (unit ?? product.price) * qty, 0);
}

/** Desktop cart row (the mobile card duplicate is hidden at this viewport). */
export function cartLine(page, name) {
    const row = page.locator('.cart-item-row:visible').filter({ has: page.locator(`span[title="${cssAttr(name)}"]`) });
    const cols = row.locator(':scope > div');
    return {
        row,
        qty: cols.nth(0).locator('span'),
        name: cols.nth(1).locator('span[title]'),
        price: cols.nth(2),
        amount: cols.nth(3),
    };
}

export const cartRows = (page) => page.locator('.cart-item-row:visible');
export const cartItemCount = (page) =>
    page.getByRole('heading', { name: /^Current Order/ }).locator('xpath=following-sibling::p[1]');
export const emptyCartMessage = (page) => page.getByText('Order is currently empty');
export const grossSubtotal = (page) => valueAfterLabel(page, 'Gross Subtotal');
export const totalPayable = (page) => valueAfterLabel(page, 'Total Payable');
export const discountLineLabel = (page) => page.locator('xpath=//span[starts-with(normalize-space(), "Less:")]');
export const discountLineValue = (page) => valueAfterLabelPrefix(page, 'Less:');

export async function expectCartLine(page, { product, qty, unit }) {
    const unitPrice = unit ?? product.price;
    const line = cartLine(page, product.name);
    await expect(line.row).toHaveCount(1);
    await expect(line.name).toHaveText(product.name);
    await expect(line.qty).toHaveText(String(qty));
    await expect(line.price).toHaveText(money(unitPrice));
    await expect(line.amount).toHaveText(money(unitPrice * qty));
}

export async function expectCartTotals(page, { subtotal, discount = 0 }) {
    await expect(grossSubtotal(page)).toHaveText(money(subtotal));
    await expect(totalPayable(page)).toHaveText(money(subtotal - discount));
}

export const recallButton = (page) => page.locator('button[title^="Recall"]');
export const recallBadge = (page) => recallButton(page).locator('span.absolute');

export async function expectRecallBadge(page, count) {
    if (count === 0) {
        await expect(recallBadge(page)).toHaveCount(0);
    } else {
        await expect(recallBadge(page)).toHaveText(count > 99 ? '99+' : String(count));
    }
}

export const getHeldOrders = (page) => apiCall(page, 'get', '/api/held-orders');

/* ------------------------------------------------------------------ */
/* Checkout                                                            */
/* ------------------------------------------------------------------ */

export const checkoutButton = (page) => page.getByRole('button', { name: /^Checkout/ });
export const paymentHeading = (page) => page.getByRole('heading', { name: /Checkout Payment/ });
export const paymentModal = (page) => page.locator('.fixed').filter({ has: paymentHeading(page) });
export const amountDue = (page) =>
    page.locator('xpath=//div[normalize-space()="Total Amount Due"]/following-sibling::div[1]');
export const cashReceivedInput = (page) => page.locator('input[inputmode="decimal"]');
export const referenceInput = (page) => page.locator('input[inputmode="numeric"]');
export const confirmSettlementButton = (page) => page.getByRole('button', { name: /Confirm Settlement/ });
export const successHeading = (page) => page.getByRole('heading', { name: 'Payment Successful' });

export async function openCheckout(page, expectedTotalCents) {
    await checkoutButton(page).click();
    await expect(paymentHeading(page)).toBeVisible();
    if (expectedTotalCents !== undefined) {
        await expect(amountDue(page)).toHaveText(money(expectedTotalCents));
    }
}

/** Clicks Confirm Settlement and returns the /api/checkout response body ({ sale_id, invoice }). */
export async function confirmSettlement(page) {
    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/checkout') && r.request().method() === 'POST'),
        confirmSettlementButton(page).click(),
    ]);
    const body = await response.json();
    expect(response.ok(), body.message).toBeTruthy();
    expect(body.success).toBe(true);
    await expect(successHeading(page)).toBeVisible();
    return body;
}

export const getTransaction = (page, saleId) => apiCall(page, 'get', `/api/transactions/${saleId}`);

/** Smallest round amount (multiple of ₱100) strictly greater than the total, in cents. */
export const cashAboveTotal = (totalCents) => (Math.floor(totalCents / 10000) + 1) * 10000;

/** Full cash checkout from a non-empty cart. Returns { sale, totalCents, cashCents }. */
export async function cashCheckout(page, totalCents, cashCents = cashAboveTotal(totalCents)) {
    await openCheckout(page, totalCents);
    await cashReceivedInput(page).fill(String(cashCents / 100));
    await expect(valueAfterLabel(page, 'Change Due')).toHaveText(money(cashCents - totalCents));
    const result = await confirmSettlement(page);
    const sale = await getTransaction(page, result.sale_id);
    return { sale, totalCents, cashCents };
}

export async function startNewOrder(page) {
    await page.getByRole('button', { name: /^New Order/ }).click();
    await expect(successHeading(page)).toBeHidden();
    await expect(emptyCartMessage(page)).toBeVisible();
}

/* ------------------------------------------------------------------ */
/* Discount manager                                                    */
/* ------------------------------------------------------------------ */

export const discountButton = (page) => page.locator('button[title^="Discount"]');
export const discountHeading = (page) => page.getByRole('heading', { name: /Order Discount Manager/ });

export async function openDiscountManager(page) {
    await discountButton(page).click();
    await expect(discountHeading(page)).toBeVisible();
}

export const discountPreview = (page) => ({
    subtotal: valueAfterLabel(page, 'Order Subtotal:'),
    discount: valueAfterLabelPrefix(page, 'Estimated Discount'),
    payable: valueAfterLabel(page, 'New Total Payable:'),
});

/* ------------------------------------------------------------------ */
/* Shift modals                                                        */
/* ------------------------------------------------------------------ */

const inputAfterLabel = (page, labelText, tag = 'input') =>
    page.locator(`xpath=//label[contains(normalize-space(), ${xpathLiteral(labelText)})]/../following-sibling::*[1]/descendant-or-self::${tag}[1]`);

export const openShiftModal = {
    heading: (page) => page.getByRole('heading', { name: 'Open Work Shift' }),
    startingCash: (page) => inputAfterLabel(page, 'Counted Physical Starting Cash'),
    notes: (page) => inputAfterLabel(page, 'Opening Notes', 'textarea'),
    submit: (page) => page.getByRole('button', { name: /^Start Work Shift/ }),
};

export const closeShiftModal = {
    heading: (page) => page.getByRole('heading', { name: 'Close Work Shift' }),
    countedCash: (page) => inputAfterLabel(page, 'Counted Physical Cash'),
    notes: (page) => inputAfterLabel(page, 'Closing Notes', 'textarea'),
    submit: (page) => page.getByRole('button', { name: /^Finalize & Close Shift/ }),
    summaryHeading: (page) => page.getByRole('heading', { name: 'Z-Read Audit Summary' }),
};

/** Status box under the Z-Read reconciliation ("Cash Drawer Status/Overage/Shortage"). */
export const varianceValue = (page, title) =>
    page.locator(`xpath=//div[normalize-space()=${xpathLiteral(title)}]/following-sibling::div[1]`);

/**
 * Opens Close Shift, enters the counted cash and finalizes.
 * Returns the /api/shift/close response (the reconciled shift record).
 */
export async function closeShiftViaUi(page, countedCash, notes = 'Automated E2E close') {
    await page.locator('button[title^="Close Shift"]').click();
    await expect(closeShiftModal.heading(page)).toBeVisible();

    // The modal resets its fields in an effect after opening, then focuses Counted Cash: wait for that
    const counted = closeShiftModal.countedCash(page);
    await expect(counted).toBeFocused();
    await counted.fill(String(countedCash));
    await expect(counted).toHaveValue(String(countedCash));
    await closeShiftModal.notes(page).fill(notes);

    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/shift/close') && r.request().method() === 'POST'),
        closeShiftModal.submit(page).click(),
    ]);
    expect(response.ok()).toBeTruthy();
    await expect(closeShiftModal.summaryHeading(page)).toBeVisible();
    return response.json();
}

/*
 * Cash In/Out (CashMovementModal) is a Manager/Admin function on the Shift page (/shifts).
 * It is intentionally not available in the Cashier Terminal.
 */
export const cashMovementModal = {
    heading: (page) => page.getByRole('heading', { name: /^Cash In \/ Cash Out/ }),
    dialog: (page) => page.locator('form').filter({ has: page.getByText('Movement Type') }),
    amount: (page) => page.locator('input[type="number"][min="0.01"]'),
    reason: (page) => page.getByPlaceholder('Type reason or press down arrow for suggestions...'),
    available: (page) => page.getByText(/^Available in Drawer: /),
    submit: (page) => page.getByRole('button', { name: /^Record|^Insufficient Drawer Balance/ }),
};

/** Fills the already-open Cash In/Out modal, records the movement and dismisses the confirmation. */
export async function recordCashMovement(page, { type, amount, reason }) {
    await expect(cashMovementModal.heading(page)).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${type}`) }).click();
    await cashMovementModal.amount(page).fill(String(amount));
    await cashMovementModal.reason(page).fill(reason);
    await expect(cashMovementModal.amount(page)).toHaveValue(String(amount));
    await expect(cashMovementModal.reason(page)).toHaveValue(reason);

    const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/shift/cash-movement') && r.request().method() === 'POST'),
        cashMovementModal.submit(page).click(),
    ]);
    expect(response.status()).toBe(201);

    await expect(page.getByRole('heading', { name: 'Cash Movement Logged' })).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Cash Movement Logged' })).toBeHidden();
    await expect(cashMovementModal.heading(page)).toBeHidden();
    return (await response.json()).movement;
}

/** Records a movement on the single cash drawer (goes to the open shift; setup for drawer checks). */
export async function adminCashMovementViaApi(adminPage, { type, amount, reason }) {
    const res = await apiCall(adminPage, 'post', '/api/shift/cash-movement', { type, amount, reason });
    return res.movement;
}
