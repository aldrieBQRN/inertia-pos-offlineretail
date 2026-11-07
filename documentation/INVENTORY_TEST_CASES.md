# Inventory — Test Cases

Automated end-to-end test cases for the Inventory page (`/inventory`, `resources/js/Pages/Inventory.jsx`).
Every case below is backed by a Playwright test in `e2e/03_admin_inventory/` and describes what the test actually does.

| | |
|---|---|
| **Framework** | Playwright (`@playwright/test`), Chromium "Desktop Chrome" project (1280×720) |
| **Run command** | `npx playwright test e2e/03_admin_inventory` (also part of `npm run test:e2e:admin`) |
| **Prerequisite** | Laravel app at `http://127.0.0.1:8000`, Vite dev server or a fresh build, seeded database |
| **Shared helpers** | `e2e/fixtures/inventory.helpers.js` (selectors, tab/list/card readers, ledger and feed readers, downloads) |
| **Test count** | **33 automated tests**, plus 1 manual step (native print dialog) |
| **Last result** | 2026-10-03: **33 passed, 0 failed**. The native print dialog step is manual (see below). |

## Roles

The Inventory page is protected by the `is_admin` flag (`Inventory.jsx` `isAdmin`, `admin` route middleware), and `/inventory` redirects the platform super admin away (`routes/web.php`).

| Role | Account (fixture) | Inventory access | Coverage |
|---|---|---|---|
| **Super Admin** (`super_admin`) | `dev@email.com` (`loginAsDeveloper`) | **None.** `/inventory` redirects to the Developer console. | INV-031 |
| **Manager** (`manager`) | `manager@email.com` (`loginAsManager`, new) | Full management | All functional tests (INV-001 to INV-030), INV-032 |
| **Store Admin** (`admin`) | `admin@email.com` (`loginAsAdmin`) | Full management, identical to Manager (same `is_admin` flag) | INV-033 |

Because Manager and Store Admin get exactly the same Inventory permissions, the full functional suite runs as the Manager, and a role test confirms the Store Admin has the same controls. Super Admin is tested for the redirect only, since it has no Inventory page.

## Business rules under test

> A product with transaction history cannot be permanently deleted and is archived instead. A product without transaction history can be deleted.

> A category containing products cannot be deleted.

Stock tabs use the thresholds in `Inventory.jsx`:

| Tab | Condition |
|---|---|
| All Catalog | Every product, **including archived** ones (existing behaviour) |
| Healthy In Stock | Active and stock **> 10** |
| Low Stock Alerts | Active and stock **1–10** |
| Out of Stock | Active and stock **≤ 0** |
| Archived Items | Not active |

## How the tests get their data

