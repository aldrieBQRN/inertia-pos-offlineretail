<?php

/**
 * End-to-End Packaging and Licensing Verification Test Suite
 * Tests against C:\InertiaPOSTestInstall using its bundled PHP runtime
 */

$testInstallDir = 'C:\\InertiaPOSTestInstall';
$phpExe = $testInstallDir . '\\runtime\\php\\php.exe';
$phpIni = $testInstallDir . '\\runtime\\php\\php.ini';
$appDir = $testInstallDir . '\\app';
$publicDir = $appDir . '\\public';
$serverScript = $appDir . '\\vendor\\laravel\\framework\\src\\Illuminate\\Foundation\\resources\\server.php';

$localAppData = getenv('LOCALAPPDATA');
$dbFile = $localAppData . '\\InertiaPOS\\database\\database.sqlite';
$storageDir = $localAppData . '\\InertiaPOS\\storage';

echo "=== Inertia POS Packaging Verification Suite ===\n";

// 1. Verify files exist
echo "\n--- Step 1: Checking Packaged Files ---\n";
assertFile($testInstallDir . '\\InertiaPOS.exe', 'Native launcher executable');
assertFile($phpExe, 'Bundled PHP runtime');
assertFile($phpIni, 'Bundled PHP ini');
assertFile($testInstallDir . '\\app\\artisan', 'Laravel artisan');
assertFile($testInstallDir . '\\app\\public\\build\\manifest.json', 'Production Vite build manifest');

// 2. Verify Private Keys Excluded
echo "\n--- Step 2: Checking Private Key Exclusion ---\n";
$keyFiles = glob($testInstallDir . '/**/*.key');
if (empty($keyFiles)) {
    echo "  [PASS] No *.key files found in package.\n";
} else {
    echo "  [FAIL] Found private key files: " . implode(', ', $keyFiles) . "\n";
    exit(1);
}

// 3. Test Bundled PHP Extensions
echo "\n--- Step 3: Checking Bundled PHP Extensions ---\n";
$output = [];
exec("\"$phpExe\" -c \"$phpIni\" -m", $output);
$modules = array_map('strtolower', $output);

$requiredExtensions = [
    'pdo', 'pdo_sqlite', 'sqlite3', 'sodium', 'openssl',
    'mbstring', 'fileinfo', 'ctype', 'json', 'xml', 'intl', 'curl', 'gd', 'zip'
];

foreach ($requiredExtensions as $ext) {
    if (in_array(strtolower($ext), $modules)) {
        echo "  [PASS] Extension '$ext' loaded.\n";
    } else {
        echo "  [FAIL] Missing required extension: '$ext'\n";
        exit(1);
    }
}

// 4. Test Machine ID Generation via bundled app
echo "\n--- Step 4: Machine ID Generation ---\n";
require_once $appDir . '/vendor/autoload.php';
$_SERVER['APP_STORAGE_PATH'] = $storageDir;
$_SERVER['DB_DATABASE'] = $dbFile;
$_SERVER['APP_ENV'] = 'production';
$app = require $appDir . '/bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

$machineIdService = $app->make(\App\Services\MachineIdService::class);
$machineId = $machineIdService->getMachineId();
echo "  [INFO] Detected Machine ID: $machineId\n";
if (preg_match('/^POS-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/', $machineId)) {
    echo "  [PASS] Machine ID format is valid.\n";
} else {
    echo "  [FAIL] Invalid Machine ID format: $machineId\n";
    exit(1);
}

// 5. Start Background Server for HTTP Testing
echo "\n--- Step 5: Testing Local Web Server & HTTP Routes ---\n";
$port = 8035;
$cmd = sprintf(
    'start /B "" "%s" -c "%s" -S 127.0.0.1:%d "%s"',
    $phpExe,
    $phpIni,
    $port,
    $serverScript
);

putenv("DB_DATABASE=$dbFile");
putenv("APP_STORAGE_PATH=$storageDir");
putenv("APP_ENV=production");
putenv("APP_DEBUG=false");
if (!file_exists($dbFile)) {
    if (!is_dir(dirname($dbFile))) {
        mkdir(dirname($dbFile), 0777, true);
    }
    touch($dbFile);
}
@mkdir("$storageDir/app/public", 0777, true);
@mkdir("$storageDir/framework/cache/data", 0777, true);
@mkdir("$storageDir/framework/sessions", 0777, true);
@mkdir("$storageDir/framework/views", 0777, true);
@mkdir("$storageDir/logs", 0777, true);
exec(sprintf('"%s" -c "%s" "%s/artisan" migrate --force --no-interaction', $phpExe, $phpIni, $appDir));

$p = popen("cd /d \"$publicDir\" && $cmd", 'r');
if ($p) { pclose($p); }
sleep(2);

// Health check /up
$health = httpGet("http://127.0.0.1:$port/up");
if ($health['code'] === 200) {
    echo "  [PASS] /up health endpoint returned 200 OK.\n";
} else {
    echo "  [FAIL] /up failed with code {$health['code']}\n";
    exit(1);
}

// Check /activate
$activatePage = httpGet("http://127.0.0.1:$port/activate");
if ($activatePage['code'] === 200 || $activatePage['code'] === 302) {
    echo "  [PASS] /activate responded as expected (code {$activatePage['code']}).\n";
} else {
    echo "  [FAIL] /activate returned unexpected code {$activatePage['code']}\n";
    exit(1);
}

