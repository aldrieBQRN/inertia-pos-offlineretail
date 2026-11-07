<?php

namespace App\Http\Controllers;

use App\Http\Middleware\EnsureAppIsConfigured;
use App\Services\LicenseService;
use App\Services\MachineIdService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

class LicenseController extends Controller
{
    public function __construct(
        protected LicenseService $licenseService,
        protected MachineIdService $machineIdService
    ) {}

    /**
     * Display the activation screen.
     */
    public function show(): Response|RedirectResponse
    {
        if ($this->licenseService->isActivated()) {
            return redirect()->route(EnsureAppIsConfigured::isConfigured() ? 'login' : 'setup');
        }

        return Inertia::render('Auth/Activate', [
            'machine_id' => $this->machineIdService->getMachineId(),
            'product_name' => config('license.product_name', 'Inertia POS Standalone'),
            'current_license' => null,
        ]);
    }

    /**
     * Process license key activation.
     */
    public function activate(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'license_key' => ['required', 'string'],
        ], [
            'license_key.required' => 'Please enter your license key.',
        ]);

        $token = trim($validated['license_key']);
        $validation = $this->licenseService->validateToken($token);

        if (!$validation['valid']) {
            throw ValidationException::withMessages([
                'license_key' => $validation['error'] ?? 'Invalid license key.',
            ]);
        }

        try {
            $this->licenseService->activate($token);
        } catch (\Throwable $e) {
            throw ValidationException::withMessages([
                'license_key' => $e->getMessage(),
            ]);
        }

        $nextRoute = EnsureAppIsConfigured::isConfigured() ? 'login' : 'setup';

        return redirect()->route($nextRoute)->with('success', 'License activated successfully.');
    }

    /**
     * Deactivate current license (development / testing tool).
     */
    public function deactivate(): RedirectResponse
    {
        $this->licenseService->deactivate();

        return redirect()->route('activate')->with('info', 'License deactivated.');
    }
}
