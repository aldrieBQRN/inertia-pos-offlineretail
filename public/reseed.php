<?php

/**
 * ============================================================
 * WEB-BASED SEED RUNNER — Quick Seed Helper
 * ============================================================
 */

ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);

header('Content-Type: text/plain; charset=UTF-8');

define('LARAVEL_START', microtime(true));
$baseDir = dirname(__DIR__);

require $baseDir . '/vendor/autoload.php';

$app = require_once $baseDir . '/bootstrap/app.php';
$kernel = $app->make(Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

echo "Running: php artisan db:seed --class=DemoSeeder --force\n\n";
$exitCode = $kernel->call('db:seed', [
    '--class' => 'DemoSeeder',
    '--force' => true,
]);
echo $kernel->output();
echo "\nExit code: {$exitCode}\n";
echo "\n✅ Done! The Admin is now set to 4-digit PIN: 1234\n";
