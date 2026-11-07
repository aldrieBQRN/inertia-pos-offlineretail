# 📗 Inertia POS System — Full User Manual

> ⚠️ **Standalone Offline Edition:** this manual predates the standalone conversion. The POS now has a **single Admin account** (created by First-Time Setup, unlocked with a PIN or password) with access to every feature. Sections about Cashier/Manager roles, staff invitations, email login/verification, password reset by email, branches, registers & lanes, activity logs and the developer panel no longer apply. See [README.md](README.md) for setup, sign-in and backups.

> **Version:** 1.0 · **Last Updated:** July 2026
> This manual covers all features available to **Store Admins** and **Cashiers** based on the actual system implementation.

---

## Table of Contents

**Part I — Getting Started**
1. [System Overview](#1-system-overview)
2. [Login & Account Setup](#2-login--account-setup)
3. [Navigation & Layout](#3-navigation--layout)

**Part II — Cashier Guide**
4. [Shift System — How It Works](#4-shift-system--how-it-works)
5. [Using the POS Terminal](#5-using-the-pos-terminal)
6. [Processing a Sale](#6-processing-a-sale)
7. [Discounts — Senior / PWD](#7-discounts--senior--pwd)
8. [Hold & Recall Orders](#8-hold--recall-orders)
9. [Closing a Shift (Z-Read)](#9-closing-a-shift-z-read)
10. [Cashier Settings Page](#10-cashier-settings-page)

**Part III — Store Admin Guide**
11. [Dashboard](#11-dashboard)
12. [Inventory Management](#12-inventory-management)
13. [Category Management](#13-category-management)
14. [Transaction History](#14-transaction-history)
15. [Shift History](#15-shift-history)
16. [Reports & Analytics](#16-reports--analytics)
17. [User Management](#17-user-management)
18. [Store Settings](#18-store-settings)

**Part IV — Reference**
19. [Keyboard Shortcuts (F-Keys)](#19-keyboard-shortcuts-f-keys)
20. [Payment Methods Reference](#20-payment-methods-reference)
21. [Roles & Permissions Summary](#21-roles--permissions-summary)
22. [Troubleshooting](#22-troubleshooting)

---

# Part I — Getting Started

---

## 1. System Overview

Inertia POS is a web-based Point of Sale system for retail stores. It runs in your web browser on desktop, tablet, or mobile. Core capabilities include:

- 🛒 Fast sales processing with barcode scanning, product search, and keyboard shortcuts
- 📦 Real-time inventory tracking with low-stock alerts
- 💰 Continuous shift management with cash reconciliation and Z-Read reports
- 📊 Sales analytics, reports, and data export
- 👥 Multi-user system with Admin and Cashier roles
- 🖨️ Thermal receipt printing via USB or Bluetooth
- 📱 Fully responsive — works on phone, tablet, and desktop

### Role Comparison

| Feature | Admin | Cashier |
|---|---|---|
| Dashboard | ✅ | ❌ |
| POS Terminal | ✅ | ✅ (default) |
| Inventory — View | ✅ | ✅ |
| Inventory — Edit/Delete | ✅ | ❌ |
| Stock Adjustment | ✅ | ✅ |
| Transactions — View | ✅ | ✅ |
| Transactions — Void | ✅ | ❌ |
| Shift History | ✅ (all users) | ✅ (all users) |
| Reports & Analytics | ✅ | ❌ |
| Settings — Edit Store | ✅ | ❌ |
| Settings — Hardware | ✅ | ✅ |
| Settings — Z-Read / Close Shift | ✅ | ✅ |
| User Management | ✅ | ❌ |

---

## 2. Login & Account Setup

### Logging In

1. Open your browser and go to your store's POS URL.
2. The system redirects to the **Login** page.
3. Enter your **Email** and **Password** and click **Log In**.

After login:
- **Admins** → redirected to the **Dashboard**
- **Cashiers** → redirected to the **POS Terminal**

### First-Time Staff Account Setup

When an admin adds you as a new staff member, you will receive an **email invitation** containing a unique setup link. This link is **signed and time-limited** for security.

1. Click the link in your invitation email.
2. You will be taken to the **Account Setup** page.
3. Fill in your details: Full Name, Password, phone number, address.
4. Click **Complete Setup**.
5. Log in with your email and the password you created.

> [!IMPORTANT]
> The invitation link is single-use and expires. If it has expired, ask your admin to resend the invitation.

### Changing Your Password / Profile

1. Click your profile name or avatar in the top-right corner of the sidebar.
2. Go to **Profile**.
3. Update your name, phone, or password as needed.
4. To change your email, you will be required to verify with an **OTP** sent to the new email address.

---

## 3. Navigation & Layout

### Sidebar Navigation

The sidebar is on the left side on desktop, accessible via the hamburger menu (☰) on mobile.

**Admin sidebar items:**
| Item | Page |
|---|---|
| 🏠 Dashboard | KPIs and live sales feed |
| 📦 Inventory | Products and stock management |
| 🧾 Transactions | Full sales history |
| 🕒 Shifts | Z-Read and shift records |
| 📊 Reports | Analytics and export |
| ⚙️ Settings | Store configuration |
| 👥 Users | Staff management |

**Cashier sidebar items:**
| Item | Page |
|---|---|
| 🖥️ POS Terminal | Main selling screen |
| 📦 Inventory | View products, adjust stock |
| 🧾 Transactions | View sales history |
| 🕒 Shifts | View shift records |
| ⚙️ Settings | Hardware and shift close |

### Mobile Layout

- Tap ☰ to open the navigation drawer.
- On the POS Terminal, a floating **"View Order"** bar at the bottom opens the cart view.
- The terminal alternates between the **product catalog** and **cart** on mobile.

---

# Part II — Cashier Guide

---

## 4. Shift System — How It Works

> [!IMPORTANT]
> Understanding how shifts work in this system is critical. **Shifts are continuous** — there is no manual "Open Shift" button on the POS terminal. The system automatically tracks time periods between Z-Read closings.

### How the Continuous Shift Model Works

The system does **not** require you to manually start a shift. Instead:

- **Starting cash** is determined automatically: it equals the **actual cash count entered at the last shift close**.
- If there has never been a shift closed before, starting cash defaults to **₱0.00**.
- Sales are tracked from the **end of the last shift** to the **current moment**.
- The shift "period" covers all time since the previous Z-Read (close).

This means:
- You can start selling **immediately** after logging in.
- The system is always "in shift" — tracking all sales continuously.
- The only action you perform is **closing the shift** (Z-Read) at the end of the day or your work period.

### Live Shift Summary (Settings Page)

Cashiers can view the current shift's running totals at any time by going to **Settings → Shift Summary**:

- **Starting Cash** — the actual cash count from the last close (or ₱0 if first time)
- **Cash Sales** — total cash sales since last close
- **Expected in Drawer** — Starting Cash + Cash Sales
- **Digital Sales Breakdown** — GCash, Maya, Credit, Debit (if any)
- **Total Gross Sales** — all payment methods combined

---

## 5. Using the POS Terminal

The POS Terminal is split into two panels side by side (on desktop and tablet):

| Left Panel | Right Panel |
|---|---|
| **Current Order (Cart)** | **Product Catalog** |

On mobile, these alternate — tap **"View Order"** at the bottom to switch to the cart.

### Product Catalog (Right Panel)

#### Toolbar Controls

| Control | Function |
|---|---|
| **Category button** | Opens a category filter dropdown |
| **Search bar** | Search products by name or SKU/barcode |
| **Wholesale Mode toggle** | Switch all prices to wholesale pricing |
| **Results Only toggle** | Hide catalog until a search is typed (scan-mode) |
| **+ Custom Item button** | Add a new product on the fly |

#### Searching for Products

- **By name** — Type any part of the product name
- **By SKU/Barcode** — Type or scan the barcode. When a single match is found or a SKU is exact-matched, the system auto-selects and opens the quantity modal
- **USB Barcode Scanner** — Plug in a USB scanner. Scanning auto-triggers the quantity entry modal with a beep
- **Camera Scanner** — Available in Inventory for scanning barcodes via the device camera

#### Filtering by Category

1. Click the **Category** button (left of the search bar) — or press **F5**.
2. A dropdown appears with colored category badges.
3. Select a category. The catalog filters immediately.
4. Select **All Categories** to clear.
5. Press **Escape** or click outside to close the dropdown.

#### Product List Columns (Desktop)

| Column | Description |
|---|---|
| **SKU / Barcode** | Unique product code (click to copy) |
| **Product Name / Category** | Name + colored category badge |
| **Stock** | Remaining available stock |
| **Price** | Retail or wholesale price (depends on mode) |

#### Stock Color Indicators

| Color | Meaning |
|---|---|
| 🟢 Green | Normal stock level |
| 🟠 Orange | Low stock (fewer than 10 units) |
| 🔴 "Sold Out" | Zero stock — item cannot be added to cart |

> [!NOTE]
> Stock shown in the catalog is **remaining stock minus what is already in the current cart**. So if a product has 5 in stock and 3 are already in your cart, it shows 2 remaining.

#### Adding a Product to Cart

1. Click or tap any product row in the catalog.
2. A **Quantity Modal** appears.
3. The quantity field defaults to **1**.
4. Type the desired quantity (validated against available stock).
5. Press **Enter** or click **Add to Cart**.

If the item's SKU was scanned with a USB scanner, the product is added immediately with the quantity prompt.

#### Wholesale Mode

Toggle the **Wholesale Mode** switch (or press **F2**) to activate wholesale pricing:
- All products in the catalog display their **wholesale price** instead of retail.
- Cart totals are calculated using wholesale prices.
- Applies to all items — you cannot mix retail and wholesale in one transaction.

#### Results Only Mode

Toggle **Results Only** (or press **F3**) to hide the product catalog until you type or scan something. This is useful for high-speed scan-only checkout workflows.

---

## 6. Processing a Sale

### Cart Panel (Left Side)

The cart shows:
- All items in the current order
- Per-item: Quantity, Product Name, Unit Price, Line Total
- Footer: Subtotal, Senior/PWD Discount (if applied), and **Grand Total**

#### Cart Column Headers (Desktop)

| Column | Description |
|---|---|
| **Qty** | Quantity with +/– buttons (appear on hover or when selected) |
| **Description** | Product name with remove (×) button |
| **Price** | Unit price |
| **Amount** | Line total (Qty × Price) |

#### Modifying Cart Items

| Action | Method |
|---|---|
| Increase qty by 1 | Click **+** button (appears on hover/focus), or press **+** key when item is selected |
| Decrease qty by 1 | Click **–** button (appears on hover/focus), or press **–** key |
| Remove one unit | **–** button / **–** key (when qty is 1, item is removed) |
| Remove all units | Click the **×** (X) button beside the item name, or press **Backspace/Delete** when item is selected |
| Edit quantity directly | Click the item row in the catalog again and enter new qty in the modal |
| Clear entire cart | Click the **Clear (F10)** button at the top of the cart → confirm |

#### Cart Navigation (Keyboard)

Press **F6** to toggle **Cart Navigation Mode**:
- An item in the cart is highlighted with an indigo ring
- **Arrow Up/Down** — move selection between items
- **+** / **–** keys — increase / decrease quantity of selected item
- **Backspace/Delete** — remove selected item entirely
- **Escape** — exit cart navigation mode

### Checkout

1. Review all items and the **Grand Total** in the cart footer.
2. Click **Checkout (F12)** — the **Checkout Modal** opens.

#### Checkout Modal — Payment Method Selection

The modal presents **three top-level payment categories**:

| Category | Key (F-Key) | Sub-methods |
|---|---|---|
| **Cash** | F1 | Cash only |
| **E-Wallet** | F2 | GCash (F3), Maya (F4) |
| **Card** | F7 | Credit (F8), Debit/BancNet (F9) |

#### Cash Payment

1. Select **Cash (F1)**.
2. Enter the **Cash Received** amount.
3. The **Change Due** is calculated and displayed automatically.
4. If cash given is less than the total, the system blocks submission with an error.
5. Click **Confirm Payment (Enter)** to complete.

#### E-Wallet Payment (GCash / Maya)

1. Select **E-Wallet (F2)**.
2. Choose **GCash (F3)** or **Maya (F4)**.
3. Enter the **Payment Reference Number** (from the GCash/Maya transaction).
4. Click **Confirm Payment (Enter)**.

> [!IMPORTANT]
> A reference number is **required** for all E-Wallet and Card payments. The system will not allow submission without it.

#### Card Payment (Credit / Debit)

1. Select **Card (F7)**.
2. Choose **Credit (F8)** or **Debit/BancNet (F9)**.
3. Enter the **Terminal Reference Number** (from the card terminal receipt).
4. Click **Confirm Payment (Enter)**.

#### After Checkout — Success Screen

After a successful transaction, a **Payment Successful** screen appears with two options:

| Button | Action | Keyboard |
|---|---|---|
| **Print Receipt** | Sends receipt to connected thermal printer | Enter |
| **New Order** | Clears the success screen, ready for next sale | Escape |

The cart is cleared automatically after a successful checkout.

---

## 7. Discounts — Senior / PWD

The system includes a **Senior Citizen / PWD discount** feature, which is the only built-in discount type. There is no separate "Custom Discount" option.

### Senior / PWD Discount Button

Located at the top-right of the cart panel. It is labelled **Discount (F9)**.

- Pressing **F9** or clicking the **Discount** button toggles the Senior/PWD discount on or off.
- When **active**, the button turns yellow/amber to indicate it is applied.
- The cart footer displays: `Less: Senior/PWD (20%)` with the amount deducted.

### How the Discount is Calculated (Backend — Philippine Standard)

- A **20% discount** is applied to the entire subtotal.
- The backend (`PosController`) applies: `discountAmount = subtotal × 0.20`, then `total = subtotal − discountAmount`.
- This is recorded in the sale record as `discount_amount` and `is_senior = true`.
- No VAT-exclusive recalculation is shown in the UI — the 20% is a flat subtotal discount.

> [!NOTE]
> The Senior/PWD discount is a **single toggle for the entire order**. It cannot be applied to individual items only.

---

## 8. Hold & Recall Orders

Hold Orders (also called "Parked Orders") let you save the current cart and serve a different customer, then come back to the saved order later.

### Holding (Saving) an Order

1. With at least one item in the cart, click the **Save (F8)** button.
2. A dialog box appears asking for an optional **Reference Note** (e.g., "Table 5" or "Juan Santos").
3. Enter a note or leave blank (a random order number is assigned automatically).
4. Click **Save Order**.
5. The cart clears immediately, ready for a new order.

### Recalling a Held Order

1. Click **Recall (F7)** in the cart header.
2. The **Held Orders Modal** opens, listing all saved orders with their reference notes and totals.
3. Navigate with the **Arrow Up/Down** keys or click on an order.
4. Press **Enter** or click **Recall** to load the order into the cart.

> [!WARNING]
> Recalling an order **replaces your current cart entirely**. If you have items in the cart, hold or clear them first.

### Discarding a Held Order

In the Held Orders modal:
- Navigate to the order you want to discard.
- Press **Backspace** or **Delete**, or click the discard option.
- Confirm the deletion.

The order is permanently deleted from the held orders list.

### Keyboard Shortcuts in the Held Orders Modal

| Key | Action |
|---|---|
| **Arrow Up/Down** | Navigate between orders |
| **Enter** or **F7** | Recall the selected order |
| **Backspace / Delete** | Discard the selected order |
| **Escape** | Close the modal |

---

## 9. Closing a Shift (Z-Read)

At the end of your work period, you perform a **Z-Read** to close the shift. This records your cash count, calculates over/short, and emails a summary to all store admins.

### How to Close a Shift

1. Go to **Settings** in the sidebar.
2. Click the **Shift Summary** accordion section to expand it.
3. Review the live summary (Starting Cash, Cash Sales, Expected in Drawer, Digital Sales).
4. Click the **"Perform Z-Read & Close Shift"** button.
5. The **Close Shift Modal** appears with two steps.

### Close Shift Modal — Step by Step

#### Step 1: Drawer Cash Count (Required)

- Count the physical cash in your drawer.
- Enter the **actual cash count** in the large input field (in Philippine Peso ₱).
- This is the total cash physically present in the drawer.

#### Step 2: Total Expenses (Optional)

- Enter any cash that was **taken out of the drawer for store expenses** (e.g., petty cash payments).
- Leave at **₱0.00** if no cash was removed.

#### Click "Finalize & Close Shift"

The system calculates:

```
Expected in Drawer = Starting Cash + Cash Sales − Expenses
Difference = Actual Count − Expected in Drawer
```

If `Difference > 0` → **Drawer Overage** (more cash than expected)  
If `Difference < 0` → **Drawer Shortage** (less cash than expected)  
If `Difference ≈ 0` → **BALANCED**

### Z-Read Summary Screen

After closing, a **Z-Read Summary** is displayed showing:

| Item | Description |
|---|---|
| Starting Cash | Cash at the start of this period (last close's actual count) |
| Cash Sales | Total cash received from all cash transactions |
| Less: Expenses | Cash removed from drawer for expenses (if entered) |
| Expected in Drawer | Starting Cash + Cash Sales − Expenses |
| Actual Count | The amount you physically counted |
| **Drawer Status** | BALANCED / Overage / Shortage |
| **Non-Cash Sales** | GCash, Maya, Credit Card, Debit/BancNet totals |
| **Total Gross Sales** | All payment methods combined |

### After Z-Read

Two action buttons appear:

| Button | Action |
|---|---|
| **Print Z-Read Report** | Sends the Z-Read to the connected thermal printer |
| **Logout** | Logs you out of the system cleanly |

> [!IMPORTANT]
> The **actual cash count you entered becomes the starting cash for the NEXT shift period**. Count your drawer carefully before entering — there is no way to edit this after closing.

> [!TIP]
> After closing, the system emails a shift summary to all store admins automatically.

---

## 10. Cashier Settings Page

Navigate to **Settings** in the sidebar. Cashiers see a read-only store info card on the left, and the following accordion sections on the right.

### Left Card — Store Identity

- Displays the **store logo**, **store name** (read-only).
- Below the logo: **Address** and **Phone** displayed as read-only text.

### Hardware Section

Click **Hardware** to expand.

#### POS Keyboard Shortcuts (Desktop only)

Toggle to **Enable** or **Disable** F-Key shortcuts (F1–F12) for the POS Terminal on this device. Only visible on screens ≥ 1024px wide.

#### Full Screen Mode

Toggle to enter or exit browser fullscreen mode for a distraction-free POS display.

#### Thermal Printer

The printer card shows:
- **Connection Status**: Connected (USB) / Connected (Bluetooth) / Offline (with a pulsing dot indicator)
- **Paper Width**: 58mm or 80mm selector

**If not connected:**
- On **desktop**: Click **Pair USB** to open the browser's USB device picker.
- On **mobile**: Click **Pair Bluetooth** to open the Bluetooth device picker.

**If connected:**
| Button | Action |
|---|---|
| **Test Print** | Sends a test page to verify connection and paper width |
| **Open Drawer** | Triggers the cash drawer to open (if connected via printer) |
| **Disconnect** | Unpairs the current device |

### Shift Summary Section

Click **Shift Summary** to expand. Shows live running totals for the current shift period:

- Started (date/time of last close, or beginning of time if first shift)
- Active Shift badge
- Starting Cash
- Cash Sales
- Expected in Drawer
- Digital Sales breakdown (GCash, Maya, Credit, Debit — only shown if > ₱0)
- Total Gross Sales

At the bottom: **"Perform Z-Read & Close Shift"** button.

### Legal & Agreements Section

Click **Legal & Agreements** to expand.

Two documents are available to view (read-only for cashiers):
- **Staff Acceptable Use Policy**
- **Staff Privacy Policy**

Click **View Terms** or **View Privacy** to open each document in a scrollable modal.

---

# Part III — Store Admin Guide

---

## 11. Dashboard

The Dashboard is the admin's home screen. It **auto-refreshes every 5 seconds** silently.

### KPI Cards (Top Row)

| Card | What it shows |
|---|---|
| **Today's Revenue** | Total sales amount for today |
| **Today's Profit** | Revenue minus total cost of goods sold |
| **Transactions** | Number of completed sales today |
| **Avg. Order Value** | Average sale amount per transaction |

Each card includes a **growth arrow** (↑ or ↓) with a percentage comparing today to the previous day/period.

### Sales Trend Chart

An area/line chart showing daily sales for the past 7 days. Hover over data points to see exact values. The chart only renders if there is at least one day with a sale > 0.

### Recent Transactions

A live table of the most recent sales:
- Transaction time
- Item count / summary
- Payment method (colored badge): Cash (gray), GCash (blue), Maya (green), Credit (purple), Debit (indigo)
- Total amount

### Low Stock Panel

Products below the low-stock threshold are shown here for quick identification. Use this to reorder inventory before items run out.

---

## 12. Inventory Management

Navigate to **Inventory** in the sidebar. Inventory data auto-syncs every 5 seconds.

### Product Table

Each product row shows:
- Product image (thumbnail)
- SKU / Barcode
- Product name
- Category (colored badge)
- Cost Price
- Retail Price
- Wholesale Price
- Stock Quantity
- Status (Active / Archived)
- Actions menu (⋮)

10 products are shown per page with pagination controls.

### Filtering & Searching

| Filter | Description |
|---|---|
| **Search** | Filter by product name or SKU |
| **Category** | Dropdown to filter by one category |
| **Low Stock** | Toggle to show only products with low inventory |
| **Status** | Show All, Active only, or Archived only |

### Adding a New Product

1. Click **+ Add Product** (top-right corner).
2. The **Add Product Modal** opens.
3. Fill in the fields:

| Field | Required | Notes |
|---|---|---|
| **Product Name** | ✅ | Display name |
| **SKU / Barcode** | ✅ | Unique identifier; can scan with USB scanner while modal is open |
| **Category** | ✅ | Select from existing categories |
| **Cost Price** | ✅ | Purchase/landed cost (used for profit calculations) |
| **Retail Price** | ✅ | Customer-facing selling price |
| **Wholesale Price** | ⬜ | Optional; used when Wholesale Mode is active in POS |
| **Initial Stock Qty** | ✅ | Starting inventory count |
| **Product Image** | ⬜ | JPEG / PNG photo |

4. Click **Save Product**.

> [!TIP]
> USB barcode scanner support is active while the Add Product modal is open. If the scanner types into another field, the system automatically redirects the input to the SKU field.

### Editing a Product

1. Click the **⋮ Actions** menu on the product row.
2. Select **Edit**.
3. Modify any fields.
4. Click **Save Changes**.

### Archiving vs. Deleting

**Archive** (recommended): Hides the product from the POS catalog without deleting it. The product's sales history is preserved.
1. Click **⋮ Actions** → toggle to **Archive** (or use the Status toggle).
2. To restore: Filter by **Archived**, find the product, toggle back to **Active**.

**Delete** (permanent):
1. Click **⋮ Actions** → **Delete**.
2. Confirm the deletion.

> [!CAUTION]
> Product deletion is **permanent** and cannot be undone. Use Archive unless you are certain.

### Stock Adjustment

For manual stock changes (receiving new shipment, corrections, etc.):
1. Click **⋮ Actions** → **Adjust Stock**.
2. Enter the adjustment value:
   - Positive number → add stock (e.g., `+50` to receive 50 units)
   - Negative number → reduce stock (e.g., `-5` for damaged/lost)
3. Enter a reason/note.
4. Click **Save Adjustment**.

### Printing Barcode Labels

1. Click **⋮ Actions** → **Print Label**.
2. Select quantity of labels to print.
3. Select format:
   - **Thermal** — for direct thermal printer
   - **A4** — for printing a sheet of labels on standard paper
4. Click **Print**.

### Bulk Import (Excel / CSV)

1. Click the **Import** button.
2. Download the **Template file** to see the required column format.
3. Fill in your product data. To assign a new category, simply type the new category name in the Category column — it will be created automatically.
4. Upload the completed file.
5. Review the import preview and confirm.

### Exporting Inventory

Click the **Export** button and choose:
- **Excel (.xlsx)** — Full product data spreadsheet
- **PDF** — Printable formatted inventory report

---

## 13. Category Management

Categories organize products in the POS catalog and inventory.

### Opening the Category Manager

In the Inventory page, click the **Manage Categories** button.

### Adding a Category

1. Click **+ Add Category**.
2. Enter the **Category Name**.
3. Pick a **Color** — used as the badge color in the POS and inventory.
4. Click **Save**.

### Editing a Category

1. Click the **Edit** (pencil) icon next to the category.
2. Change name or color.
3. Click **Save**.

### Deleting a Category

1. Click the **Delete** (trash) icon.
2. Confirm.

> [!WARNING]
> Deleting a category **removes the category assignment** from all products in that category. Those products will have no category until reassigned. This does not delete the products themselves.

---

## 14. Transaction History

Navigate to **Transactions** in the sidebar. Data auto-refreshes every 5 seconds.

### Transaction List

Each row shows:
- Invoice number (e.g., `INV-001-20260703-0012`)
- Date and time
- Cashier name
- Payment method (badge)
- Total amount
- Status: **Completed** or **Voided**

### Filtering Transactions

| Filter | Description |
|---|---|
| **Search** | Filter by invoice number or cashier name |
| **Start Date / End Date** | Date range filter |
| **Payment Method** | Filter by Cash, GCash, Maya, Credit Card, or Debit Card |

### Viewing Transaction Details

Click the **view icon** on a row to open the **Transaction Detail Modal**:

- Invoice number and transaction timestamp
- Cashier name
- Full itemized list: Product Name, Quantity, Unit Price, Line Total
- **Senior/PWD Discount** (if applied)
- Grand Total
- Payment method
- Cash Given and Change (for cash transactions)
- Reference number (for E-Wallet / Card)

### Reprinting a Receipt

In the Transaction Detail Modal or directly from the list:
- Click the **Print / Reprint Receipt** icon.
- Requires a printer connected in Settings.

### Voiding a Transaction

> [!WARNING]
> Voiding a transaction is **permanent and irreversible**. It automatically **restores inventory stock** for all voided items.

Only **Admins** can void transactions.

1. Open the Transaction Details.
2. Click **Void Transaction**.
3. A confirmation dialog appears.
4. Confirm the void.

The transaction status changes to **Voided** and stock quantities are restored.

### Exporting Transactions

Click **Export** to download filtered transactions as:
- **PDF** — Formatted transaction report
- **Excel (.xlsx)** — Spreadsheet for analysis

---

## 15. Shift History

Navigate to **Shifts** in the sidebar. Data auto-refreshes every 5 seconds.

### Shift List

Each row shows:
- Cashier name
- Shift start time (beginning of the period, i.e., the previous close time)
- Shift end time (the Z-Read close time)
- Status

### Filtering Shifts

| Filter | Description |
|---|---|
| **Search** | Search by cashier name |
| **Start Date / End Date** | Date range filter |

### Viewing Shift Details

1. Click the **View** icon on a shift row.
2. The **Shift Details Modal** loads data from the server.
3. The modal shows:

| Field | Description |
|---|---|
| Cashier Name | Who closed the shift |
| Start Time | Time the period began (previous close) |
| End Time | Time the Z-Read was performed |
| Starting Cash | Actual count from the previous close |
| Cash Sales | Sum of all cash transactions in this period |
| GCash Sales | Sum of GCash transactions |
| Maya Sales | Sum of Maya transactions |
| Credit Card Sales | Sum of credit card transactions |
| Debit/BancNet Sales | Sum of debit card transactions |
| Expenses | Cash removed from drawer |
| Total Gross Sales | All payment methods combined |
| Expected in Drawer | Starting Cash + Cash Sales − Expenses |
| Actual Cash Count | What the cashier counted |
| Difference | Overage (+) or Shortage (−) |

### Reprinting Z-Read

In the Shift Details modal, click **Print Z-Read** to send the historical Z-Read to the connected printer.

### Exporting Shift Reports

Click **Export** to download shift history as a **PDF** report.

---

## 16. Reports & Analytics

Navigate to **Reports** in the sidebar. **Admin only.**

### Date Range Selection

**Quick Presets:**
- Today
- Yesterday
- Last 7 Days *(default on first load)*
- Last 30 Days
- This Month
- Last Month

**Custom Range:** Use the date picker inputs. Reports auto-refresh when the date range changes (with a 500ms debounce).

### Summary KPI Cards

| KPI | Description |
|---|---|
| Total Revenue | Sum of all completed sales in the period |
| Total Profit | Revenue minus total cost of goods |
| Total Orders | Number of completed transactions |
| Avg. Order Value | Average transaction amount |

Each KPI shows a growth % vs. the previous equivalent period.

### Sales Trend Chart

An area chart showing **daily sales** over the selected date range. Helps identify trends, peak days, and slow periods.

### Peak Hours Heatmap

A heatmap showing which hours of the day generate the most sales — useful for staffing schedules and promotional timing.

### Peak Days & Peak Months

Charts showing which days of the week and months of the year have the highest transaction volumes.

### Payment Method Breakdown

A pie chart comparing:
- Cash
- GCash
- Maya
- Credit Card
- Debit Card

### Top Selling Products

A ranked list of best-performing products by units sold and revenue generated.

### Category Performance

A bar chart and table showing revenue contribution by product category.

### Exporting Reports

Click **Export** to choose:
- **PDF** — Multi-section formatted report
- **Excel (.xlsx)** — Raw data for custom analysis in spreadsheet software

---

## 17. User Management

Navigate to **Users** in the sidebar. **Admin only.** Data auto-refreshes every 5 seconds.

### User List

Each row shows:
- Account Number (auto-assigned)
- Full name
- Email address
- Role: **Admin** or **Cashier**
- Status: **Active** or **Inactive**

### Filtering Users

| Filter | Description |
|---|---|
| **Search** | Search by name, email, or account number |
| **Role** | Filter by Admin or Cashier |

10 users per page with pagination.

### Viewing a User Profile

Click the **view (eye) icon** on a user row to open a read-only **User Profile Modal** showing all their details: name, account number, email, role, phone, address, city, province, avatar.

### Adding a New Staff Member

1. Click **+ Add User**.
2. Fill in the form:

| Field | Required | Notes |
|---|---|---|
| **Full Name** | ✅ | |
| **Account Number** | ✅ | Auto-incremented; can be customized |
| **Email** | ✅ | Used as login username |
| **Role** | ✅ | Admin or Cashier |
| **Phone Number** | ⬜ | Numbers only |
| **Address / City / Province** | ⬜ | |
| **Password** | ✅ | Initial login password |
| **Avatar Photo** | ⬜ | Profile picture |

3. Click **Save User**.
4. The staff member receives an **email invitation** with a setup link to complete their profile.

### Editing a Staff Member

1. Click **⋮ Actions** → **Edit** (or open the profile modal and click Edit).
2. For most fields: edit directly and save.
3. **To change the email address:**
   - Enter the new email.
   - Click **Send OTP**.
   - An OTP is sent to the **new email address**.
   - Enter the OTP in the verification field.
   - Save changes.

### Activating / Deactivating a User

1. Click **⋮ Actions** → **Toggle Active Status** (or click the status toggle).
2. A deactivated user cannot log in. Reactivate by toggling again.

### Deleting a User

1. Click **⋮ Actions** → **Delete**.
2. Confirm.

> [!CAUTION]
> User deletion is permanent. Consider deactivating instead to preserve audit history.

---

## 18. Store Settings

Navigate to **Settings** in the sidebar.

### Left Card — Store Identity

Displays the store **logo** and **store name**. Admins see an **Edit Details** button here.

### Edit Store Details (Admin Only)

Click **Edit Details** to open the Edit Store Modal:

| Field | Description |
|---|---|
| **Store Logo** | Click the logo circle or "Choose new image" to upload (JPEG, PNG, WebP — max 2MB, recommended 500×500px) |
| **Store Name** | Business name shown on receipts and the system header |
| **Address** | Physical store address |
| **Phone Number** | Contact number |

Click **Save Changes** to apply. The logo and store name update immediately across the entire system including the sidebar header.

### Store Details Accordion (Admin)

Click **Store Details** to expand a read-only view of the current store name, address, and phone.

### Legal & Agreements (Admin Only)

Click **Legal & Agreements** to expand. Contains four policy documents:

| Document | Who it applies to |
|---|---|
| **Platform Terms of Service** | Store admins / store owners |
| **Platform Privacy Policy** | Store admins / store owners |
| **Staff Acceptable Use Policy** | All cashiers and staff |
| **Staff Privacy Policy** | All cashiers and staff |

Click **View Terms** or **View Privacy** to open each in a scrollable modal. These documents are managed by the platform and are read-only for store admins.

### Hardware Section (Admin)

Admins have access to the same hardware settings as cashiers — see [Section 10](#10-cashier-settings-page) for the full hardware guide.

---

# Part IV — Reference

---

## 19. Keyboard Shortcuts (F-Keys)

> [!NOTE]
> Keyboard shortcuts are available on **desktop only** (screen width ≥ 1024px). They can be enabled/disabled via Settings → Hardware → POS Keyboard Shortcuts toggle.

### POS Terminal — Main Screen

| Key | Action |
|---|---|
| **F1** | Toggle focus on the Search bar |
| **F2** | Toggle Wholesale Mode on/off |
| **F3** | Toggle Results-Only Mode |
| **F4** | Open Add Custom Item modal |
| **F5** | Open/close Category filter dropdown |
| **F6** | Toggle Cart Navigation mode (highlights cart items) |
| **F7** | Open Held Orders (Recall) modal |
| **F8** | Save (hold) current order |
| **F9** | Toggle Senior/PWD Discount |
| **F10** | Clear cart (with confirmation) |
| **F11** | Open cash drawer |
| **F12** | Open Checkout modal |
| **Arrow Up/Down** | Navigate product list (from search bar) |
| **Enter** | Add highlighted product / confirm quantity |
| **Escape** | Close any open modal or dropdown |

### Cart Navigation (when F6 is active)

| Key | Action |
|---|---|
| **Arrow Up/Down** | Move between cart items |
| **+** / **=** / Numpad + | Increase qty of selected item |
| **–** / Numpad − | Decrease qty of selected item |
| **Backspace / Delete** | Remove entire selected item from cart |
| **Escape** | Deactivate cart navigation |

### Category Dropdown (when open via F5)

| Key | Action |
|---|---|
| **Arrow Up/Down** | Navigate categories |
| **Enter** | Select highlighted category |
| **Escape** | Close dropdown |

### Held Orders Modal (when open)

| Key | Action |
|---|---|
| **Arrow Up/Down** | Navigate held orders |
| **Enter** or **F7** | Recall highlighted order |
| **Backspace / Delete** | Discard highlighted order |
| **Escape** | Close modal |

### Checkout / Payment Modal (when open)

| Key | Action |
|---|---|
| **F1** | Select Cash payment |
| **F2** | Select E-Wallet payment |
| **F7** | Select Card payment |
| **F3** | Select GCash *(when E-Wallet is active)* |
| **F4** | Select Maya *(when E-Wallet is active)* |
| **F8** | Select Credit Card *(when Card is active)* |
| **F9** | Select Debit/BancNet *(when Card is active)* |
| **Enter** | Confirm payment |
| **Escape** | Cancel / close modal |

### After Checkout — Success Screen

| Key | Action |
|---|---|
| **Enter** | Print receipt |
| **Escape** | New order (dismiss success screen) |

### Add Custom Item Modal (when open)

| Key | Action |
|---|---|
| **F1** | Focus SKU / Barcode field |
| **F2** | Auto-generate next sequential SKU |
| **F3** | Focus Product Name field |
| **F5** | Open Category dropdown |
| **F6** | Focus Initial Stock field |
| **F7** | Focus Cost Price field |
| **F8** | Focus Retail Price field |
| **F9** | Focus Wholesale Price field |
| **Enter** | Submit the form |
| **Escape** | Close modal |

---

## 20. Payment Methods Reference

| Method | Category | Badge Color | Input Required |
|---|---|---|---|
| **Cash** | Cash | Gray | Cash amount received (change auto-calculated) |
| **GCash** | E-Wallet | Blue | GCash reference / transaction number |
| **Maya** | E-Wallet | Green | Maya reference / transaction number |
| **Credit Card** | Card | Purple | Card terminal approval code |
| **Debit / BancNet** | Card | Indigo | Card terminal reference number |

---

## 21. Roles & Permissions Summary

### What Cashiers Can Do

| Feature | Access |
|---|---|
| POS Terminal — sell | ✅ Full |
| Wholesale Mode | ✅ Full |
| Senior/PWD Discount | ✅ Full |
| Hold & Recall Orders | ✅ Full |
| Add Custom Items (POS) | ✅ Full |
| Open Cash Drawer | ✅ Full |
| Print Receipts | ✅ Full |
| Inventory — View | ✅ Full |
| Inventory — Adjust Stock | ✅ Full |
| Inventory — Add/Edit/Delete Products | ❌ No |
| Category Management | ❌ No |
| Transactions — View | ✅ Full |
| Transactions — Void | ❌ No |
| Transactions — Reprint Receipt | ✅ Full |
| Shift History — View | ✅ All shifts |
| Reports | ❌ No |
| Dashboard | ❌ No |
| Settings — View store info | ✅ Read-only |
| Settings — Edit store info | ❌ No |
| Settings — Hardware config | ✅ Full |
| Settings — Z-Read / Close Shift | ✅ Full |
| Settings — View legal policies | ✅ Read-only |
| User Management | ❌ No |

### What Admins Can Do

Everything Cashiers can do, **plus**:

| Feature | Access |
|---|---|
| Dashboard | ✅ Full |
| Inventory — Add/Edit/Delete | ✅ Full |
| Inventory — Bulk Import/Export | ✅ Full |
| Category Management — Full CRUD | ✅ Full |
| Transactions — Void | ✅ Full |
| Reports & Analytics | ✅ Full |
| Settings — Edit Store Details | ✅ Full |
| Settings — View Legal Policies | ✅ Full |
| User Management — Full CRUD | ✅ Full |
| Activity Logs | ✅ Full |

---

## 22. Troubleshooting

### 🔴 Cannot process a sale — "No shift" message

**Reality:** The system uses a **continuous shift model**. You can sell any time without opening a shift. If you see a "no active shift" notice in the Settings page's Shift Summary, it simply means there are no sales recorded since the last Z-Read — this does not block you from selling.

---

### 🔴 Product shows "Sold Out" but should be in stock

**Cause 1:** The item's remaining stock minus the quantity already in your cart equals zero.
**Fix:** Check your current cart. If items are already there, that stock is reserved.

**Cause 2:** Actual inventory is zero.
**Fix (Admin):** Go to Inventory → find the product → Adjust Stock to add units.

---

### 🔴 Barcode scan doesn't find the product

**Cause:** The barcode on the physical item doesn't match the SKU stored in the system.
**Fix:** Check the product's SKU in Inventory matches the barcode exactly. Test by scanning into a text editor first.

---

### 🔴 Receipt is not printing after checkout

| Symptom | Fix |
|---|---|
| No printer shown | Go to Settings → Hardware → Pair USB (desktop) or Pair Bluetooth (mobile) |
| Printer paired but nothing prints | Check paper roll is loaded. Click **Test Print** to verify. |
| Wrong receipt width / text cut off | Go to Settings → Hardware → change Paper Width to match roll (58mm or 80mm) |
| Bluetooth printer disconnected | Go to Settings → Hardware → Disconnect, then re-Pair |

---

### 🔴 "Missing Reference" error when paying by E-Wallet or Card

**Cause:** A reference/approval number is required for all non-cash payments.
**Fix:** Enter the GCash/Maya transaction number or the card terminal receipt code before confirming.

---

### 🔴 Cannot void a transaction

**Cause:** Only Admins can void transactions. Cashiers do not have this permission.
**Fix:** Ask your store admin to process the void.

---

### 🔴 "Insufficient Cash" error during checkout

**Cause:** The cash amount entered is less than the total amount due.
**Fix:** Enter the correct amount the customer is paying. The system won't allow change to be negative.

---

### 🔴 Starting cash seems wrong on Z-Read

**How it works:** Starting cash is always the **actual cash count from the previous Z-Read**. If the previous cashier entered an incorrect amount at close, that carries forward.
**Fix:** Enter the correct actual count this time. Going forward, closing counts must be accurate.

---

### 🔴 Session expired / redirected to Login

**Cause:** Browser session has timed out due to inactivity.
**Fix:** Log in again. Your cart data is stored locally in the browser and should still be present after re-login.

---

### 🔴 Report data appears incomplete

**Cause:** Z-Reads were not performed, or the date range filter excludes the period.
**Fix:**
1. Verify the date range selected in Reports.
2. Confirm that cashiers performed Z-Reads covering the periods you're analyzing.
3. Use **Last 7 Days** preset first to confirm current data is loading.

---

*For technical support, contact your system administrator.*

---

**End of Manual** · Inertia POS System v1.0
