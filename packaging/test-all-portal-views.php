<?php

/**
 * Inertia POS License Portal - Comprehensive View & Route Verification Test
 */

echo "=== Verifying Portal Views & Routes Compilation ===\n\n";

$portalDir = 'C:/laragon/www/inertia-pos-license-portal';
require_once $portalDir . '/vendor/autoload.php';
$app = require $portalDir . '/bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\ActivityLog;
use App\Models\AdminUser;
use App\Models\PortalLicense;
use Illuminate\Support\Facades\View;

$viewsToTest = [
    'auth.login' => [
        'isFirstRun' => false,
    ],
    'auth.login_first_run' => [
        'view' => 'auth.login',
        'isFirstRun' => true,
    ],
    'dashboard' => [
        'totalLicenses' => 5,
        'activeLicenses' => 4,
        'revokedLicenses' => 1,
        'generatedToday' => 2,
        'recentLicenses' => PortalLicense::latest()->take(6)->get(),
        'recentActivities' => ActivityLog::latest()->take(6)->get(),
    ],
    'licenses.index' => [
        'licenses' => PortalLicense::latest()->paginate(12),
    ],
    'licenses.create' => [],
    'licenses.generated' => [
        'license' => PortalLicense::first() ?? new PortalLicense([
            'id' => 1,
            'client_name' => 'Test Store',
            'machine_id' => 'POS-1234-5678-9012-3456',
            'license_id' => 'LIC-TEST001',
            'license_key' => 'eyJ0ZXN0IjoidGVzdCJ9.c2lnbmF0dXJl',
            'status' => 'Active',
            'created_at' => now(),
        ]),
    ],
    'licenses.show' => [
        'license' => PortalLicense::first() ?? new PortalLicense([
            'id' => 1,
            'client_name' => 'Test Store',
            'machine_id' => 'POS-1234-5678-9012-3456',
            'license_id' => 'LIC-TEST001',
            'license_key' => 'eyJ0ZXN0IjoidGVzdCJ9.c2lnbmF0dXJl',
            'status' => 'Active',
            'created_at' => now(),
        ]),
    ],
    'clients.index' => [
        'clients' => PortalLicense::select('client_name', \Illuminate\Support\Facades\DB::raw('count(*) as licenses_count'), \Illuminate\Support\Facades\DB::raw('min(created_at) as first_created_at'))
            ->groupBy('client_name')
            ->paginate(15),
    ],
    'clients.show' => [
        'clientName' => 'Test Client',
        'licenses' => PortalLicense::take(3)->get(),
    ],
    'activity.index' => [
        'activities' => ActivityLog::latest()->paginate(25),
    ],
    'settings.index' => [
        'keyConfigured' => true,
        'publicKey' => config('license.public_key'),
        'product' => config('license.product'),
        'productName' => config('license.product_name'),
    ],
];

$passed = 0;
$failed = 0;

foreach ($viewsToTest as $name => $data) {
    $viewName = $data['view'] ?? $name;
    unset($data['view']);
    try {
        $rendered = View::make($viewName, $data)->render();
        if (strlen($rendered) > 50) {
            echo "  [PASS] View '$name' rendered successfully (" . strlen($rendered) . " bytes)\n";
            $passed++;
        } else {
            echo "  [WARN] View '$name' rendered with unexpectedly short output\n";
        }
    } catch (\Throwable $e) {
        echo "  [FAIL] View '$name' threw exception: " . $e->getMessage() . "\n";
        echo "         In " . $e->getFile() . ":" . $e->getLine() . "\n";
        $failed++;
    }
}

echo "\nSummary: $passed passed, $failed failed.\n";
if ($failed > 0) {
    exit(1);
}
echo "ALL VIEWS RENDERED WITH ZERO SYNTAX OR RUNTIME ERRORS!\n";
