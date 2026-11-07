import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../fixtures/auth.fixture.js';
import {
    apiCall,
    gotoInventory,
    getProducts,
    getCategories,
    uniqueToken,
    tabCount,
    categoryFilter,
    expectListSize,
    readAllRows,
    swal,
    expectSwal,
    expectSwalClosed,
    swalConfirm,
} from '../fixtures/inventory.helpers.js';

const managerHeading = (page) => page.getByRole('heading', { name: 'Manage Categories' });
const categoryRows = (page) => page.locator('div:has(> div > span[title]):has(button[title="Edit Category"])');
const categoryRow = (page, name) => categoryRows(page).filter({ has: page.locator(`span[title="${name.replace(/"/g, '\\"')}"]`) });
const categoryNames = (page) => categoryRows(page).locator('span[title]').allTextContents();

async function openCategoryManager(page) {
    await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/categories') && r.request().method() === 'GET'),
        page.getByRole('button', { name: 'Categories', exact: true }).click(),
    ]);
    await expect(managerHeading(page)).toBeVisible();
}

async function filterOptions(page) {
    return categoryFilter(page).locator('option').allTextContents();
}

test.describe('Inventory — Category Filter (Manager)', () => {
    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);
    });

    test('3.1 should filter the catalog by category and return to All Categories', async ({ page }) => {
        const [products, categories] = await Promise.all([getProducts(page), getCategories(page)]);
        const total = await tabCount(page, 'all');

        // Default: All Categories with the full catalog
        await expect(categoryFilter(page)).toHaveValue('');
        await expect(categoryFilter(page).locator('option').first()).toHaveText(`All Categories (${categories.length})`);
        expect((await filterOptions(page)).slice(1)).toEqual(categories.map((c) => c.name));
        await expectListSize(page, total);

        // Category with the most products (but not every product)
        const counts = categories.map((c) => ({ c, n: products.filter((p) => p.category_id === c.id).length }))
            .sort((a, b) => b.n - a.n);
        const { c: category, n } = counts[0];
        expect(n).toBeGreaterThan(0);
        expect(n).toBeLessThan(total);

        await categoryFilter(page).selectOption(String(category.id));
        await expectListSize(page, n);
        const rows = await readAllRows(page);
        expect(rows).toHaveLength(n);
        // Every displayed product belongs to the selected category
        expect(new Set(rows.map((r) => r.category))).toEqual(new Set([category.name]));
        expect(rows.map((r) => r.sku).sort())
            .toEqual(products.filter((p) => p.category_id === category.id).map((p) => p.sku).sort());

        // Back to All Categories
        await categoryFilter(page).selectOption('');
        await expectListSize(page, total);
        expect(await readAllRows(page)).toHaveLength(total);
    });
});

