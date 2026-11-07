<?php

namespace App\Http\Controllers;

use App\Models\Store;
use App\Models\Terminal;
use App\Models\User;
use App\Services\ActivityService;
use App\Support\AccountRecovery;
use App\Support\AdminCredential;
use App\Support\StoreLogo;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HttpResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * First-Time Setup wizard: Store Details → Admin Account → Sign-in Method → Account Recovery.
 *
 * Each step is validated on its own (validateStep) so the wizard can move forward,
 * but nothing is saved until the final submit (store), which validates every step
 * again and creates everything in one transaction. Only reachable while no Admin
 * exists (see EnsureAppIsConfigured).
 */
class SetupController extends Controller
{
    public const STEPS = 4;

    public function show(): Response
    {
        return Inertia::render('Setup/FirstTimeSetup', [
            'recovery_questions' => AccountRecovery::QUESTIONS,
        ]);
    }

    /**
     * Validates a single wizard step (nothing is saved).
     */
    public function validateStep(Request $request, int $step): HttpResponse
    {
        abort_unless($step >= 1 && $step <= self::STEPS, 404);

        $this->validator($request, [$step])->validate();

        return response()->noContent();
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validator($request, range(1, self::STEPS))->validate();

        // The logo file is written first; it is removed again if saving fails below
        $logoPath = $request->hasFile('store_logo') ? StoreLogo::store($request->file('store_logo')) : null;

        try {
            $admin = DB::transaction(function () use ($validated, $request, $logoPath) {
                // Guard against a double submit racing past the middleware
                if (User::query()->lockForUpdate()->exists()) {
                    throw ValidationException::withMessages([
                        'store_name' => 'This POS has already been set up.',
                    ]);
                }

                $store = Store::current() ?? new Store();
                $store->fill([
                    'name' => $validated['store_name'],
                    'address' => $validated['store_address'] ?? null,
                    'phone' => $validated['store_phone'] ?? null,
                    'logo_path' => $logoPath ?? $store->logo_path,
                    'status' => true,
                ])->save();

                $admin = User::create([
                    'name' => $validated['admin_name'],
                    'email' => null,
                    'phone_number' => $validated['phone_number'] ?? null,
                    'address' => $validated['address'] ?? null,
                    'city' => $validated['city'] ?? null,
                    'province' => $validated['province'] ?? null,
                    'country' => $validated['country'] ?? null,
                    'password' => $request->input('credential'),
                    'auth_type' => $validated['auth_type'],
                    'role' => 'admin',
                    'is_admin' => true,
                    'is_active' => true,
                    'store_id' => $store->id,
                ]);

                AccountRecovery::store($admin, $validated['recovery']);

                // The standalone POS runs a single cash register on this device
                Terminal::firstOrCreate(
                    ['store_id' => $store->id],
                    ['name' => 'Main Register', 'code' => 'REG-01', 'is_active' => true, 'notes' => 'This device']
                );

                return $admin;
            });
        } catch (\Throwable $e) {
            StoreLogo::delete($logoPath);
            throw $e;
        }

        ActivityService::logSecurityAction('setup_completed', 'First-Time Setup completed', [
            'auth_type' => $admin->auth_type,
            '_actor_user_id' => $admin->id,
            '_actor_store_id' => $admin->store_id,
        ]);

        $label = AdminCredential::label($admin->auth_type);

        return redirect()->route('login')->with('status', "Setup complete. Unlock the POS with your new {$label}.");
    }

    /**
     * Builds a validator covering the given wizard steps.
     */
    private function validator(Request $request, array $steps): \Illuminate\Validation\Validator
    {
        $rules = [];
        $attributes = [];

        foreach ($steps as $step) {
            match ($step) {
                // Step 1: Store Details (same fields as Store Settings, plus the logo)
                1 => $rules += [
                    'store_name' => ['required', 'string', 'max:255'],
                    'store_address' => ['nullable', 'string', 'max:500'],
                    'store_phone' => ['nullable', 'string', 'max:50'],
                    'store_logo' => StoreLogo::SETUP_RULES,
                ],
                // Step 2: Admin Account (same fields and limits as the Profile page)
                2 => $rules += [
                    'admin_name' => ['required', 'string', 'max:255'],
                    'phone_number' => ['nullable', 'string', 'max:20'],
                    'address' => ['nullable', 'string', 'max:255'],
                    'city' => ['nullable', 'string', 'max:100'],
                    'province' => ['nullable', 'string', 'max:100'],
                    'country' => ['nullable', 'string', 'max:100'],
                ],
                // Step 3: Sign-in Method
                3 => $rules += [
                    'auth_type' => ['required', Rule::in(User::AUTH_TYPES)],
                    'credential' => AdminCredential::rules($request->input('auth_type')),
                ],
                // Step 4: Account Recovery
                4 => $rules += AccountRecovery::rules(),
            };
        }

        $attributes += [
            'store_logo' => 'store logo',
            'admin_name' => 'full name',
            'phone_number' => 'phone number',
            'credential' => AdminCredential::label($request->input('auth_type')),
        ] + AccountRecovery::attributes();

        $validator = Validator::make($request->all(), $rules, [
            'store_logo.max' => 'The store logo must not be larger than 2 MB.',
            'store_logo.mimes' => 'The store logo must be a PNG, JPG or WEBP image.',
            'store_logo.image' => 'The store logo must be a PNG, JPG or WEBP image.',
        ], $attributes);

        if (in_array(4, $steps, true)) {
            AccountRecovery::rejectDuplicateQuestions($validator);
        }

        return $validator;
    }
}