- **Nothing is hardcoded.** Counts, product names, categories, stock levels and prices are read from the live catalog (`GET /api/products?all=true`, `/api/categories`, `/api/transactions?all=true`), and expectations are calculated from them.
- **Temporary data for create/edit/delete.** CRUD runs on a dedicated product `E2E-INV-<token>` and category `E2E Category <token>`, which the tests delete themselves. An `afterAll` safety net removes them if a test fails part-way.
- **Seeded products are never left changed.** Archive and delete-with-history tests use seeded products and restore them afterwards (with an `afterAll` safety net).
- **One real sale.** INV-021 completes one genuine POS checkout (1 unit) as the cashier, because the Activity Feed shows only the 50 most recent activities, so older seeded sales may be outside it.
- **Activity and audit logs are kept.** They are the store's audit trail and are not deleted by the tests.
- **No fixed sleeps.** Tests wait on API responses, list sizes, tab badges (polled after the page's silent reload) and download events.

## Test cases

| ID | Test Case | Preconditions | Test Steps | Expected Result | Automated Test Reference | Status |
|---|---|---|---|---|---|---|
| INV-001 | Catalog tab counts and contents | Manager logged in | 1. Read all five tab badges.<br>2. Open each tab and walk every page. | Badges equal the counts calculated from the API with the thresholds above; All = Healthy + Low + Out + Archived. Each tab lists exactly that many products, each meeting the tab's condition. Every row's SKU, name, category, cost, retail, wholesale and stock match the stored product. All Catalog lists every product. An empty tab shows "No items found". | `04_catalog_views.spec.js` › `4.1` | Pass |
| INV-002 | Sort options | Manager logged in | 1. Check the sort options.<br>2. Select each option and walk every page. | Options are exactly Default, Newest/Oldest Added, Name A-Z/Z-A, Stock High/Low, Price High/Low, Margin. Default is strict newest-ID-first, and every other option orders the whole list by its key. Name and Price sorts differ from Default. | `04_catalog_views.spec.js` › `4.2` | Pass |
| INV-003 | List / Cards view | Search term matching 2–9 products | 1. Search.<br>2. Switch List → Cards → List, twice. | List view shows rows with correct details. Cards view shows the same products in the same order, with correct name, SKU, category, price, stock and archived badge. The search text survives every switch; the choice is saved (`pos_inv_view_mode` table/grid). | `04_catalog_views.spec.js` › `4.3` | Pass |
| INV-004 | Search | A product with a unique name | 1. Search by name.<br>2. Search by SKU.<br>3. Search a nonexistent term.<br>4. Clear. | Only the matching product is shown, with correct details, by both name and SKU. A no-match search shows "No items found / Try changing your search terms, categories, or filters." Clearing restores the full list (Page 1 of N). | `04_catalog_views.spec.js` › `4.4` | Pass |
| INV-005 | Category filter | Manager logged in | 1. Check the default filter.<br>2. Select the largest category.<br>3. Return to All Categories. | Default "All Categories (N)" lists every category and the full catalog. Filtered, every row (all pages) is in that category and the set equals the API's products for it. All Categories restores the full list. | `03_categories.spec.js` › `3.1` | Pass |
| INV-006 | Manage Categories — list | Manager logged in | Open **Categories**. | "Manage Categories" lists every category by name (API order), with Edit and Delete on each, and the add form. (The modal shows names only, no product counts.) | `03_categories.spec.js` › `3.2` | Pass |
| INV-007 | Create category | — | Add `E2E Category <token>`. | 201, "Category Added!", listed in the modal, and offered in the catalog filter and the product form. | `03_categories.spec.js` › `3.3` | Pass |
| INV-008 | Rename category | INV-007 | Edit → new name → **Update Category**. | The dialog is pre-filled, then "Updated!". The new name is shown in the modal and filter; the old name is gone. | `03_categories.spec.js` › `3.4` | Pass |
| INV-009 | Delete category with products (blocked) | A seeded category with products | Delete → confirm. | HTTP 400 and "Cannot Delete: Cannot delete: This category currently contains products. Please reassign those products first." The category stays, and its products are unchanged. | `03_categories.spec.js` › `3.5` | Pass |
| INV-010 | Delete empty category | INV-008 (no products) | Delete → confirm. | "Deleted!", and the category is removed from the modal, the filter and the API. | `03_categories.spec.js` › `3.6` | Pass |
| INV-011 | Add product | Two seeded categories | Fill SKU, name, category, stock 0, cost 45.50, retail 99.75, wholesale 80.25, Active; **Save Product**. | Saved exactly as entered (prices in cents). All +1 and Out of Stock +1. The row shows every entered value. Found by name, and listed only under Out of Stock. (The form has no description, unit or reorder-threshold fields.) | `01_product_crud.spec.js` › `1.1` | Pass |
| INV-012 | Edit product | INV-011 | Open **Edit Product**, check the pre-filled values, change name, category, cost, retail and wholesale; save. | The form is pre-filled with the saved values. The update is stored; the row shows only the new values; the old name finds nothing and the new name finds the product. | `01_product_crud.spec.js` › `1.2` | Pass |
| INV-013 | Restock | INV-012 (stock 0) | **Restock Inventory** → +5 → **Update Stock**. | The dialog shows the product, "Current Stock: 0 Left" and cost; total cost = 5 × cost. The API returns new stock 5, and the row shows "5 Left". Out of Stock −1 and Low Stock +1 (threshold crossed); the product is listed under Low Stock. | `01_product_crud.spec.js` › `1.3` | Pass |
| INV-014 | Stock Movement ledger | INV-013 | Open **Stock Movement**. | The header shows SKU, units and category. Tabs: All 3, POS Sales 0, Restocks 2 (creation + restock), Adjustments 1. The rows are: Initial Catalog "0 units" ("Created product: <old name> (SKU …)"), Adjustment "0 units" ("Updated product: <new name> …"), and Restock "+5 units" ("Restocked 5 unit(s) for: <name> (Stock: 0 → 5)"). Each row has the Manager as user and a `LOG-#####` reference. Each tab lists only its type. | `01_product_crud.spec.js` › `1.4` | Pass |
| INV-015 | Stock Movement search | INV-013 | Search "Restocked", the Manager name, a nonexistent value, then clear. | 1 restock row; then all 3 rows; then "No stock movements found"; then all 3 rows again. | `01_product_crud.spec.js` › `1.5` | Pass |
| INV-016 | Stock Movement export | INV-013 | **Export Excel**. | `<Product>_Stock_Ledger_<date>.xlsx` downloads and contains the SKU and all three movement descriptions. (The export always contains the full ledger, not the selected tab or search.) | `01_product_crud.spec.js` › `1.6` | Pass |
| INV-017 | Activity Feed tabs | Manager logged in | Open **Activity Feed**; open every tab. | All = number of listed activities. Each tab's badge equals the activities it lists, and each lists only its type (POS Sale / Restock / New Product / Adjustment). Every activity belongs to exactly one tab. **Regression test for the bug fixed below.** | `01_product_crud.spec.js` › `1.7` | Pass |
| INV-018 | Activity Feed — test product details, search and export | INV-013 | 1. Search the product token.<br>2. Check each activity.<br>3. Open each tab.<br>4. Search a nonexistent value.<br>5. Clear.<br>6. **Export Excel**. | **New product:** "Created product: …" is badged **New Product** with the Manager as user; the catalog entry "Registered new product: … with 5 units" is New Product too. **Edit:** "Updated product: …" is Adjustment, Manager. **Restock:** "Restocked 5 unit(s) … (Stock: 0 → 5)" is Restock, Manager, `LOG-#####`. Only the product's activities match; each is listed under New Items / Edits / Restocks. A no-match search shows "No matching activities found", and clearing restores all. The export classifies these the same way (New Product / Adjustment / Restock). | `01_product_crud.spec.js` › `1.8` | Pass |
| INV-019 | Delete product without transactions | INV-011 to INV-018 | **Delete Product** → **Confirm Delete**. | HTTP 200, "Deleted!" "Product successfully removed.". Gone from the catalog and **not** under Archived Items; All −1 and Low −1; no longer in the API. | `01_product_crud.spec.js` › `1.9` | Pass |
| INV-020 | Ledger — POS sales | Seeded product with the most POS sales | Open its Stock Movement → **POS Sales**. | POS Sales count = the product's real sale lines. Each row is "POS Sale", "-<qty> units", the sale's invoice as reference, "Sold <qty> unit(s) via POS (₱<subtotal>)", and the cashier who made the sale. | `02_stock_adjustments.spec.js` › `2.1` | Pass |
| INV-021 | Activity Feed — POS sale vs transaction | One real POS checkout (1 unit) by the cashier | Open the Activity Feed → **POS Sales**; find the sale's invoice. | Every entry is a POS Sale. The entry for the new invoice reads "Sold <qty>x <product> via POS (Inv: <invoice>)", with the invoice as reference and the transaction's cashier as user; the transaction contains that product and quantity. | `02_stock_adjustments.spec.js` › `2.2` | Pass |
| INV-022 | Delete product **with** transactions → archive | INV-020 product | 1. **Delete Product** → **Confirm Delete**.<br>2. **Yes, Archive it!**<br>3. Try deleting again. | HTTP 409 `linked_to_transactions`; "Cannot Delete Product: This product has sales history and cannot be permanently deleted. Would you like to Archive it instead…"; "Archived!". Its stock tab −1 and Archived +1; data unchanged and `is_active` false; gone from its stock tab and listed under Archived with identical details. Deleting again shows "…is already archived. It cannot be permanently deleted for auditing purposes." and the product stays. | `02_stock_adjustments.spec.js` › `2.3` | Pass |
| INV-023 | Restore product with transactions | INV-022 | Archived Items → **Restore Product** → **Yes, Restore!** | "Restore this product?" with the product name, then "Updated!" "Product has been successfully restored."; active again. | `02_stock_adjustments.spec.js` › `2.4` | Pass |
| INV-024 | Manual archive | Seeded active product without sales | **Archive Product** → **Yes, Archive!** | "Archive this product?" ("…will hide it from the POS sales screen, but keep its sales logs."), then "Updated!" "Product has been successfully archived.". Its stock tab −1 and Archived +1; gone from its stock tab; listed under Archived with identical details and a Restore action. | `02_stock_adjustments.spec.js` › `2.5` | Pass |
| INV-025 | Restore archived product | INV-024 | Archived Items → **Restore Product** → confirm. | "Updated!" "Product has been successfully restored."; Archived −1 and the original stock tab +1; listed there with identical details and an Archive action; searchable; active in the API. | `02_stock_adjustments.spec.js` › `2.6` | Pass |
| INV-026 | Download — Excel export | Manager logged in | **Data & Export** → **Export to Excel (.xlsx)**. | `<Store>_Inventory_Backup_<date>.xlsx`, sheet "Inventory Report", with the header row (SKU, Name, Category, Retail, Wholesale, Cost, Stock). One row per catalog product, with the stored name, category, retail price and stock. | `05_exports_labels.spec.js` › `5.1` | Pass |
| INV-027 | Download — PDF export | Search one product | **Data & Export** → **Export to PDF Document**. | `<Store>_Inventory_Report_<date>.pdf`, a valid PDF (`%PDF-`, > 1 KB). It contains the searched product's SKU and not other products (the PDF exports the currently filtered list). | `05_exports_labels.spec.js` › `5.2` | Pass |
| INV-028 | Download — import template | — | **Data & Export** → **Download Template**. | `<Store>_Products_Template.xlsx`, sheet "Products Template", with the import headers. | `05_exports_labels.spec.js` › `5.3` | Pass |
| INV-029 | Download — barcode PNG | Active product | **Save PNG Barcode**. | `<Store>_<Product>_barcode.png` is a real PNG of 400×200 px (40×20 mm label ratio); "Saved!" shown. | `05_exports_labels.spec.js` › `5.4` | Pass |
| INV-030 | Print Labels | Active product | 1. **Print Barcode Label**.<br>2. Quantity 3, Thermal Roll.<br>3. **Print Now**. | The "Print Labels" modal shows the product. The generated print document has 3 labels, each with the store name, product name (first 25 characters), price (en-US, 2 decimals) and a PNG barcode image. The print call is invoked once and the modal closes. (Only the native dialog itself is stubbed; see Manual.) | `05_exports_labels.spec.js` › `5.5` | Pass |
| INV-031 | Super Admin has no Inventory | Super Admin logged in | Open `/inventory`. | Redirected to `/developer`; no Inventory heading, search or Add Product. | `06_roles.spec.js` › `6.1` | Pass |
| INV-032 | Manager controls | Manager logged in | Open `/inventory`. | Management subtitle and the Retail Value KPI are shown. Categories, Activity Feed, Data & Export and Add Product are available, plus the Cost Price column. Each row has Restock, Stock Movement, Print Label, Save PNG, Edit, Archive and Delete. Manage Categories (with the add form) and the New Product form open. | `06_roles.spec.js` › `6.2` | Pass |
| INV-033 | Store Admin controls | Store Admin logged in | Same as INV-032. | Same controls as the Manager. | `06_roles.spec.js` › `6.3` | Pass |

## Manual

| ID | Step | Why it is manual | How to verify |
|---|---|---|---|
| INV-M01 | Physical label printing (after INV-030) | `printLabels` opens the browser's native print dialog (`iframe.contentWindow.print()`). Headless Chromium cannot drive it, so the test checks everything up to the print call and stubs only that dialog; it does not fake a successful print. | Click **Print Now**, choose a label printer, and check that 3 labels print with the store, name, price and a scannable barcode, in both Thermal Roll and A4 Sheet layouts. |

## Application bug found and fixed

| Area | Issue (before fix) | Root cause | Fix | Regression coverage |
|---|---|---|---|---|
| Activity Feed | Tab counts didn't match the activities listed. For example, **New Items showed 1 but listed 11**. Real product-creation logs ("Created product: …") were **badged "Adjustment"**, **counted under Edits**, but **listed under New Items** and not under Edits. The Excel export also labelled them "Adjustment". | `Inventory.jsx` classified feed entries with four separate rule sets (tab counts, tab filter, card badge, export). None recognised the audit action `create` written by `ActivityService::logCreate`; they only knew the synthetic `created` entries. | One `getActivityType(log)` helper (sale / stock / create / update) is now used for counts, filters, badges and the export; product `create` logs are New Product. Other rules are unchanged. | INV-017 (count = listed, one tab each), INV-018 (badges and export). Both fail against the original code. |

## Observations (not changed)

- **All Catalog includes archived products** (count and list). This is the existing behaviour, and the tests assert it.
- **Exports:** the PDF follows the current search and filter, while the Excel export, ledger export and activity export always contain the full data.
- **Activity Feed "Registered new product" entries** are generated from the catalog and always show the user "Store Admin". A product created in the UI therefore appears twice under New Items: the real audit log (correct user) and this registration entry.
- **Ledger edit rows** ("Updated product") always show "0 units". Stock changes are recorded through Restock.
- **Product form fields:** the `products` table has `description` and `low_stock_threshold` columns, but the form does not offer them, and the low-stock threshold is fixed at 10 in the UI.
- **API permissions:** `POST /api/products` and `POST /api/products/{id}/stock` are in the "shared" route group (any logged-in user), while update, delete and archive require `admin`. The UI hides these actions from non-admins, but the API does not enforce it. Worth reviewing; not changed here.
