<?php

/*
|--------------------------------------------------------------------------
| Test Case
|--------------------------------------------------------------------------
|
| The closure you provide to your test functions is always bound to a specific PHPUnit test
| case class. By default, that class is "PHPUnit\Framework\TestCase". Of course, you may
| need to change it using the "pest()" function to bind a different classes or traits.
|
*/

pest()->extend(Tests\TestCase::class)
    ->use(Illuminate\Foundation\Testing\RefreshDatabase::class)
    ->in('Feature');

/*
|--------------------------------------------------------------------------
| Expectations
|--------------------------------------------------------------------------
|
| When you're writing tests, you often need to check that values meet certain conditions. The
| "expect()" function gives you access to a set of "expectations" methods that you can use
| to assert different things. Of course, you may extend the Expectation API at any time.
|
*/

expect()->extend('toBeOne', function () {
    return $this->toBe(1);
});

/*
|--------------------------------------------------------------------------
| Functions
|--------------------------------------------------------------------------
|
| While Pest is very powerful out-of-the-box, you may have some testing code specific to your
| project that you don't want to repeat in every file. Here you can also expose helpers as
| global functions to help you to reduce the number of lines of code in your test files.
|
*/

/**
 * A complete, valid First-Time Setup payload (all four wizard steps).
 */
function setupPayload(array $overrides = []): array
{
    return array_replace([
        // Step 1: Store Details
        'store_name' => 'Corner Store',
        'store_address' => '12 Rizal St.',
        'store_phone' => '0917 000 0000',
        // Step 2: Admin Account
        'admin_name' => 'Store Owner',
        'phone_number' => '0917 111 2222',
        'address' => '34 Mabini St.',
        'city' => 'Makati',
        'province' => 'Metro Manila',
        'country' => 'Philippines',
        // Step 3: Sign-in Method
        'auth_type' => 'pin4',
        'credential' => '2580',
        'credential_confirmation' => '2580',
        // Step 4: Account Recovery
        'recovery' => [
            ['question' => 'What was the name of your first pet?', 'answer' => 'Bantay'],
            ['question' => 'What city were you born in?', 'answer' => 'Cebu City'],
            ['question' => 'custom', 'custom_question' => 'What was the color of my first bike?', 'answer' => 'Blue'],
        ],
    ], $overrides);
}

/**
 * Generate a signed license token for testing.
 */
function generateTestLicenseToken(array $overrides = []): string
{
    $machineId = app(App\Services\MachineIdService::class)->getMachineId();
    $privateKeyHex = '51e941aebc27c41aaf36e2f7e762a4983fd1cae9327f6754ddba494b1f87d07eb4d81d2473b28a6a27f84afe3f916187e23bb8a4523321f01ebbea0f7d98a346';
    $privateKey = sodium_hex2bin($privateKeyHex);

    $payload = array_replace([
        'license_id' => 'LIC-TEST-' . strtoupper(bin2hex(random_bytes(4))),
        'product' => 'inertia-pos',
        'machine_id' => $machineId,
        'license_type' => 'perpetual',
        'customer' => 'Test Customer',
        'issued_at' => now()->toIso8601String(),
        'expires_at' => null,
    ], $overrides);

    $raw = json_encode($payload, JSON_UNESCAPED_SLASHES);
    $sig = sodium_crypto_sign_detached($raw, $privateKey);

    $b64Url = fn ($d) => rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
    return $b64Url($raw) . '.' . $b64Url($sig);
}

/**
 * Seed an active license for testing.
 */
function activateLicense(array $overrides = []): App\Models\License
{
    $token = generateTestLicenseToken($overrides);
    return app(App\Services\LicenseService::class)->activate($token);
}

/**
 * Run First-Time Setup and return the created Admin (left signed out).
 */
function setupPos(string $authType = 'pin4', string $credential = '2580'): App\Models\User
{
    activateLicense();

    test()->post('/setup', setupPayload([
        'auth_type' => $authType,
        'credential' => $credential,
        'credential_confirmation' => $credential,
    ]))->assertSessionHasNoErrors()->assertRedirect('/login');

    return App\Models\User::admin();
}
