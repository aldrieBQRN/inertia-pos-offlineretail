<?php

/**
 * Inertia POS License Management Portal UI/UX Polish Script
 * Updates layouts, views, routes, and controllers with enterprise SaaS styling.
 */

$portalDir = 'C:/laragon/www/inertia-pos-license-portal';

echo "=== Updating Inertia POS License Management Portal UI/UX ===\n\n";

if (!is_dir($portalDir)) {
    echo "[ERROR] Portal directory not found: $portalDir\n";
    exit(1);
}

// -----------------------------------------------------------------------------
// 1. Update routes/web.php (Add download route)
// -----------------------------------------------------------------------------
$routesFile = $portalDir . '/routes/web.php';
$routesCode = <<<'PHP'
<?php

use App\Http\Controllers\ActivityController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ClientController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LicenseController;
use App\Http\Controllers\SettingsController;
use Illuminate\Support\Facades\Route;

// Authentication routes
Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
Route::post('/login', [AuthController::class, 'login'])->name('login.post');
Route::post('/logout', [AuthController::class, 'logout'])->name('logout');

// Authenticated portal routes
Route::middleware('admin.auth')->group(function () {
    Route::get('/', [DashboardController::class, 'index'])->name('dashboard');

    // Licenses
    Route::get('/licenses', [LicenseController::class, 'index'])->name('licenses.index');
    Route::get('/licenses/create', [LicenseController::class, 'create'])->name('licenses.create');
    Route::post('/licenses', [LicenseController::class, 'store'])->name('licenses.store');
    Route::get('/licenses/{license}', [LicenseController::class, 'show'])->name('licenses.show');
    Route::get('/licenses/{license}/generated', [LicenseController::class, 'generated'])->name('licenses.generated');
    Route::get('/licenses/{license}/download', [LicenseController::class, 'download'])->name('licenses.download');
    Route::post('/licenses/{license}/deactivate', [LicenseController::class, 'deactivate'])->name('licenses.deactivate');
    Route::post('/licenses/{license}/reactivate', [LicenseController::class, 'reactivate'])->name('licenses.reactivate');
    Route::post('/licenses/{license}/regenerate', [LicenseController::class, 'regenerate'])->name('licenses.regenerate');
    Route::post('/licenses/{license}/log-copy', [LicenseController::class, 'logCopy'])->name('licenses.log-copy');

    // Clients
    Route::get('/clients', [ClientController::class, 'index'])->name('clients.index');
    Route::get('/clients/{client}', [ClientController::class, 'show'])->name('clients.show');

    // System
    Route::get('/activity', [ActivityController::class, 'index'])->name('activity.index');
    Route::get('/settings', [SettingsController::class, 'index'])->name('settings.index');
    Route::post('/settings/password', [SettingsController::class, 'updatePassword'])->name('settings.password');
});
PHP;
file_put_contents($routesFile, $routesCode);
echo "  [OK] Updated routes/web.php\n";

// -----------------------------------------------------------------------------
// 2. Update LicenseController.php (Add download method)
// -----------------------------------------------------------------------------
$licenseControllerFile = $portalDir . '/app/Http/Controllers/LicenseController.php';
$licenseControllerCode = <<<'PHP'
<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\PortalLicense;
use App\Services\LicenseGeneratorService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\Response;

class LicenseController extends Controller
{
    public function __construct(
        protected LicenseGeneratorService $generator
    ) {}

    public function index(Request $request): View
    {
        $query = PortalLicense::query();

        if ($search = trim($request->input('search', ''))) {
            $query->where(function ($q) use ($search) {
                $q->where('client_name', 'like', "%{$search}%")
                  ->orWhere('machine_id', 'like', "%{$search}%")
                  ->orWhere('license_id', 'like', "%{$search}%");
            });
        }

        if ($status = $request->input('status')) {
            if (in_array($status, ['Active', 'Deactivated'])) {
                $query->where('status', $status);
            }
        }

        $licenses = $query->latest()->paginate(12)->withQueryString();

        return view('licenses.index', compact('licenses'));
    }

