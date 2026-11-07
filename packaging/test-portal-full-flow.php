<?php

/**
 * End-to-End Functional Test for License Management Portal
 */

echo "=== Comprehensive Portal Functional & Flow Test ===\n\n";

$portalDir = 'C:/laragon/www/inertia-pos-license-portal';
require_once $portalDir . '/vendor/autoload.php';
$app = require $portalDir . '/bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Models\ActivityLog;
use App\Models\PortalLicense;
use App\Services\LicenseGeneratorService;
use Illuminate\Support\Facades\Request;

// 1. Test License Generator Service
echo "--- Test 1: License Generation & Ed25519 Signing ---\n";
$generator = $app->make(LicenseGeneratorService::class);
$clientName = "Enterprise UI Test Client";
$machineId = "POS-E2E1-9988-7766-5544";

$result = $generator->generate($clientName, $machineId);
if (empty($result['license_key']) || empty($result['license_id'])) {
    echo "  [FAIL] Generator failed to produce token\n";
    exit(1);
}
echo "  [PASS] Successfully generated License ID: " . $result['license_id'] . "\n";

// 2. Test License Model Creation
echo "\n--- Test 2: Database Storage & Model Casts ---\n";
$license = PortalLicense::create([
    'client_name' => $result['client_name'],
    'machine_id' => $result['machine_id'],
    'license_id' => $result['license_id'],
    'license_key' => $result['license_key'],
    'status' => 'Active',
]);

echo "  [PASS] PortalLicense stored with ID #{$license->id}\n";
echo "  [PASS] Masked key accessor: " . $license->masked_key . "\n";

// 3. Test Download Method
echo "\n--- Test 3: Download .lic File Response ---\n";
$controller = $app->make(\App\Http\Controllers\LicenseController::class);
$downloadResponse = $controller->download($license);

if ($downloadResponse->getStatusCode() === 200 && str_contains($downloadResponse->headers->get('Content-Disposition'), '.lic')) {
    echo "  [PASS] Download response OK (200), Disposition: " . $downloadResponse->headers->get('Content-Disposition') . "\n";
    echo "  [PASS] Content length: " . strlen($downloadResponse->getContent()) . " bytes\n";
} else {
    echo "  [FAIL] Download response invalid\n";
    exit(1);
}

// 4. Test Deactivate & Reactivate Actions
echo "\n--- Test 4: Deactivate & Reactivate Workflow ---\n";
$controller->deactivate($license);
$license->refresh();
if ($license->status !== 'Deactivated') {
    echo "  [FAIL] Deactivate status mismatch: " . $license->status . "\n";
    exit(1);
}
echo "  [PASS] Status changed to Deactivated\n";

$controller->reactivate($license);
$license->refresh();
if ($license->status !== 'Active') {
    echo "  [FAIL] Reactivate status mismatch: " . $license->status . "\n";
    exit(1);
}
echo "  [PASS] Status restored to Active\n";

// 5. Test POS Compatibility (Public Key Verification in POS)
echo "\n--- Test 5: Customer POS Validation ---\n";
$tokenFile = sys_get_temp_dir() . '/test_token.txt';
file_put_contents($tokenFile, $license->license_key);

$posCheckCode = '
    require "c:/laragon/www/inertia-pos-RETAIL-offline/vendor/autoload.php";
    $posApp = require "c:/laragon/www/inertia-pos-RETAIL-offline/bootstrap/app.php";
    $posApp->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
    $posLicenseService = $posApp->make(\App\Services\LicenseService::class);
    $key = file_get_contents("' . addslashes($tokenFile) . '");
    $val = $posLicenseService->validateToken($key, "' . $license->machine_id . '");
    echo json_encode($val);
';

$checkScript = sys_get_temp_dir() . '/check_token.php';
file_put_contents($checkScript, '<?php ' . $posCheckCode);

$output = shell_exec('php ' . escapeshellarg($checkScript));
@unlink($tokenFile);
@unlink($checkScript);

$val = json_decode($output, true);
if (is_array($val) && ($val['valid'] ?? false)) {
    echo "  [PASS] POS offline engine verified signature 100% valid!\n";
    echo "  [PASS] Product: " . $val['payload']['product'] . ", Type: " . $val['payload']['license_type'] . "\n";
} else {
    echo "  [FAIL] POS validation failed: " . ($val['error'] ?? 'output: ' . $output) . "\n";
    exit(1);
}

// Clean up test license
$license->delete();
echo "\n  [CLEANUP] Deleted test license record.\n";

echo "\n=======================================================\n";
echo " ALL FUNCTIONAL & FLOW TESTS PASSED (100% SUCCESS)!\n";
echo "=======================================================\n";
