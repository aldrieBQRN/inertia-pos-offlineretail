<?php

/**
 * ============================================================
 * WEB-BASED MIGRATION RUNNER — InfinityFree Deploy Helper
 * ============================================================
 * InfinityFree has no SSH, so migrations/seeding run from the browser.
 * The deploy workflow copies this file to public/migrate.php; it only runs
 * with the MIGRATE_TOKEN from .env (a GitHub secret).
 *
 *   /migrate.php?token=XXX&action=status    PHP checks + migration status
 *   /migrate.php?token=XXX&action=migrate   run pending migrations
 *   /migrate.php?token=XXX&action=seed&confirm=yes
 *                                           DemoSeeder (WIPES store data, keeps license)
 */

ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);
set_time_limit(300);

header('Content-Type: text/plain; charset=UTF-8');

define('LARAVEL_START', microtime(true));

$baseDir = dirname(__DIR__);

if (!file_exists($baseDir . '/vendor/autoload.php')) {
    die("Error: vendor/ is missing. Upload and extract vendor.zip into the site folder first.\n");
}
require $baseDir . '/vendor/autoload.php';

// Parse .env directly for the token (before booting Laravel)
$envVars = [];
if (file_exists($baseDir . '/.env')) {
    foreach (file($baseDir . '/.env') as $line) {
        $line = trim($line);
        if (!$line || str_starts_with($line, '#')) continue;
        [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
        $envVars[trim($k)] = trim($v, " \t\n\r\0\x0B\"'");
    }
}

$validToken = $envVars['MIGRATE_TOKEN'] ?? null;
$givenToken = $_GET['token'] ?? '';

if (!$validToken || !hash_equals((string) $validToken, (string) $givenToken)) {
    http_response_code(403);
    die("403 Forbidden — invalid or missing token.\n");
}

$action = $_GET['action'] ?? 'status';

echo "=== Inertia POS — Web Migration Runner ===\n";
echo "Action: {$action}\n";
echo "Time:   " . date('Y-m-d H:i:s') . "\n";
echo "PHP:    " . PHP_VERSION . "\n";
foreach (['bcmath', 'pdo_mysql', 'mbstring', 'zip', 'gd'] as $ext) {
    echo str_pad("ext {$ext}:", 16) . (extension_loaded($ext) ? 'OK' : 'MISSING' . ($ext === 'bcmath' ? '  <-- REQUIRED for Multiple UOM quantities' : '')) . "\n";
}
echo "\n";

try {
    $app = require_once $baseDir . '/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
} catch (\Throwable $e) {
    die("Bootstrap Error: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
}

try {
    if ($action === 'migrate') {
        echo "Running: php artisan migrate --force\n\n";
        $exitCode = $kernel->call('migrate', ['--force' => true]);
        echo $kernel->output();
        echo "\nExit code: {$exitCode}\n";
        echo $exitCode === 0 ? "\n✅ Migrations complete!\n" : "\n❌ Migration failed (see above).\n";
        echo "\nOptional demo data (wipes store data): ?token=...&action=seed&confirm=yes\n";
    } elseif ($action === 'seed') {
        if (($_GET['confirm'] ?? '') !== 'yes') {
            die("DemoSeeder WIPES all store data (products, sales, shifts, users).\nAdd &confirm=yes to the URL to continue.\n");
        }
        echo "Running: php artisan db:seed --class=DemoSeeder --force\n\n";
        $exitCode = $kernel->call('db:seed', ['--class' => 'DemoSeeder', '--force' => true]);
        echo $kernel->output();
        echo "\nExit code: {$exitCode}\n";
        echo "\n🔑 Login PIN: 1234 (Admin User or Jane Cashier)\n";
    } elseif ($action === 'status') {
        echo "Running: php artisan migrate:status\n\n";
        $kernel->call('migrate:status');
        echo $kernel->output();
    } else {
        echo "Unknown action '{$action}'. Valid actions: status, migrate, seed\n";
    }
} catch (\Throwable $e) {
    echo "\n❌ Execution Error:\n" . $e->getMessage() . "\n\n" . $e->getTraceAsString() . "\n";
}
