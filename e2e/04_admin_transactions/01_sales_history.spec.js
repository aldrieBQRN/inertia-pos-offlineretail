import { test, expect } from '@playwright/test';
import { loginAsAdmin, loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    getCatalog,
    pickProducts,
    addLinesToCart,
    openDiscountManager,
    discountHeading,
    cashCheckout,
    startNewOrder,
} from '../fixtures/pos.helpers.js';

test.describe('Admin Transactions & Sales History', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
    });

    test('1.1 should render transactions table and filters', async ({ page }) => {
        await page.goto('/transactions', { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: /Transactions|Sales History/i })).toBeVisible({ timeout: 5000 });
    });

    test('1.2 should open View Receipt / Transaction Details modal', async ({ page }) => {
        await page.goto('/transactions', { waitUntil: 'domcontentloaded' });
        const detailsBtn = page.getByRole('button', { name: /Details/i }).first();
        if (await detailsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await detailsBtn.click();
            await page.waitForTimeout(500);

            const modalClose = page.locator('button:has-text("Close"), button:has-text("✕")').first();
            await expect(modalClose).toBeVisible({ timeout: 5000 });
        }
    });
});

/**
 * Regression: the "Discounted" badge must reflect real discounts only.
 * discount_amount is serialized as a decimal string ("0.00" when there is no discount),
 * which used to be treated as truthy and badged every transaction as Discounted.
 */
test.describe('Transaction History — Discounted badge', () => {
    const sales = {};

    /** Completes a real POS checkout as the cashier, optionally applying a discount first. */
    async function createSale(page, applyDiscount) {
        const products = pickProducts(await getCatalog(page), 2);
        const subtotal = await addLinesToCart(page, products.map((product) => ({ product, qty: 1 })));
        const discount = applyDiscount ? await applyDiscount(page, subtotal) : 0;
        const { sale } = await cashCheckout(page, subtotal - discount);
        await startNewOrder(page);
        return sale;
    }

    async function applyFromManager(page, selectOption) {
        await openDiscountManager(page);
        await selectOption();
        await page.getByRole('button', { name: /^Apply Discount/ }).click();
        await expect(discountHeading(page)).toBeHidden();
    }

    const customTab = (page) => page.getByRole('button', { name: /Custom Discount \(% or ₱\)/ });

    test.beforeAll(async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await loginAsCashier(page);
            await ensureActiveShift(page);

            sales.none = await createSale(page, null);
            sales.preset = await createSale(page, async (p, subtotal) => {
                await applyFromManager(p, () => p.getByRole('button', { name: /VIP \/ Special Promo/ }).click());
                return Math.round(subtotal * 0.10);
            });
            sales.percentage = await createSale(page, async (p, subtotal) => {
                await applyFromManager(p, async () => {
                    await customTab(p).click();
                    await p.getByRole('button', { name: '% Percentage Off' }).click();
                    await p.getByRole('spinbutton').fill('12');
                });
                return Math.round(subtotal * 0.12);
            });
            sales.fixed = await createSale(page, async (p, subtotal) => {
                const pesos = Math.min(10, Math.floor(subtotal / 100) - 1);
                await applyFromManager(p, async () => {
                    await customTab(p).click();
                    await p.getByRole('button', { name: '₱ Fixed Amount Off' }).click();
                    await p.getByRole('spinbutton').fill(String(pesos));
                });
                return pesos * 100;
            });
        } finally {
            await context.close();
        }
    });

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await page.goto('/transactions', { waitUntil: 'domcontentloaded' });
    });

    /** Searches Transaction History for the invoice and returns its table row. */
    async function findRow(page, sale) {
        await page.getByPlaceholder('Search by Invoice, Cashier, Ref #, or Product inside order...').fill(sale.invoice_number);
        const row = page.locator('tbody tr').filter({ hasText: sale.invoice_number });
        await expect(row).toHaveCount(1);
        return row;
    }

    test('1.3 should not show Discounted for a transaction without a discount', async ({ page }) => {
        // Stored as "no discount": zero amount, no type, not senior/PWD
        expect(Number(sales.none.discount_amount)).toBe(0);
        expect(sales.none.discount_type).toBeNull();
        expect(sales.none.is_senior).toBe(false);

        const row = await findRow(page, sales.none);
        await expect(row).toContainText('PAID');
        await expect(row.getByText('Discounted', { exact: true })).toHaveCount(0);
        await expect(row).not.toContainText(/Senior|PWD|Loyalty|VIP|Custom|% Off/i);
    });

    test('1.4 should show Discounted for preset, percentage and fixed discounts', async ({ page }) => {
        const cases = [
            { sale: sales.preset, type: 'loyalty_10', label: 'VIP (10%)' },
            { sale: sales.percentage, type: 'custom_percentage', label: 'Custom (12%)' },
            { sale: sales.fixed, type: 'custom_fixed', label: `Custom (-₱${(Number(sales.fixed.discount_amount) / 100).toFixed(2)})` },
        ];

        for (const { sale, type, label } of cases) {
            expect(sale.discount_type).toBe(type);
            expect(Number(sale.discount_amount)).toBeGreaterThan(0);

            const row = await findRow(page, sale);
            await expect(row.getByText('Discounted', { exact: true })).toHaveCount(1);
            await expect(row.getByText(label, { exact: true })).toBeVisible();
        }
    });
});
