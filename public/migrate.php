<?php

/**
 * ============================================================
 * WEB-BASED MIGRATION RUNNER — InfinityFree Deploy Helper
 * ============================================================
 *
 * Since InfinityFree has no SSH, this script lets you run
 * `php artisan migrate` via the browser with a secret token.
 *
 * HOW TO USE:
 *   Visit: https://yourdomain.com/migrate.php?token=YOUR_MIGRATE_TOKEN
 *
 * ⚠️  SECURITY: DELETE THIS FILE after first run!
 *   InfinityFree File Manager → htdocs/public/ → delete migrate.php
 *
 * The MIGRATE_TOKEN is set in your .env file (and GitHub Secret).
 */

// ── Bootstrap Laravel ────────────────────────────────────────
define('LARAVEL_START', microtime(true));

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Http\Kernel::class);

// ── Token protection ─────────────────────────────────────────
$envPath = __DIR__ . '/../.env';
$envVars = [];
if (file_exists($envPath)) {
    foreach (file($envPath) as $line) {
        $line = trim($line);
        if (!$line || str_starts_with($line, '#')) continue;
        [$k, $v] = array_pad(explode('=', $line, 2), 2, '');
        $envVars[trim($k)] = trim($v, " \t\n\r\0\x0B\"'");
    }
}

$validToken = $envVars['MIGRATE_TOKEN'] ?? null;
$givenToken = $_GET['token'] ?? '';

header('Content-Type: text/plain; charset=UTF-8');

if (!$validToken || !hash_equals($validToken, $givenToken)) {
    http_response_code(403);
    echo "403 Forbidden — invalid or missing token.\n";
    exit;
}

// ── Run migrations ───────────────────────────────────────────
$action = $_GET['action'] ?? 'migrate';

$app->make('Illuminate\Foundation\Bootstrap\LoadEnvironmentVariables')->bootstrap($app);
$app->make('Illuminate\Foundation\Bootstrap\LoadConfiguration')->bootstrap($app);
$app->make('Illuminate\Foundation\Bootstrap\HandleExceptions')->bootstrap($app);
$app->make('Illuminate\Foundation\Bootstrap\RegisterFacades')->bootstrap($app);
$app->make('Illuminate\Foundation\Bootstrap\RegisterProviders')->bootstrap($app);
$app->make('Illuminate\Foundation\Bootstrap\BootProviders')->bootstrap($app);

$artisan = $app->make(Illuminate\Contracts\Console\Kernel::class);

echo "=== Inertia POS — Web Migration Runner ===\n";
echo "Action: {$action}\n";
echo "Time: " . date('Y-m-d H:i:s') . "\n\n";

ob_start();

if ($action === 'migrate') {
    echo "Running: php artisan migrate --force\n\n";
    $exitCode = $artisan->call('migrate', ['--force' => true]);
    echo $artisan->output();
    echo "\nExit code: {$exitCode}\n";
    echo "\n✅ Migrations complete!\n";
    echo "\n⚠️  Next: visit ?token={$givenToken}&action=seed to seed demo data\n";
    echo "⚠️  Then DELETE this file from InfinityFree File Manager!\n";

} elseif ($action === 'seed') {
    echo "Running: php artisan db:seed --class=DemoSeeder --force\n\n";
    $exitCode = $artisan->call('db:seed', [
        '--class' => 'DemoSeeder',
        '--force' => true,
    ]);
    echo $artisan->output();
    echo "\nExit code: {$exitCode}\n";
    echo "\n✅ Demo data seeded!\n";
    echo "\n🔑 Login with:\n";
    echo "   Admin   → admin@demo.com   / demo1234\n";
    echo "   Cashier → cashier@demo.com / demo1234\n";
    echo "\n⚠️  DELETE this file from InfinityFree File Manager now!\n";

} elseif ($action === 'status') {
    echo "Running: php artisan migrate:status\n\n";
    $artisan->call('migrate:status');
    echo $artisan->output();

} else {
    echo "Unknown action '{$action}'.\n";
    echo "Valid actions: migrate, seed, status\n";
}

$output = ob_get_clean();
echo $output;