test.describe.serial('Inventory — Manage Categories CRUD (Manager)', () => {
    const token = uniqueToken();
    const createdName = `E2E Category ${token}`;
    const renamedName = `E2E Renamed ${token}`;
    let createdId;

    test.beforeEach(async ({ page }) => {
        await loginAsAdmin(page);
        await gotoInventory(page);
    });

    test.afterAll(async ({ browser }) => {
        // Safety net: remove the temporary category if a test failed before deleting it
        const page = await browser.newPage();
        await loginAsAdmin(page);
        await gotoInventory(page);
        const leftover = (await getCategories(page)).find((c) => [createdName, renamedName].includes(c.name));
        if (leftover) await apiCall(page, 'delete', `/api/categories/${leftover.id}`);
        await page.close();
    });

    test('3.2 should list existing categories in Manage Categories', async ({ page }) => {
        const categories = await getCategories(page);
        await openCategoryManager(page);
        await expect(categoryRows(page)).toHaveCount(categories.length);
        expect(await categoryNames(page)).toEqual(categories.map((c) => c.name));
        await expect(page.getByPlaceholder('New Category Name...')).toBeVisible();
        for (const c of categories) {
            await expect(categoryRow(page, c.name).getByTitle('Edit Category')).toBeVisible();
            await expect(categoryRow(page, c.name).getByTitle('Delete Category')).toBeVisible();
        }
    });

    test('3.3 should create a category and offer it in the filter and product form', async ({ page }) => {
        await openCategoryManager(page);
        await page.getByPlaceholder('New Category Name...').fill(createdName);
        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith('/api/categories') && r.request().method() === 'POST'),
            page.getByRole('button', { name: 'Add', exact: true }).click(),
        ]);
        expect(response.status()).toBe(201);
        createdId = (await response.json()).id;

        await expectSwal(page, 'Category Added!', 'New category created successfully.');
        await expectSwalClosed(page);
        await expect(categoryRow(page, createdName)).toHaveCount(1);
        await expect(page.getByPlaceholder('New Category Name...')).toHaveValue('');

        // Available in the catalog filter and in the product form
        await page.getByTitle('Close Modal').click();
        await expect(managerHeading(page)).toBeHidden();
        await expect(categoryFilter(page).locator(`option[value="${createdId}"]`)).toHaveText(createdName);
        await page.getByRole('button', { name: 'Add Product' }).click();
        await expect(page.locator('#product-form [name="category_id"] option', { hasText: createdName })).toHaveCount(1);
        await page.getByRole('button', { name: 'Cancel' }).click();

        expect((await getCategories(page)).find((c) => c.id === createdId)?.name).toBe(createdName);
    });

    test('3.4 should rename the category', async ({ page }) => {
        await openCategoryManager(page);
        await categoryRow(page, createdName).getByTitle('Edit Category').click();
        await expectSwal(page, 'Edit Category');
        await expect(page.locator('#swal-input-name')).toHaveValue(createdName);
        await page.locator('#swal-input-name').fill(renamedName);

        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/categories/${createdId}`) && r.request().method() === 'PUT'),
            swalConfirm(page, 'Update Category'),
        ]);
        expect(response.ok()).toBeTruthy();
        await expectSwal(page, 'Updated!', 'Category has been successfully updated.');
        await expectSwalClosed(page);

        await expect(categoryRow(page, renamedName)).toHaveCount(1);
        await expect(categoryRow(page, createdName)).toHaveCount(0);
        await page.getByTitle('Close Modal').click();
        await expect(categoryFilter(page).locator(`option[value="${createdId}"]`)).toHaveText(renamedName);
        expect(await filterOptions(page)).not.toContain(createdName);
    });

    test('3.5 should refuse to delete a category that contains products', async ({ page }) => {
        const [products, categories] = await Promise.all([getProducts(page), getCategories(page)]);
        const inUse = categories.find((c) => products.some((p) => p.category_id === c.id));
        const productIds = products.filter((p) => p.category_id === inUse.id).map((p) => p.id).sort();

        await openCategoryManager(page);
        await categoryRow(page, inUse.name).getByTitle('Delete Category').click();
        await expectSwal(page, 'Are you sure?', 'Deleting this category may affect products assigned to it!');
        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/categories/${inUse.id}`) && r.request().method() === 'DELETE'),
            swalConfirm(page, 'Yes, delete it!'),
        ]);
        expect(response.status()).toBe(400);
        await expectSwal(page, 'Cannot Delete',
            'Cannot delete: This category currently contains products. Please reassign those products first.');
        await swal(page).getByRole('button', { name: 'OK' }).click();

        // Category and its products are untouched
        await expect(categoryRow(page, inUse.name)).toHaveCount(1);
        expect((await getCategories(page)).some((c) => c.id === inUse.id)).toBe(true);
        expect((await getProducts(page)).filter((p) => p.category_id === inUse.id).map((p) => p.id).sort()).toEqual(productIds);
    });

    test('3.6 should delete an empty category', async ({ page }) => {
        expect((await getProducts(page)).some((p) => p.category_id === createdId)).toBe(false);

        await openCategoryManager(page);
        await categoryRow(page, renamedName).getByTitle('Delete Category').click();
        await expectSwal(page, 'Are you sure?');
        const [response] = await Promise.all([
            page.waitForResponse((r) => r.url().endsWith(`/api/categories/${createdId}`) && r.request().method() === 'DELETE'),
            swalConfirm(page, 'Yes, delete it!'),
        ]);
        expect(response.ok()).toBeTruthy();
        await expectSwal(page, 'Deleted!', 'Category has been removed.');
        await expectSwalClosed(page);

        await expect(categoryRow(page, renamedName)).toHaveCount(0);
        await page.getByTitle('Close Modal').click();
        await expect(categoryFilter(page).locator(`option[value="${createdId}"]`)).toHaveCount(0);
        expect((await getCategories(page)).some((c) => c.id === createdId)).toBe(false);
    });
});
