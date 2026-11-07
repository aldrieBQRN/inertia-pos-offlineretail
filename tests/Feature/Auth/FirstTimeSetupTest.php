<?php

use App\Models\RecoveryQuestion;
use App\Models\Store;
use App\Models\Terminal;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('public');
    // ImageCompressionService mirrors uploads into public/storage; keep tests out of the real folder
    $this->app->usePublicPath(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pos-test-public');
    activateLicense();
});

/* ---------------------------------------------------------------- */
/* Access                                                            */
/* ---------------------------------------------------------------- */

test('a fresh install redirects every page to first-time setup', function () {
    $this->get('/')->assertRedirect('/setup');
    $this->get('/login')->assertRedirect('/setup');
    $this->get('/recover')->assertRedirect('/setup');
    $this->get('/dashboard')->assertRedirect('/setup');
});

test('first-time setup screen can be rendered with the predefined recovery questions', function () {
    $this->withoutVite()->get('/setup')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Setup/FirstTimeSetup')
            ->has('recovery_questions', count(App\Support\AccountRecovery::QUESTIONS)));
});

/* ---------------------------------------------------------------- */
/* Step validation (nothing is saved until the end)                 */
/* ---------------------------------------------------------------- */

test('each wizard step is validated on its own without saving anything', function () {
    $this->postJson('/setup/validate/1', ['store_name' => ''])->assertStatus(422)->assertJsonValidationErrors('store_name');
    $this->postJson('/setup/validate/1', ['store_name' => 'Corner Store'])->assertNoContent();

    $this->postJson('/setup/validate/2', ['admin_name' => ''])->assertStatus(422)->assertJsonValidationErrors('admin_name');
    $this->postJson('/setup/validate/2', ['admin_name' => 'Store Owner', 'phone_number' => str_repeat('9', 21)])
        ->assertStatus(422)->assertJsonValidationErrors('phone_number');
    $this->postJson('/setup/validate/2', ['admin_name' => 'Store Owner'])->assertNoContent();

    $this->postJson('/setup/validate/3', ['auth_type' => 'pin4', 'credential' => '1234', 'credential_confirmation' => '1234'])
        ->assertStatus(422)->assertJsonValidationErrors('credential');
    $this->postJson('/setup/validate/3', ['auth_type' => 'pin4', 'credential' => '2580', 'credential_confirmation' => '2580'])->assertNoContent();

    $this->postJson('/setup/validate/4', ['recovery' => setupPayload()['recovery']])->assertNoContent();

    $this->postJson('/setup/validate/9', [])->assertNotFound();

    expect(User::count())->toBe(0)->and(Store::count())->toBe(0);
});

/* ---------------------------------------------------------------- */
/* Step 1: Store Details                                             */
/* ---------------------------------------------------------------- */

test('store address and phone are optional', function () {
    $this->post('/setup', setupPayload(['store_address' => null, 'store_phone' => null]))
        ->assertSessionHasNoErrors();

    expect(Store::current()->address)->toBeNull()->and(Store::current()->phone)->toBeNull();
});

test('a valid store logo is saved locally and linked to the store', function () {
    $this->post('/setup', setupPayload([
        'store_logo' => UploadedFile::fake()->image('logo.png', 300, 300),
    ]))->assertSessionHasNoErrors()->assertRedirect('/login');

    $logo = Store::current()->logo_path;
    expect($logo)->toStartWith('/storage/logos/');
    Storage::disk('public')->assertExists(ltrim(str_replace('/storage/', '', $logo), '/'));
});

test('invalid or oversized logos are rejected', function (callable $file) {
    $this->postJson('/setup/validate/1', ['store_name' => 'Corner Store', 'store_logo' => $file()])
        ->assertStatus(422)->assertJsonValidationErrors('store_logo');

    $this->post('/setup', setupPayload(['store_logo' => $file()]))->assertSessionHasErrors('store_logo');

    expect(User::count())->toBe(0);
})->with([
    'not an image' => [fn () => UploadedFile::fake()->create('logo.png', 10, 'text/plain')],
    'pdf' => [fn () => UploadedFile::fake()->create('logo.pdf', 10, 'application/pdf')],
    'svg' => [fn () => UploadedFile::fake()->create('logo.svg', 10, 'image/svg+xml')],
    'larger than 2 MB' => [fn () => UploadedFile::fake()->image('logo.png')->size(2100)],
]);

