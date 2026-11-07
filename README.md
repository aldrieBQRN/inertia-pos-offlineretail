# Inertia POS: Standalone Offline Edition

A single-store point of sale and inventory system that runs entirely on one computer. It needs no internet connection, no cloud account and no separate database server.

- **One store, one device.** All data lives in a local SQLite file.
- **One Admin account.** It is created on first launch and unlocks with a 4-digit PIN, a 6-digit PIN or a strong password.
- **Fully offline.** Fonts, icons, scripts and styles are bundled with the app. It makes no external requests.

Built with Laravel 12, React, Inertia.js and Tailwind CSS.

---

## Features

| Area | What you can do |
|---|---|
| **POS Terminal** | Barcode or search checkout, hold and recall orders, quantity entry, Senior/PWD and custom discounts, wholesale pricing, cash/GCash/Maya/card payments, thermal receipt printing |
| **Shifts & Cash** | Open and close shifts, cash in/out, owner draw, safe drop, expenses, Z-Read, over/short detection |
| **Inventory** | Products, categories, SKU and barcode, stock adjustments with a full movement ledger, low-stock alerts, CSV/Excel import and export, barcode labels |
| **Transactions** | Full sales history, receipt reprint, void with automatic stock return, Excel/PDF export |
| **Dashboard & Reports** | Sales, profit, product, category, hourly and shift reports with Excel/PDF export |
| **Settings** | Store profile and logo, receipt header and footer, sales rules, printer and cash-drawer hardware |

---

## Requirements

- **PHP 8.2+** with the `pdo_sqlite`, `sqlite3`, `mbstring`, `fileinfo`, `gd` and `openssl` extensions. `Start-POS.bat` loads the SQLite extensions automatically if `php.ini` doesn't enable them.
- **Composer** and **Node.js 20+**. These are needed once to install dependencies and build the frontend, not to run the POS.
- A modern browser. Chrome or Edge is recommended for USB/Bluetooth thermal printers.

---

## Installation (one time, with internet)

```bash
composer install --no-dev --optimize-autoloader
npm ci
npm run build
php artisan pos:install
```

`pos:install` creates `.env` (from `.env.example`) and the app key if they are missing. It also creates the local database `database/database.sqlite`, runs the migrations and caches the app. You can run it again safely at any time.

After this step the folder holds everything the POS needs, so you can disconnect from the internet.

## Running the POS (offline)

**Windows (Development):** double-click **`Start-POS.bat`**. It prepares the database, starts the local server at `http://127.0.0.1:8000` and opens the POS in an app window. Keep the black window open while the POS is in use; close it to stop the POS.

**Windows (Client Distribution):** For building and releasing standalone client installers (`.exe`) without needing Laragon or PHP on the client's PC, see the [Packaging & Update Guide](PACKAGING_AND_UPDATE_GUIDE.md).

**Other systems:**

```bash
php artisan pos:install
cd public && php -S 127.0.0.1:8000 ../vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php
```

Laragon/Apache also works. Point the site's document root at the `public/` folder, never the project root.

## First launch

The **First-Time Setup** wizard runs once, in four steps. Nothing is saved until the last step succeeds; if anything fails, setup can simply be started again.

1. **Store Details**: store name, an optional logo (PNG, JPG or WEBP up to 2 MB, saved on this device), and an optional address and phone. The name, address and phone are printed on receipts.
2. **Admin Account**: your full name plus optional phone and address. These details appear on the **Profile** page.
3. **Sign-in Method**: a **4-digit PIN**, a **6-digit PIN** or a **password** (12+ characters with upper and lower case, a number and a symbol). Simple PINs such as `1234` or `0000` are rejected.
4. **Account Recovery**: three different security questions (from a list, or your own) with answers. Answers are not case-sensitive, and they are stored only as one-way hashes.

After **Complete Setup** the POS opens the unlock screen; unlock it with the new PIN or password.

On every launch after that the POS opens to the unlock screen. After 5 wrong attempts it locks for 5 minutes. You can change the PIN or password, or switch between PIN and password, under **Profile → Change PIN / Password**.

### Forgot the PIN or password?

Click **Forgot PIN?** (or **Forgot password?**) on the unlock screen, answer the three security questions, and set a new PIN or password. The old one stops working right away. This works fully offline. After 5 wrong answer attempts, recovery is locked for 15 minutes.

If the answers are also forgotten, run this on the POS computer:

```bash
php artisan pos:reset-credential
```

---

## Data & backups

All data is stored on this computer:

| What | Where |
|---|---|
| Products, sales, shifts, settings, account | `database/database.sqlite` |
| Uploaded logo, product images, avatar | `storage/app/public/` |

**To back up:** stop the POS, then copy both locations to a USB drive or another disk. **To restore:** stop the POS, put both back, then start it again.

Receipt header and footer text and printer settings are saved in the browser on this device.

### Moving data from the old MySQL (multi-branch) installation

After First-Time Setup you can copy one store's catalog, sales, shifts and cash movements from the previous MySQL database:

```bash
php artisan pos:import-legacy --database=OLD_DB_NAME --username=root --password=SECRET --store=1
```

All past staff activity is attributed to the Admin. The import refuses to run if the POS already has products or sales; use `--force` to override.

### Sample catalog (optional)

```bash
php artisan db:seed --class=ProductSeeder
```

---

## Testing

```bash
php artisan config:clear   # tests refuse to run against cached config (protects your real database)
php artisan test           # backend tests (in-memory SQLite)
npx playwright test        # browser tests; the server must be running on 127.0.0.1:8000
```

`e2e/00_offline/` blocks and records every request that would leave the device, then runs setup, checkout, inventory, reports, settings and sign-out/unlock. It fails if any external request is attempted.

---

## License

MIT
