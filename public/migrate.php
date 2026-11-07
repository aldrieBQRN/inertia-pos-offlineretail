<?php

/**
 * ============================================================
 * WEB-BASED MIGRATION RUNNER — InfinityFree Deploy Helper
 * ============================================================
 */

ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

header('Content-Type: text/plain; charset=UTF-8');

define('LARAVEL_START', microtime(true));

$baseDir = dirname(__DIR__);

if (!file_exists($baseDir . '/vendor/autoload.php')) {
    die("Error: vendor/autoload.php not found at " . $baseDir . "/vendor/autoload.php\n");
}
require $baseDir . '/vendor/autoload.php';

// Parse .env directly for token
$envPath = $baseDir . '/.env';
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

if (!$validToken || !hash_equals((string)$validToken, (string)$givenToken)) {
    http_response_code(403);
    die("403 Forbidden — invalid or missing token.\nExpected token configured in .env: " . ($validToken ? 'YES' : 'NO') . "\n");
}

try {
    $app = require_once $baseDir . '/bootstrap/app.php';
    $kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
    $kernel->bootstrap();
} catch (\Throwable $e) {
    die("Bootstrap Error: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n");
}

$action = $_GET['action'] ?? 'migrate';

echo "=== Inertia POS — Web Migration Runner ===\n";
echo "Action: {$action}\n";
echo "Time: " . date('Y-m-d H:i:s') . "\n\n";

try {
    if ($action === 'migrate') {
        echo "Running: php artisan migrate --force\n\n";
        $exitCode = $kernel->call('migrate', ['--force' => true]);
        echo $kernel->output();
        echo "\nExit code: {$exitCode}\n";
        echo "\n✅ Migrations complete!\n";
        echo "\n⚠️  Next step: visit ?token={$givenToken}&action=seed to seed demo data\n";

    } elseif ($action === 'seed') {
        echo "Running: php artisan db:seed --class=DemoSeeder --force\n\n";
        $exitCode = $kernel->call('db:seed', [
            '--class' => 'DemoSeeder',
            '--force' => true,
        ]);
        echo $kernel->output();
        echo "\nExit code: {$exitCode}\n";
        echo "\n✅ Demo data seeded!\n";
        echo "\n🔑 Login with:\n";
        echo "   Admin   → admin@demo.com   / demo1234\n";
        echo "   Cashier → cashier@demo.com / demo1234\n";

    } elseif ($action === 'status') {
        echo "Running: php artisan migrate:status\n\n";
        $kernel->call('migrate:status');
        echo $kernel->output();

    } else {
        echo "Unknown action '{$action}'.\n";
        echo "Valid actions: migrate, seed, status\n";
    }
} catch (\Throwable $e) {
    echo "\n❌ Execution Error:\n" . $e->getMessage() . "\n\n" . $e->getTraceAsString() . "\n";
}
