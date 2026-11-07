<?php

namespace App\Support;

use Illuminate\Validation\Rules\Password;

/**
 * Validation rules for the Admin sign-in credential.
 *
 * - pin4:     exactly 4 digits
 * - pin6:     exactly 6 digits
 * - password: strong password (12+ chars, upper & lower case, number, symbol)
 *
 * Everything is checked locally; no online breach lookups are performed.
 */
class AdminCredential
{
    public static function rules(?string $authType): array
    {
        return match ($authType) {
            'pin4' => ['required', 'string', 'digits:4', 'confirmed', self::notTrivialPin()],
            'pin6' => ['required', 'string', 'digits:6', 'confirmed', self::notTrivialPin()],
            default => [
                'required',
                'string',
                'max:128',
                'confirmed',
                Password::min(12)->letters()->mixedCase()->numbers()->symbols(),
            ],
        };
    }

    public static function label(?string $authType): string
    {
        return match ($authType) {
            'pin4' => '4-digit PIN',
            'pin6' => '6-digit PIN',
            default => 'password',
        };
    }

    /**
     * Rejects PINs that are trivially guessable (e.g. 0000, 1234, 987654).
     */
    private static function notTrivialPin(): \Closure
    {
        return function (string $attribute, $value, \Closure $fail) {
            $pin = (string) $value;
            if (!ctype_digit($pin)) {
                return;
            }

            if (count(array_unique(str_split($pin))) === 1) {
                $fail('The PIN cannot use the same digit repeatedly.');
                return;
            }

            if (str_contains('01234567890', $pin) || str_contains('09876543210', $pin)) {
                $fail('The PIN cannot be a simple sequence like 1234.');
            }
        };
    }
}
