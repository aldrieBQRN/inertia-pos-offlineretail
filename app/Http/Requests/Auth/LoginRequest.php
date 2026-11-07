<?php

namespace App\Http\Requests\Auth;

use App\Models\User;
use App\Services\ActivityService;
use Illuminate\Auth\Events\Lockout;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Validation\ValidationException;

/**
 * Unlocks the POS for the single Admin account using its PIN or password.
 * Repeated failures lock the screen for a few minutes to stop PIN guessing.
 */
class LoginRequest extends FormRequest
{
    private const MAX_ATTEMPTS = 5;
    private const LOCKOUT_SECONDS = 300;

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'credential' => ['required', 'string', 'max:128'],
        ];
    }

    /**
     * @throws \Illuminate\Validation\ValidationException
     */
    public function authenticate(): void
    {
        $this->ensureIsNotRateLimited();

        $admin = User::admin();

        if (!$admin || !$admin->is_active || !Hash::check((string) $this->input('credential'), $admin->password)) {
            RateLimiter::hit($this->throttleKey(), self::LOCKOUT_SECONDS);

            if ($admin) {
                ActivityService::logSecurityAction('login_failed', 'Failed unlock attempt', [
                    '_actor_user_id' => $admin->id,
                    '_actor_store_id' => $admin->store_id,
                ]);
            }

            $remaining = RateLimiter::remaining($this->throttleKey(), self::MAX_ATTEMPTS);

            throw ValidationException::withMessages([
                'credential' => 'Incorrect ' . ($admin && str_starts_with((string) $admin->auth_type, 'pin') ? 'PIN' : 'password')
                    . ($remaining > 0 ? ". {$remaining} attempt(s) left." : '.'),
            ]);
        }

        Auth::login($admin);
        RateLimiter::clear($this->throttleKey());
    }

    /**
     * @throws \Illuminate\Validation\ValidationException
     */
    public function ensureIsNotRateLimited(): void
    {
        if (!RateLimiter::tooManyAttempts($this->throttleKey(), self::MAX_ATTEMPTS)) {
            return;
        }

        event(new Lockout($this));

        $seconds = RateLimiter::availableIn($this->throttleKey());

        throw ValidationException::withMessages([
            'credential' => trans('auth.throttle', [
                'seconds' => $seconds,
                'minutes' => ceil($seconds / 60),
            ]),
        ]);
    }

    public function throttleKey(): string
    {
        return self::throttleKeyForIp((string) $this->ip());
    }

    /**
     * Unlock lockout key for a device/IP (also cleared after a successful account recovery).
     */
    public static function throttleKeyForIp(string $ip): string
    {
        return 'admin-unlock|' . $ip;
    }
}
