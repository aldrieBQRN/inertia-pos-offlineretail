# Inertia POS - Desktop Packaging & Update Guide

This guide explains how to package the offline POS into a standalone Windows installer (`.exe`), deploy it to client machines, and release updates without losing customer data.

---

## Architecture Overview

Inertia POS Desktop uses an isolated single-executable architecture:

| Component | Location on Client Machine | Description |
| :--- | :--- | :--- |
| **Application & Runtime** | `AppData\Local\Programs\Inertia POS` | Packaged binaries, bundled PHP 8.4 engine, compiled frontend assets, native launcher (`InertiaPOS.exe`). |
| **Customer Data & DB** | `AppData\Local\InertiaPOS` | SQLite database (`database.sqlite`), storage files, session caches, and offline machine license. |
| **Desktop Shortcut** | Desktop & Start Menu | `Inertia POS.lnk` launches the supervisor directly in standalone mode. |

> [!IMPORTANT]
> **Data Safety Guarantee:** Customer sales, inventory, and machine licenses are stored separately in `%LOCALAPPDATA%\InertiaPOS`. Updating or reinstalling the application will **never** overwrite or erase the store's database.

---

## 1. How to Deploy to a New Client (First-Time Install)

### Step 1: Give the Installer to the Client
Copy **only one file** to a USB flash drive or send it via file transfer:
```text
packaging\dist\Inertia-POS-Setup-v1.0.0.exe
```

### Step 2: The Client Installs the POS
On the client machine (no internet needed):
1. Double-click `Inertia-POS-Setup-v1.0.0.exe`.
2. Follow the wizard: **Next ➔ Next ➔ Install ➔ Finish**.
3. The dark splash screen will appear and set up the local database tables automatically.
4. The app opens to **Step 1 · Software Activation**.
5. The client copies their unique **Machine ID** (e.g. `POS-XXXX-XXXX-XXXX-XXXX`) and sends it to you.

### Step 3: You Issue Their License Key
On **your developer machine**, launch your private license management portal:
1. Double-click `C:\laragon\www\inertia-pos-license-portal\Start-License-Portal.bat`.
2. The portal opens in your browser at `http://127.0.0.1:8088`.
3. Click **Generate License** (or navigate to `http://127.0.0.1:8088/licenses/create`).
4. Enter the client's store name and paste their **Machine ID**.
5. Click **Generate License** — copy the resulting signed token and send it to your client.

### Step 4: The Client Activates
1. The client pastes the key into their activation screen and clicks **Activate POS**.
2. They enter their store details (Store Name, Receipt Header, Currency).
3. The POS is now ready to use offline forever via the **Inertia POS** desktop shortcut!

---

## 2. How to Build an Update / New Release

When you make changes, fix bugs, or add features to your source code in `C:\laragon\www\inertia-pos-RETAIL-offline`:

### Step 1: Compile Frontend Assets
```powershell
npm run build
```

### Step 2: (Optional) Update the Version Number
Open `packaging/installer/InertiaPOS.iss` and change line 5:
```pascal
#define MyAppVersion "1.0.1"
```

### Step 3: Refresh the Staging Environment
Run the packaging assembly script to prepare runtime binaries, remove development files, and compile the launcher:
```powershell
powershell -ExecutionPolicy Bypass -File packaging\build-package.ps1
```

### Step 4: Compile the Windows Installer
Run the batch compiler:
```cmd
packaging\build-installer.bat
```
This produces your new installer in:
```text
packaging\dist\Inertia-POS-Setup-v1.0.1.exe
```

### Step 5: Run Automated Verification Suite
Ensure all security checks, extension tests, and route validations pass 100%:
```powershell
php packaging\test-package-suite.php
```

---

## 3. How the Client Installs the Update

1. Send the new `Inertia-POS-Setup-v1.0.1.exe` to the client.
2. The client double-clicks the installer and clicks **Next ➔ Install ➔ Finish**.
3. **What happens under the hood:**
   - The installer updates the app code, views, and assets.
   - On launch, the launcher runs `artisan migrate --force --no-interaction` automatically to add any new database tables or columns.
   - The client's existing sales history, inventory, user accounts, and license activation remain 100% intact!

---

## 4. Key Security Rules
 
- **NEVER** distribute the private key `license_private.key`. It lives strictly inside your private portal at `C:\laragon\www\inertia-pos-license-portal\keys\license_private.key`.
- The `build-package.ps1` script automatically purges all `.key`, `.secret`, `.log`, and test files from the final package.
- The public key (`license_public.key`) is bundled with the POS app to verify signatures offline using Ed25519 cryptography.
 
---
 
 ## 5. Quick Command Reference
 
 | Action | Command / Location |
 | :--- | :--- |
 | **Compile Frontend** | `npm run build` |
 | **Assemble Staging** | `powershell -ExecutionPolicy Bypass -File packaging\build-package.ps1` |
 | **Build Setup EXE** | `packaging\build-installer.bat` |
 | **Run Package Tests** | `php packaging\test-package-suite.php` |
 | **Launch License Portal** | `C:\laragon\www\inertia-pos-license-portal\Start-License-Portal.bat` |
 | **Access Portal URL** | `http://127.0.0.1:8088` |
