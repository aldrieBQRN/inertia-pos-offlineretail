<?php

use App\Models\License;
use App\Models\User;
use App\Services\LicenseService;
use App\Services\MachineIdService;

/* ---------------------------------------------------------------- */
/* Machine ID & Cryptographic Token Validation                      */
/* ---------------------------------------------------------------- */

test('valid license for correct machine passes validation', function () {
    $licenseService = app(LicenseService::class);
    $token = generateTestLicenseToken();

    $result = $licenseService->validateToken($token);

    expect($result['valid'])->toBeTrue()
        ->and($result['error'])->toBeNull()
        ->and($result['payload'])->toHaveKeys(['license_id', 'product', 'machine_id', 'license_type']);
});

test('license with invalid signature is rejected', function () {
    $licenseService = app(LicenseService::class);
    $validToken = generateTestLicenseToken();

    [$payloadB64, $sigB64] = explode('.', $validToken);

    // Corrupt the signature
    $corruptSig = $licenseService->base64UrlEncode(random_bytes(SODIUM_CRYPTO_SIGN_BYTES));
    $tamperedToken = $payloadB64 . '.' . $corruptSig;

    $result = $licenseService->validateToken($tamperedToken);

    expect($result['valid'])->toBeFalse()
        ->and($result['error'])->toBe('Invalid license signature.');
});

test('license with modified payload is rejected', function () {
    $licenseService = app(LicenseService::class);
    $validToken = generateTestLicenseToken();

    [$payloadB64, $sigB64] = explode('.', $validToken);

    // Tamper with payload without re-signing
    $payload = json_decode($licenseService->base64UrlDecode($payloadB64), true);
    $payload['customer'] = 'Tampered Customer';
    $tamperedPayloadB64 = $licenseService->base64UrlEncode(json_encode($payload));
    $tamperedToken = $tamperedPayloadB64 . '.' . $sigB64;

    $result = $licenseService->validateToken($tamperedToken);

    expect($result['valid'])->toBeFalse()
        ->and($result['error'])->toBe('Invalid license signature.');
});

test('license for another machine is rejected', function () {
    $licenseService = app(LicenseService::class);
    $otherMachineToken = generateTestLicenseToken(['machine_id' => 'POS-9999-8888-7777-6666']);

    $result = $licenseService->validateToken($otherMachineToken);

    expect($result['valid'])->toBeFalse()
        ->and($result['error'])->toBe('License does not belong to this machine.');
});

test('expired license is rejected', function () {
    $licenseService = app(LicenseService::class);
    $expiredToken = generateTestLicenseToken([
        'expires_at' => now()->subDay()->toIso8601String(),
    ]);

    $result = $licenseService->validateToken($expiredToken);

    expect($result['valid'])->toBeFalse()
        ->and($result['error'])->toBe('License has expired.');
});

test('license for wrong product is rejected', function () {
    $licenseService = app(LicenseService::class);
    $wrongProductToken = generateTestLicenseToken([
        'product' => 'different-restaurant-app',
    ]);

    $result = $licenseService->validateToken($wrongProductToken);

    expect($result['valid'])->toBeFalse()
        ->and($result['error'])->toBe('License is for another product.');
});

test('malformed license string is rejected', function () {
    $licenseService = app(LicenseService::class);

    expect($licenseService->validateToken('')['valid'])->toBeFalse();
    expect($licenseService->validateToken('not-a-token')['valid'])->toBeFalse();
    expect($licenseService->validateToken('invalid.payload.structure')['valid'])->toBeFalse();
    expect($licenseService->validateToken('!!!.???')['valid'])->toBeFalse();
});

/* ---------------------------------------------------------------- */
/* Activation Flow & Persistence                                    */
/* ---------------------------------------------------------------- */

test('activating a valid license persists to database and marks app as activated', function () {
    $licenseService = app(LicenseService::class);
    $machineIdService = app(MachineIdService::class);

    expect($licenseService->isActivated())->toBeFalse();

    $token = generateTestLicenseToken(['license_type' => 'perpetual']);

    $license = $licenseService->activate($token);

    expect($license)->toBeInstanceOf(License::class)
        ->and($license->machine_id)->toBe($machineIdService->getMachineId())
        ->and($license->license_type)->toBe('perpetual')
        ->and($license->is_active)->toBeTrue()
        ->and($licenseService->isActivated())->toBeTrue();

    // Verify database row
    $this->assertDatabaseHas('licenses', [
        'id' => $license->id,
        'machine_id' => $machineIdService->getMachineId(),
        'is_active' => 1,
    ]);
});

test('activation screen renders machine ID and product name', function () {
    $machineId = app(MachineIdService::class)->getMachineId();

    $this->withoutVite()->get('/activate')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Auth/Activate')
            ->has('machine_id')
            ->where('machine_id', $machineId)
            ->has('product_name'));
});

test('activating via HTTP endpoint validates and redirects to setup', function () {
    $token = generateTestLicenseToken();

    $response = $this->post('/activate', [
        'license_key' => $token,
    ]);

    $response->assertRedirect('/setup');
    $this->assertTrue(app(LicenseService::class)->isActivated());
});

test('activating with an invalid key via HTTP endpoint returns validation error', function () {
    $response = $this->post('/activate', [
        'license_key' => 'invalid-token',
    ]);

    $response->assertSessionHasErrors('license_key');
    $this->assertFalse(app(LicenseService::class)->isActivated());
});

/* ---------------------------------------------------------------- */
/* Onboarding Flow: Activate → Setup → POS                         */
/* ---------------------------------------------------------------- */

test('an unactivated fresh install redirects every page to /activate', function () {
    expect(app(LicenseService::class)->isActivated())->toBeFalse();

    $this->get('/')->assertRedirect('/activate');
    $this->get('/setup')->assertRedirect('/activate');
    $this->get('/login')->assertRedirect('/activate');
    $this->get('/dashboard')->assertRedirect('/activate');
    $this->get('/pos')->assertRedirect('/activate');
});

test('an activated but unconfigured install redirects to /setup', function () {
    activateLicense();

    expect(app(LicenseService::class)->isActivated())->toBeTrue();
    expect(User::count())->toBe(0);

    // Visiting /activate redirects to /setup
    $this->get('/activate')->assertRedirect('/setup');

    // Visiting root redirects to /setup (via login redirect)
    $this->get('/login')->assertRedirect('/setup');
    $this->get('/dashboard')->assertRedirect('/setup');
    $this->get('/setup')->assertOk();
});

test('an activated and configured install allows normal access to login and POS', function () {
    $admin = setupPos('pin4', '2580');

    expect(app(LicenseService::class)->isActivated())->toBeTrue();
    expect(User::count())->toBe(1);

    // Setup screen is now closed
    $this->get('/setup')->assertRedirect('/login');
    $this->get('/activate')->assertRedirect('/login');

    // Can sign in and view POS
    $this->actingAs($admin);
    $this->withoutVite()->get('/dashboard')->assertOk();
    $this->withoutVite()->get('/pos')->assertOk();
});