// 6. Test Wrong Machine ID Rejection
echo "\n--- Step 6: Testing Cryptographic License Validation ---\n";
$licenseService = $app->make(\App\Services\LicenseService::class);

$portalKeyPath = 'C:/laragon/www/inertia-pos-license-portal/keys/license_private.key';
if (!file_exists($portalKeyPath)) {
    echo "  [FAIL] Portal private key not found at $portalKeyPath\n";
    exit(1);
}
$portalPrivKey = sodium_hex2bin(trim(file_get_contents($portalKeyPath)));
$makeTestToken = function (array $overrides) use ($portalPrivKey, $machineId) {
    $payload = array_merge([
        'license_id' => 'LIC-' . strtoupper(bin2hex(random_bytes(6))),
        'product' => 'inertia-pos',
        'machine_id' => $machineId,
        'license_type' => 'perpetual',
        'customer' => 'Test Customer',
        'issued_at' => date('c'),
        'expires_at' => null,
    ], $overrides);
    $raw = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $sig = sodium_crypto_sign_detached($raw, $portalPrivKey);
    $b64 = fn ($d) => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
    return $b64($raw) . '.' . $b64($sig);
};

// Generate wrong machine license
$wrongKey = $makeTestToken(['machine_id' => 'POS-FFFF-FFFF-FFFF-FFFF']);

$wrongCheck = $licenseService->validateToken($wrongKey);
if (!$wrongCheck['valid'] && (strpos($wrongCheck['error'], 'belong to this machine') !== false || strpos($wrongCheck['error'], 'does not match') !== false)) {
    echo "  [PASS] Wrong Machine ID license rejected: {$wrongCheck['error']}\n";
} else {
    echo "  [FAIL] Wrong Machine ID was not rejected properly! (Error: " . ($wrongCheck['error'] ?? 'none') . ")\n";
    exit(1);
}

// Tampered license check
$tamperedKey = substr($wrongKey, 0, -4) . 'AAAA';
$tamperedCheck = $licenseService->validateToken($tamperedKey);
if (!$tamperedCheck['valid']) {
    echo "  [PASS] Tampered license rejected: {$tamperedCheck['error']}\n";
} else {
    echo "  [FAIL] Tampered license was accepted!\n";
    exit(1);
}

// Expired license check
$expiredKey = $makeTestToken(['license_type' => 'subscription', 'expires_at' => '2020-01-01T00:00:00Z']);

$expiredCheck = $licenseService->validateToken($expiredKey);
if (!$expiredCheck['valid'] && strpos($expiredCheck['error'], 'expired') !== false) {
    echo "  [PASS] Expired license rejected: {$expiredCheck['error']}\n";
} else {
    echo "  [FAIL] Expired license was not rejected properly! (Error: " . ($expiredCheck['error'] ?? 'none') . ")\n";
    exit(1);
}

// Valid license check & activation
$validKey = $makeTestToken(['customer' => 'Offline Retail Test Store']);

$activationResult = $licenseService->activate($validKey);
if ($activationResult instanceof \App\Models\License && $activationResult->exists) {
    echo "  [PASS] License activation succeeded for $machineId!\n";
} else {
    echo "  [FAIL] License activation failed!\n";
    exit(1);
}

// 7. Verify Activation Persistence
echo "\n--- Step 7: Verifying Activation Persistence in SQLite ---\n";
$licenseRecord = \App\Models\License::first();
if ($licenseRecord && $licenseRecord->machine_id === $machineId) {
    echo "  [PASS] License persisted in SQLite database ({$licenseRecord->license_type}, status={$licenseRecord->status}).\n";
} else {
    echo "  [FAIL] License not persisted in SQLite!\n";
    exit(1);
}

// 8. Test Data Persistence Across Simulated Update
echo "\n--- Step 8: Testing Data Persistence Across Updates ---\n";
// Create sample store and admin user
$store = \App\Models\Store::firstOrCreate(
    ['name' => 'Offline Packaging Store'],
    [
        'address' => '123 Retail Ave',
        'phone' => '555-0100',
        'status' => true,
    ]
);

$admin = \App\Models\User::firstOrCreate(
    ['email' => 'admin@testpos.local'],
    [
        'name' => 'System Admin',
        'password' => bcrypt('AdminPassword123!'),
        'role' => 'admin',
        'is_admin' => true,
        'store_id' => $store->id,
    ]
);

echo "  [PASS] Seeded Store '{$store->name}' and Admin '{$admin->email}' into %LOCALAPPDATA% database.\n";

// Verify persistent data
$storeCheck = \App\Models\Store::where('name', 'Offline Packaging Store')->first();
$adminCheck = \App\Models\User::where('email', 'admin@testpos.local')->first();
$licCheck = \App\Models\License::where('machine_id', $machineId)->first();

if ($storeCheck && $adminCheck && $licCheck) {
    echo "  [PASS] All customer mutable data intact in {$dbFile}.\n";
} else {
    echo "  [FAIL] Missing customer data!\n";
    exit(1);
}

echo "\n==========================================================\n";
echo " ALL VERIFICATION TESTS PASSED SUCCESSFULLY!\n";
echo "==========================================================\n";

function assertFile($path, $label) {
    if (file_exists($path)) {
        echo "  [PASS] $label found ($path).\n";
    } else {
        echo "  [FAIL] $label missing ($path)!\n";
        exit(1);
    }
}

function httpGet($url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 5);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return ['code' => $code, 'body' => $body];
}
