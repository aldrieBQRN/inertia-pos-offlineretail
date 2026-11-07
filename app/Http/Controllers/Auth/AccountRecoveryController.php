<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Models\Store;
use App\Models\User;
use App\Services\ActivityService;
use App\Support\AccountRecovery;
use App\Support\AdminCredential;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Offline "Forgot PIN / password" flow:
 * answer the three security questions → set a new sign-in method → back to unlock.
 *
 * No email, SMS or online service is involved. Failed answer attempts are rate
 * limited and never reveal which answer was wrong.
 */
class AccountRecoveryController extends Controller
{
    private const MAX_ATTEMPTS = 5;
    private const LOCKOUT_SECONDS = 900;

    /** How long a successful verification may be used to set a new credential. */
    private const VERIFIED_TTL_SECONDS = 600;

    private const SESSION_KEY = 'account_recovery.verified';

    public function show(Request $request): Response
    {
        $admin = User::admin();
        $store = Store::current();

        $stage = match (true) {
            !AccountRecovery::isConfigured($admin) => 'unavailable',
            $this->isVerified($request, $admin) => 'reset',
            default => 'questions',
        };

        return Inertia::render('Auth/Recover', [
            'stage' => $stage,
            // Question text only; answers are never sent to the browser
            'questions' => $stage === 'questions' ? $admin->recoveryQuestions()->pluck('question') : [],
            'auth_type' => $admin?->auth_type ?? 'password',
            'store_name' => $store?->name,
            'store_logo_path' => $store?->logo_path,
        ]);
    }

    public function verify(Request $request): RedirectResponse
    {
        $request->validate([
            'answers' => ['required', 'array', 'size:' . AccountRecovery::QUESTION_COUNT],
            'answers.*' => ['required', 'string', 'max:100'],
        ], [
            'answers.*.required' => 'Answer all three questions.',
        ]);

        $key = $this->throttleKey($request);

        if (RateLimiter::tooManyAttempts($key, self::MAX_ATTEMPTS)) {
            $minutes = (int) ceil(RateLimiter::availableIn($key) / 60);
            throw ValidationException::withMessages([
                'answers' => "Too many attempts. Try again in {$minutes} minute(s), or reset the sign-in method on this computer with: php artisan pos:reset-credential",
            ]);
        }

        $admin = User::admin();

        if (!AccountRecovery::isConfigured($admin) || !AccountRecovery::verify($admin, array_values($request->input('answers')))) {
            RateLimiter::hit($key, self::LOCKOUT_SECONDS);

            if ($admin) {
                ActivityService::logSecurityAction('recovery_failed', 'Failed account recovery attempt', [
                    '_actor_user_id' => $admin->id,
                    '_actor_store_id' => $admin->store_id,
                ]);
            }

            throw ValidationException::withMessages([
                'answers' => 'The answers could not be verified.',
            ]);
        }

        RateLimiter::clear($key);

        $request->session()->regenerate();
        $request->session()->put(self::SESSION_KEY, [
            'user_id' => $admin->id,
            'expires_at' => now()->addSeconds(self::VERIFIED_TTL_SECONDS)->getTimestamp(),
        ]);

        return redirect()->route('recover');
    }

    public function reset(Request $request): RedirectResponse
    {
        $admin = User::admin();

        if (!$this->isVerified($request, $admin)) {
            $request->session()->forget(self::SESSION_KEY);

            return redirect()->route('recover')->withErrors([
                'answers' => 'Please answer your security questions again.',
            ]);
        }

        $validated = $request->validate([
            'auth_type' => ['required', Rule::in(User::AUTH_TYPES)],
        ]);

        $request->validate([
            'credential' => AdminCredential::rules($validated['auth_type']),
        ], [], ['credential' => AdminCredential::label($validated['auth_type'])]);

        // The previous PIN/password stops working immediately
        $admin->forceFill([
            'password' => $request->input('credential'),
            'auth_type' => $validated['auth_type'],
        ])->save();

        $request->session()->forget(self::SESSION_KEY);
        $request->session()->regenerate();

        // A verified owner may unlock right away, even if the unlock screen was locked out
        RateLimiter::clear(LoginRequest::throttleKeyForIp((string) $request->ip()));

        ActivityService::logSecurityAction('credential_recovered', 'Admin sign-in reset through account recovery', [
            'auth_type' => $admin->auth_type,
            '_actor_user_id' => $admin->id,
            '_actor_store_id' => $admin->store_id,
        ]);

        return redirect()->route('recover.done')->with('recovered_label', AdminCredential::label($admin->auth_type));
    }

    public function done(Request $request): Response|RedirectResponse
    {
        if (!$request->session()->has('recovered_label')) {
            return redirect()->route('login');
        }

        $store = Store::current();

        return Inertia::render('Auth/Recover', [
            'stage' => 'done',
            'questions' => [],
            'recovered_label' => $request->session()->get('recovered_label'),
            'auth_type' => User::admin()?->auth_type ?? 'password',
            'store_name' => $store?->name,
            'store_logo_path' => $store?->logo_path,
        ]);
    }

    private function isVerified(Request $request, ?User $admin): bool
    {
        $state = $request->session()->get(self::SESSION_KEY);

        return $admin !== null
            && is_array($state)
            && (int) ($state['user_id'] ?? 0) === $admin->id
            && (int) ($state['expires_at'] ?? 0) >= now()->getTimestamp();
    }

    private function throttleKey(Request $request): string
    {
        return 'admin-recovery|' . $request->ip();
    }
}
