import { test, expect } from '@playwright/test';
import { loginAsCashier, ensureActiveShift } from '../fixtures/auth.fixture.js';
import {
    money,
    getCatalog,
    pickProducts,
    addLinesToCart,
    expectCartTotals,
    discountLineLabel,
    discountLineValue,
    discountButton,
    discountHeading,
    openDiscountManager,
    discountPreview,
    cashCheckout,
    startNewOrder,
} from '../fixtures/pos.helpers.js';

/** Pre-approved presets exactly as defined in resources/js/Components/DiscountModal.jsx */
const PRESETS = [
    { id: 'senior', name: 'Senior Citizen', rate: 20, badge: '20% OFF', requiresId: true },
    { id: 'pwd', name: 'PWD (Person with Disability)', rate: 20, badge: '20% OFF', requiresId: true },
    { id: 'loyalty_5', name: 'Loyalty / Regular', rate: 5, badge: '5% OFF', requiresId: false },
    { id: 'loyalty_10', name: 'VIP / Special Promo', rate: 10, badge: '10% OFF', requiresId: false },
];

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Adds two in-stock products (qty 1 each); returns subtotal in cents. */
async function addTwoProducts(page) {
    const products = pickProducts(await getCatalog(page), 2);
    return addLinesToCart(page, products.map((product) => ({ product, qty: 1 })));
}

async function applyDiscount(page) {
    await page.getByRole('button', { name: /^Apply Discount/ }).click();
    await expect(discountHeading(page)).toBeHidden();
}

/** Cart shows the discount line and recalculated Total Payable. */
async function expectDiscountedCart(page, { label, subtotal, discount }) {
    await expect(discountLineLabel(page)).toHaveText(new RegExp(`^Less: ${escapeRegex(label)}`));
    await expect(discountLineValue(page)).toHaveText(`-${money(discount)}`);
    await expectCartTotals(page, { subtotal, discount });
}

async function checkoutAndVerifySale(page, { subtotal, discount, type, rate, customerName = null }) {
    const { sale } = await cashCheckout(page, subtotal - discount);
    expect(Number(sale.total_amount)).toBe(subtotal - discount);
    expect(Number(sale.discount_amount)).toBe(discount);
    expect(sale.discount_type).toBe(type);
    if (rate === null) {
        expect(sale.discount_rate).toBeNull();
    } else {
        expect(Number(sale.discount_rate)).toBe(rate);
    }
    expect(sale.customer_name).toBe(customerName);
    await startNewOrder(page);
}

test.describe('POS Order Discount Manager', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsCashier(page);
        await ensureActiveShift(page);
    });

    for (const [index, preset] of PRESETS.entries()) {
        test(`6.${index + 1} should apply the ${preset.name} preset discount and checkout`, async ({ page }) => {
            const subtotal = await addTwoProducts(page);
            const discount = Math.round(subtotal * (preset.rate / 100));
            const customer = preset.requiresId ? { name: `E2E ${preset.id} Customer`, id: `ID-${Date.now()}` } : null;

            await openDiscountManager(page);
            await page.getByRole('button', { name: new RegExp(escapeRegex(preset.name)) }).click();

            const preview = discountPreview(page);
            await expect(preview.subtotal).toHaveText(`₱${money(subtotal)}`);
            await expect(preview.discount).toHaveText(`-₱${money(discount)}`);
            await expect(preview.payable).toHaveText(`₱${money(subtotal - discount)}`);

            if (preset.requiresId) {
                // Statutory presets require customer name and ID before applying
                await page.getByRole('button', { name: /^Apply Discount/ }).click();
                await expect(page.getByText(`Customer Name is required for ${preset.name}.`)).toBeVisible();
                await expect(discountHeading(page)).toBeVisible();

                await page.getByPlaceholder('e.g. Juan Dela Cruz (Press Enter for ID)').fill(customer.name);
                await page.getByPlaceholder('e.g. SC-1029348 (Press Enter to Apply)').fill(customer.id);
            }
            await applyDiscount(page);

            const label = `${preset.name} (${preset.rate}%)${customer ? ` (${customer.name})` : ''}`;
            await expectDiscountedCart(page, { label, subtotal, discount });
            await expect(discountButton(page)).toContainText(`${preset.rate}%`);

            await checkoutAndVerifySale(page, {
                subtotal, discount, type: preset.id, rate: preset.rate, customerName: customer?.name ?? null,
            });
        });
    }

    test('6.5 should apply a custom percentage discount and checkout', async ({ page }) => {
        const subtotal = await addTwoProducts(page);
        const rate = 12;
        const discount = Math.round(subtotal * (rate / 100));

        await openDiscountManager(page);
        await page.getByRole('button', { name: /Custom Discount \(% or ₱\)/ }).click();
        await page.getByRole('button', { name: '% Percentage Off' }).click();
        const rateInput = page.getByRole('spinbutton');
        await rateInput.fill(String(rate));
        await expect(rateInput).toHaveValue(String(rate));

        const preview = discountPreview(page);
        await expect(preview.subtotal).toHaveText(`₱${money(subtotal)}`);
        await expect(preview.discount).toHaveText(`-₱${money(discount)}`);
        await expect(preview.payable).toHaveText(`₱${money(subtotal - discount)}`);
        await applyDiscount(page);

        await expectDiscountedCart(page, { label: `Custom Discount (${rate}%)`, subtotal, discount });
        await checkoutAndVerifySale(page, { subtotal, discount, type: 'custom_percentage', rate });
    });

    test('6.6 should apply a custom fixed amount discount and checkout', async ({ page }) => {
        const subtotal = await addTwoProducts(page);
        const amountPesos = Math.min(25, Math.floor(subtotal / 100) - 1);
        const discount = amountPesos * 100;
        expect(amountPesos).toBeGreaterThan(0);

        await openDiscountManager(page);
        await page.getByRole('button', { name: /Custom Discount \(% or ₱\)/ }).click();
        await page.getByRole('button', { name: '₱ Fixed Amount Off' }).click();
        const amountInput = page.getByRole('spinbutton');
        await amountInput.fill(String(amountPesos));
        await expect(amountInput).toHaveValue(String(amountPesos));

        const preview = discountPreview(page);
        await expect(preview.subtotal).toHaveText(`₱${money(subtotal)}`);
        await expect(preview.discount).toHaveText(`-₱${money(discount)}`);
        await expect(preview.payable).toHaveText(`₱${money(subtotal - discount)}`);
        await applyDiscount(page);

        await expectDiscountedCart(page, { label: `Custom Discount (₱${amountPesos.toFixed(2)} Off)`, subtotal, discount });
        await checkoutAndVerifySale(page, { subtotal, discount, type: 'custom_fixed', rate: null });
    });
});
