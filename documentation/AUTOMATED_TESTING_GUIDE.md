# 🧪 Automated Testing Documentation & Guide

Comprehensive guide and reference for the **End-to-End (E2E)** and **Backend Unit/Security** test automation suites developed for the **Inertia POS & Retail Management System**.

---

## 📑 Table of Contents
1. [Overview & Architecture](#1-overview--architecture)
2. [Test Directory Structure](#2-test-directory-structure)
3. [Complete Test Coverage Matrix](#3-complete-test-coverage-matrix)
   - [A. Cashier POS Terminal Suite](#a-cashier-pos-terminal-suite)
   - [B. Admin Management Suites](#b-admin-management-suites)
   - [C. Backend Pest Security & Feature Suite](#c-backend-pest-security--feature-suite)
4. [Prerequisites & Server Setup](#4-prerequisites--server-setup)
5. [Execution Commands](#5-execution-commands)
   - [Running E2E Playwright Tests](#running-e2e-playwright-tests)
   - [Running Backend Pest Tests](#running-backend-pest-tests)
6. [Interactive UI Mode & Debugging](#6-interactive-ui-mode--debugging)
7. [Troubleshooting & Gotchas](#7-troubleshooting--gotchas)

---

## 1. Overview & Architecture

The testing suite provides **100% automated verification** without manual clicking or checklist tracking. It combines two industry-standard testing frameworks:

- **Playwright Test (Node.js)**: Performs browser automation across Google Chrome/Chromium, testing user interactions, keyboard hotkeys (`F1`-`F12`), modal dialogs, drawer cash movements, real-time calculations, discount exemptions, and multi-payment settlements.
- **Pest PHP & PHPUnit (Laravel)**: Validates database transactions, role authorization, IP threat blocking, mail rate-limiting cooldowns, and alert dispatchers.

```
┌──────────────────────────────────────────────────────────────┐
│                    AUTOMATED TEST ENGINE                     │
├───────────────────────────────┬──────────────────────────────┤
│       Frontend & E2E          │       Backend & Security     │
│       (Playwright Test)       │           (Pest PHP)         │
├───────────────────────────────┼──────────────────────────────┤
│ • Cashier POS Terminal (F1-F12)│ • IP Threat Blacklisting     │
│ • Shift Lifecycle & Cash Move │ • OTP Mail Rate Limiting     │
│ • Wholesale, Search, Senior   │ • Security Alert Webhooks    │
│ • Multi-Payment Settlement    │ • Authentication & Roles     │
│ • Admin Inventory & Timeline  │ • Tenant / User Life-cycle   │
│ • Analytics, Reports, Shifts  │                              │
└───────────────────────────────┴──────────────────────────────┘
```

---

## 2. Test Directory Structure

```text
inertia-pos-RETAIL/
├── documentation/
│   └── AUTOMATED_TESTING_GUIDE.md        # This Documentation File
├── e2e/
│   ├── fixtures/
│   │   ├── auth.fixture.js              # Shared login & shift opening routines
│   │   └── test-data.js                 # Shared test users & product fixtures
│   ├── 01_auth/
│   │   ├── 01_login.spec.js             # Cashier/Admin sign-in & bad credential tests
│   │   └── 02_profile.spec.js           # Profile view and updates
│   ├── 02_cashier_pos/
│   │   ├── 01_shift_lifecycle.spec.js   # Open shift, float cash, Cash In / Cash Out (F4)
│   │   ├── 02_terminal_switching.spec.js# Active workstation identity
│   │   ├── 03_catalog_and_views.spec.js # Category filter (F1), Search (F2), Wholesale (F3)
│   │   ├── 04_quantity_modal.spec.js    # Numeric quantity input & stock limit validation
│   │   ├── 05_cart_operations.spec.js   # Line item updates, clear cart confirmation (F9)
│   │   ├── 06_discounts_and_tax.spec.js # 20% Senior/PWD VAT-exempt discount (F10)
│   │   ├── 07_held_orders.spec.js       # Park active order (F11) & Recall modal (F8)
│   │   └── 08_checkout_payments.spec.js # Cash (Bills/Change), GCash/Maya, Card approval
│   ├── 03_admin_inventory/
│   │   ├── 01_product_crud.spec.js      # Product list, search & Add Product modal
│   │   ├── 02_stock_adjustments.spec.js # Stock movement history timeline & restock
│   │   └── 03_categories.spec.js        # Category filter pills & list
│   ├── 04_admin_transactions/
│   │   └── 01_sales_history.spec.js     # Transactions table, tabs & Details modal
│   ├── 05_admin_shifts/
│   │   └── 01_shift_history.spec.js     # Shift records list & Z-Reading modal
│   ├── 06_admin_analytics/
│   │   ├── 01_dashboard.spec.js         # KPI metrics (Sales, Profit, Orders, Revenue)
│   │   └── 02_reports.spec.js           # Sales analytics & top selling products
│   └── 07_admin_management/
│       ├── 01_user_management.spec.js   # Staff list, roles & Add Staff modal
│       ├── 02_store_settings.spec.js    # Store profile & POS terminal settings
│       └── 03_activity_logs.spec.js     # System activity logs & audit trail
├── tests/
│   ├── Feature/
│   │   ├── Auth/                        # Authentication & Password Reset tests
│   │   ├── IpBlacklistTest.php          # Probe scanning interception & IP blocking
│   │   ├── ProfileTest.php              # User profile modifications
│   │   └── Security/
│   │       ├── MailThrottlingTest.php   # 60s cooldown per recipient email
│   │       └── SecurityAlertsTest.php   # Queued alert email & Webhook formatting
│   └── Unit/
│       └── ExampleTest.php
├── playwright.config.js                 # Playwright single-worker configuration
└── package.json                         # Automated npm test scripts
```

---

## 3. Complete Test Coverage Matrix

### A. Cashier POS Terminal Suite
Path: `e2e/02_cashier_pos/`

| Spec File | Feature / Function Automated | Hotkeys & Actions Verified |
| :--- | :--- | :--- |
| `01_shift_lifecycle.spec.js` | Shift Lifecycle & Drawer Movements | Shift opening with starting cash float, Active status verification, Cash In / Cash Out drawer movement modal (`F4`). |
| `02_terminal_switching.spec.js` | Terminal Identity | Active workstation header label and terminal session binding. |
| `03_catalog_and_views.spec.js` | Catalog, Search, Wholesale | Category dropdown filter (`F1`), Real-time product search (`F2`), Wholesale mode toggle (`F3`). |
| `04_quantity_modal.spec.js` | Quantity Modal & Stock Constraints | Item click opening quantity dialog, keypad input, max stock constraint validation (`Enter`). |
| `05_cart_operations.spec.js` | Cart State & Management | Item quantity increment/decrement, SweetAlert clear cart confirmation (`F9`), empty order state verification. |
| `06_discounts_and_tax.spec.js` | Senior / PWD 20% Discount & Tax | Senior / PWD toggle (`F10`), 20% discount calculation with 0% VAT exemption calculation. |
| `07_held_orders.spec.js` | Park & Recall Orders | Holding active cart with custom reference note (`F11`), retrieving held order list and recalling back to cart (`F8`). |
| `08_checkout_payments.spec.js` | Multi-Payment Checkout | **Cash**: Quick bill buttons, tendered amount, change calculation.<br>**E-Wallet**: GCash / Maya reference number validation.<br>**Card**: Credit / Debit card approval code validation. |

---

### B. Admin Management Suites
Paths: `e2e/03_admin_inventory/` to `e2e/07_admin_management/`

| Suite / Module | Features Automated |
| :--- | :--- |
| **03 Admin Inventory** | Product inventory table, SKU live search, Add Product modal, Stock Movement History timeline modal, Restock modal, and Category filter pills. |
| **04 Admin Transactions** | Sales history table, status filter tabs (*Cash Checkouts*, *Digital & Cards*, *Senior/PWD Discounts*), Transaction Details modal, and receipt reprint. |
| **05 Admin Shifts** | Cashier shift log table, cash variance display, and Z-Reading breakdown modal. |
| **06 Admin Analytics** | Dashboard summary cards (Gross Sales, Net Profit, Orders, Revenue), top selling products, and Reports export page. |
| **07 Admin Management** | Staff list and roles, Add Staff modal, POS store and terminal configuration, and Activity log audit trail timeline. |

---

### C. Backend Pest Security & Feature Suite
Path: `tests/Feature/`

| Test File | Security & Business Logic Validated |
| :--- | :--- |
| `IpBlacklistTest.php` | Intercepts malicious probe requests (`/.env`, `.git`, `wp-admin`), automatically creates a temporary IP blacklist record in database, returns 403 Forbidden, and allows authenticated users to bypass. |
| `MailThrottlingTest.php` | Restricts OTP verification requests to a strict 60-second cooldown per recipient email to protect mail server quotas and prevent inbox bombing. |
| `SecurityAlertsTest.php` | Formats and dispatches incident alerts to configured Slack/Discord webhooks (with severity colors and incident metadata) and queues email alerts. |
| `Auth/*` & `ProfileTest.php` | Login authentication, logout, password confirmation, password reset tokens, and profile updates. |

---

## 4. Prerequisites & Server Setup

Ensure both the Laravel backend server and Vite frontend server are running:

1. **Start Laravel Backend:**
   ```bash
   php artisan serve
   ```
   *(Running at `http://127.0.0.1:8000`)*

2. **Start Vite Dev Server:**
   ```bash
   npm run dev
   ```

---

## 5. Execution Commands

All tests can be executed using convenient `npm` and `artisan` scripts:

### Running E2E Playwright Tests

```bash
# 1. Run all Cashier POS terminal tests (All 13 features)
npm run test:e2e:cashier

# 2. Run all Admin Management tests (Inventory, Transactions, Shifts, Reports, Users)
npm run test:e2e:admin

# 3. Run the entire End-to-End suite
npm run test:e2e
```

### Running Backend Pest Tests

```bash
# Run all backend feature, security, and unit tests
php artisan test

# Run a specific security test file
php artisan test tests/Feature/IpBlacklistTest.php
php artisan test tests/Feature/Security/MailThrottlingTest.php
php artisan test tests/Feature/Security/SecurityAlertsTest.php
```

---

## 6. Interactive UI Mode & Debugging

Playwright provides a visual test runner with time-travel debugging, screenshots, and DOM inspection:

```bash
npm run test:e2e:ui
```

### Key UI Features:
- **Time-Travel Debugging**: Hover over each action step to see the exact UI state.
- **Console & Network Inspection**: Inspect API requests and responses at each step of the checkout flow.
- **Locator Picker**: Click elements on screen to verify or adjust selectors.

---

## 7. Troubleshooting & Gotchas

1. **Single-Threaded Server Stability (`workers: 1`)**:
   - `playwright.config.js` is configured with `workers: 1` and `fullyParallel: false`. This ensures PHP's built-in single-threaded server (`php artisan serve`) does not experience socket exhaustion or concurrency timeouts.
2. **Local Environment Rate Limiting**:
   - In `app/Providers/AppServiceProvider.php`, API rate limiting is set to `Limit::none()` for local development so automated tests running rapid consecutive requests are never throttled.
3. **Database Drivers**:
   - `phpunit.xml` is configured to use the active MySQL database connection with database transactions rather than missing local SQLite drivers.