    public function create(): View
    {
        return view('licenses.create');
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'client_name' => ['required', 'string', 'max:100'],
            'machine_id' => [
                'required',
                'string',
                'regex:' . LicenseGeneratorService::MACHINE_ID_REGEX,
            ],
        ], [
            'machine_id.regex' => 'Invalid Machine ID format. Must follow: POS-XXXX-XXXX-XXXX-XXXX',
        ]);

        try {
            $result = $this->generator->generate($validated['client_name'], $validated['machine_id']);

            $license = PortalLicense::create([
                'client_name' => $result['client_name'],
                'machine_id' => $result['machine_id'],
                'license_id' => $result['license_id'],
                'license_key' => $result['license_key'],
                'status' => 'Active',
                'activated_at' => null,
            ]);

            ActivityLog::record(
                'license_created',
                $license->client_name,
                $license->machine_id,
                "Lifetime license issued ({$license->license_id})"
            );

            return redirect()->route('licenses.generated', $license->id);
        } catch (\Throwable $e) {
            return back()->withInput()->with('error', $e->getMessage());
        }
    }

    public function generated(PortalLicense $license): View
    {
        ActivityLog::record('license_viewed', $license->client_name, $license->machine_id, "Viewed generated license {$license->license_id}");
        return view('licenses.generated', compact('license'));
    }

    public function show(PortalLicense $license): View
    {
        ActivityLog::record('license_viewed', $license->client_name, $license->machine_id, "Viewed license details for {$license->license_id}");
        return view('licenses.show', compact('license'));
    }

    public function download(PortalLicense $license): Response
    {
        $safeName = Str::slug($license->client_name, '_') ?: 'client';
        $filename = "{$safeName}_{$license->license_id}.lic";

        ActivityLog::record('license_downloaded', $license->client_name, $license->machine_id, "Downloaded license file {$filename}");

        return response($license->license_key, 200, [
            'Content-Type' => 'text/plain; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    public function deactivate(PortalLicense $license): RedirectResponse
    {
        $license->update(['status' => 'Deactivated']);
        ActivityLog::record('license_deactivated', $license->client_name, $license->machine_id, "Deactivated license {$license->license_id}");

        return back()->with('info', "License {$license->license_id} has been marked as Deactivated.");
    }

    public function reactivate(PortalLicense $license): RedirectResponse
    {
        $license->update(['status' => 'Active']);
        ActivityLog::record('license_reactivated', $license->client_name, $license->machine_id, "Reactivated license {$license->license_id}");

        return back()->with('success', "License {$license->license_id} has been reactivated.");
    }

    public function regenerate(PortalLicense $license): RedirectResponse
    {
        try {
            $result = $this->generator->generate($license->client_name, $license->machine_id);

            $license->update([
                'license_id' => $result['license_id'],
                'license_key' => $result['license_key'],
                'status' => 'Active',
            ]);

            ActivityLog::record(
                'license_regenerated',
                $license->client_name,
                $license->machine_id,
                "Regenerated new license token ({$license->license_id})"
            );

            return redirect()->route('licenses.generated', $license->id)->with('success', 'License key regenerated successfully.');
        } catch (\Throwable $e) {
            return back()->with('error', 'Failed to regenerate license: ' . $e->getMessage());
        }
    }

    public function logCopy(PortalLicense $license): JsonResponse
    {
        ActivityLog::record('license_copied', $license->client_name, $license->machine_id, "Copied license key for {$license->license_id}");
        return response()->json(['success' => true]);
    }
}
PHP;
file_put_contents($licenseControllerFile, $licenseControllerCode);
echo "  [OK] Updated LicenseController.php\n";

// -----------------------------------------------------------------------------
// 3. Update DashboardController.php (Provide revoked and recent activity)
// -----------------------------------------------------------------------------
$dashboardControllerFile = $portalDir . '/app/Http/Controllers/DashboardController.php';
$dashboardControllerCode = <<<'PHP'
<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\PortalLicense;
use Illuminate\View\View;

class DashboardController extends Controller
{
    public function index(): View
    {
        $totalLicenses = PortalLicense::count();
        $activeLicenses = PortalLicense::where('status', 'Active')->count();
        $revokedLicenses = PortalLicense::where('status', 'Deactivated')->count();
        $generatedToday = PortalLicense::whereDate('created_at', today())->count();

        $recentLicenses = PortalLicense::latest()->take(6)->get();
        $recentActivities = ActivityLog::latest()->take(6)->get();

        return view('dashboard', compact(
            'totalLicenses',
            'activeLicenses',
            'revokedLicenses',
            'generatedToday',
            'recentLicenses',
            'recentActivities'
        ));
    }
}
PHP;
file_put_contents($dashboardControllerFile, $dashboardControllerCode);
echo "  [OK] Updated DashboardController.php\n";

echo "\nControllers and Routes updated successfully.\n";