/* ---------------------------------------------------------------- */
/* Completion                                                        */
/* ---------------------------------------------------------------- */

test('setup saves store, profile, credential, recovery and register, then goes to the unlock screen', function () {
    $response = $this->post('/setup', setupPayload([
        'auth_type' => 'pin6',
        'credential' => '480913',
        'credential_confirmation' => '480913',
    ]));

    $response->assertRedirect('/login')->assertSessionHas('status');
    $this->assertGuest();

    expect(User::count())->toBe(1)
        ->and(Store::count())->toBe(1)
        ->and(Terminal::count())->toBe(1)
        ->and(RecoveryQuestion::count())->toBe(3);

    $store = Store::current();
    expect($store->name)->toBe('Corner Store')
        ->and($store->address)->toBe('12 Rizal St.')
        ->and($store->phone)->toBe('0917 000 0000');

    $admin = User::admin();
    expect($admin->name)->toBe('Store Owner')
        ->and($admin->phone_number)->toBe('0917 111 2222')
        ->and($admin->address)->toBe('34 Mabini St.')
        ->and($admin->city)->toBe('Makati')
        ->and($admin->province)->toBe('Metro Manila')
        ->and($admin->country)->toBe('Philippines')
        ->and($admin->auth_type)->toBe('pin6')
        ->and($admin->is_admin)->toBeTrue()
        ->and($admin->store_id)->toBe($store->id)
        ->and(Hash::check('480913', $admin->password))->toBeTrue();

    // The new credential unlocks the POS
    $this->post('/login', ['credential' => '480913'])->assertRedirect(route('dashboard', absolute: false));
    $this->assertAuthenticated();
});

test('setup can only run once', function () {
    setupPos();

    $this->get('/setup')->assertRedirect('/login');

    $this->post('/setup', setupPayload([
        'store_name' => 'Another Store',
        'admin_name' => 'Intruder',
        'credential' => '8642',
        'credential_confirmation' => '8642',
    ]))->assertRedirect('/login');

    $this->postJson('/setup/validate/1', ['store_name' => 'x'])->assertRedirect('/login');

    expect(User::count())->toBe(1)->and(Store::count())->toBe(1);
});

test('a failure while saving leaves nothing half-configured and setup can be restarted', function () {
    Terminal::creating(function () {
        throw new RuntimeException('Simulated disk failure');
    });

    $this->post('/setup', setupPayload([
        'store_logo' => UploadedFile::fake()->image('logo.png', 120, 120),
    ]));

    expect(User::count())->toBe(0)
        ->and(Store::count())->toBe(0)
        ->and(RecoveryQuestion::count())->toBe(0)
        ->and(Storage::disk('public')->allFiles('logos'))->toBe([]);

    $this->get('/')->assertRedirect('/setup');

    // Once the problem is gone, setup completes normally
    Terminal::flushEventListeners();
    $this->post('/setup', setupPayload())->assertSessionHasNoErrors()->assertRedirect('/login');
    expect(User::count())->toBe(1);
});

/* ---------------------------------------------------------------- */
/* Step 2: Admin Account                                             */
/* ---------------------------------------------------------------- */

test('the admin name is required and profile limits match the profile page', function (array $overrides, string $field) {
    $this->post('/setup', setupPayload($overrides))->assertSessionHasErrors($field);

    expect(User::count())->toBe(0);
})->with([
    'missing name' => [['admin_name' => ''], 'admin_name'],
    'phone too long' => [['phone_number' => str_repeat('9', 21)], 'phone_number'],
    'city too long' => [['city' => str_repeat('a', 101)], 'city'],
]);

/* ---------------------------------------------------------------- */
/* Step 3: Sign-in Method                                            */
/* ---------------------------------------------------------------- */

