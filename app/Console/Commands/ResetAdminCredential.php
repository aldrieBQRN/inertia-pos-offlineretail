<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\AdminCredential;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;

/**
 * Offline recovery for a forgotten Admin PIN/password.
 * Requires access to this computer (there is no email-based reset in the standalone POS).
 */
class ResetAdminCredential extends Command
{
    protected $signature = 'pos:reset-credential
                            {--type= : pin4, pin6 or password}';

    protected $description = 'Reset the Admin PIN or password of this standalone POS';

    public function handle(): int
    {
        $admin = User::admin();

        if (!$admin) {
            $this->error('First-Time Setup has not been completed yet. Open the POS to create the Admin account.');
            return self::FAILURE;
        }

        $type = $this->option('type') ?: $this->choice(
            'New sign-in method',
            ['pin4' => '4-digit PIN', 'pin6' => '6-digit PIN', 'password' => 'Password'],
            $admin->auth_type ?: 'pin4'
        );

        if (!in_array($type, User::AUTH_TYPES, true)) {
            $this->error('Invalid type. Use pin4, pin6 or password.');
            return self::FAILURE;
        }

        $label = AdminCredential::label($type);
        $credential = (string) $this->secret("New {$label}");
        $confirmation = (string) $this->secret("Confirm {$label}");

        $validator = Validator::make(
            ['credential' => $credential, 'credential_confirmation' => $confirmation],
            ['credential' => AdminCredential::rules($type)],
            [],
            ['credential' => $label]
        );

        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $message) {
                $this->error($message);
            }
            return self::FAILURE;
        }

        $admin->forceFill(['password' => $credential, 'auth_type' => $type])->save();

        $this->info("The {$label} for {$admin->name} has been reset.");
        $this->line('If the unlock screen is temporarily locked after failed attempts, run: php artisan cache:clear');

        return self::SUCCESS;
    }
}