test('pins must have the right length and not be trivial', function (string $type, string $pin) {
    $this->post('/setup', setupPayload([
        'auth_type' => $type,
        'credential' => $pin,
        'credential_confirmation' => $pin,
    ]))->assertSessionHasErrors('credential');

    expect(User::count())->toBe(0);
})->with([
    'too short' => ['pin4', '123'],
    'wrong length for 6' => ['pin6', '2580'],
    'letters' => ['pin4', '12ab'],
    'repeated digits' => ['pin4', '0000'],
    'sequence' => ['pin6', '123456'],
    'simple 1234' => ['pin4', '1234'],
]);

test('pin and password confirmations must match', function (string $type, string $value, string $confirmation) {
    $this->post('/setup', setupPayload([
        'auth_type' => $type,
        'credential' => $value,
        'credential_confirmation' => $confirmation,
    ]))->assertSessionHasErrors('credential');

    expect(User::count())->toBe(0);
})->with([
    'pin mismatch' => ['pin4', '2580', '2581'],
    'password mismatch' => ['password', 'Sari-Sari#2026', 'Sari-Sari#2027'],
]);

test('password credentials must be strong', function () {
    $this->post('/setup', setupPayload([
        'auth_type' => 'password',
        'credential' => 'password',
        'credential_confirmation' => 'password',
    ]))->assertSessionHasErrors('credential');

    $this->post('/setup', setupPayload([
        'auth_type' => 'password',
        'credential' => 'Sari-Sari#2026',
        'credential_confirmation' => 'Sari-Sari#2026',
    ]))->assertSessionHasNoErrors();

    expect(User::admin()->auth_type)->toBe('password');
});

/* ---------------------------------------------------------------- */
/* Step 4: Account Recovery                                          */
/* ---------------------------------------------------------------- */

test('three questions and three answers are required', function (array $recovery, string $field) {
    $this->post('/setup', setupPayload(['recovery' => $recovery]))->assertSessionHasErrors($field);

    expect(User::count())->toBe(0);
})->with([
    'only two questions' => [[
        ['question' => 'What was the name of your first pet?', 'answer' => 'Bantay'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
    ], 'recovery'],
    'missing question' => [[
        ['question' => '', 'answer' => 'Bantay'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ], 'recovery.0.question'],
    'missing answer' => [[
        ['question' => 'What was the name of your first pet?', 'answer' => 'Bantay'],
        ['question' => 'What city were you born in?', 'answer' => ''],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ], 'recovery.1.answer'],
    'blank answer' => [[
        ['question' => 'What was the name of your first pet?', 'answer' => 'Bantay'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => '   '],
    ], 'recovery.2.answer'],
    'unknown question' => [[
        ['question' => 'What is your bank PIN?', 'answer' => '1234'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ], 'recovery.0.question'],
    'custom question too short' => [[
        ['question' => 'custom', 'custom_question' => 'Pet?', 'answer' => 'Bantay'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ], 'recovery.0.custom_question'],
]);

test('the same question cannot be used twice', function () {
    $this->post('/setup', setupPayload(['recovery' => [
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ]]))->assertSessionHasErrors('recovery.1.question');

    $this->post('/setup', setupPayload(['recovery' => [
        ['question' => 'What city were you born in?', 'answer' => 'Cebu'],
        ['question' => 'custom', 'custom_question' => '  what city were you BORN in?  ', 'answer' => 'Cebu'],
        ['question' => 'What was your childhood nickname?', 'answer' => 'Bunso'],
    ]]))->assertSessionHasErrors('recovery.1.question');

    expect(User::count())->toBe(0);
});

test('recovery answers are stored only as hashes of the normalized answer', function () {
    setupPos();

    $rows = RecoveryQuestion::orderBy('position')->get();
    expect($rows->pluck('question')->all())->toBe([
        'What was the name of your first pet?',
        'What city were you born in?',
        'What was the color of my first bike?',
    ]);

    foreach ($rows as $row) {
        expect($row->answer_hash)->not->toContain('Bantay')->not->toContain('Cebu')->not->toContain('Blue')
            ->and(Hash::info($row->answer_hash)['algoName'])->not->toBe('unknown')
            ->and($row->toArray())->not->toHaveKey('answer_hash');
    }

    expect(Hash::check('cebu city', $rows[1]->answer_hash))->toBeTrue();
});
