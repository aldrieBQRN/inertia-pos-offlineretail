<?php

use App\Models\RecoveryQuestion;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

const CORRECT_ANSWERS = ['Bantay', 'Cebu City', 'Blue'];

test('the unlock screen links to account recovery', function () {
    setupPos();

    $this->withoutVite()->get('/login')->assertOk();
    $this->withoutVite()->get('/recover')
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('Auth/Recover')
            ->where('stage', 'questions')
            ->where('questions', [
                'What was the name of your first pet?',
                'What city were you born in?',
                'What was the color of my first bike?',
            ]));
});

test('the recovery page never exposes the answers or their hashes', function () {
    setupPos();

    $html = $this->withoutVite()->get('/recover')->getContent();
    $hashes = RecoveryQuestion::pluck('answer_hash');

    expect($html)->not->toContain('Bantay')->not->toContain('Cebu City')->not->toContain('answer_hash');
    foreach ($hashes as $hash) {
        expect($html)->not->toContain($hash);
    }

    // Signed-in data endpoints don't include them either
    $this->post('/login', ['credential' => '2580']);
    $json = $this->getJson('/api/user')->getContent();
    expect($json)->not->toContain('answer_hash')->not->toContain('recovery');
});

test('wrong answers are rejected with a generic message and no reset is allowed', function () {
    setupPos();

    $this->post('/recover/verify', ['answers' => ['Bantay', 'Cebu City', 'Red']])
        ->assertSessionHasErrors(['answers' => 'The answers could not be verified.']);

    // Without verification the reset is refused and the PIN is unchanged
    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691'])
        ->assertRedirect('/recover');

    expect(Hash::check('2580', User::admin()->password))->toBeTrue();
});

test('all three answers are required', function () {
    setupPos();

    $this->post('/recover/verify', ['answers' => ['Bantay', 'Cebu City']])->assertSessionHasErrors('answers');
    $this->post('/recover/verify', ['answers' => ['Bantay', 'Cebu City', '']])->assertSessionHasErrors('answers.2');
});

test('correct answers (any case and spacing) allow a new sign-in method', function () {
    setupPos('pin4', '2580');

    $this->post('/recover/verify', ['answers' => ['  BANTAY ', 'cebu   city', 'blue']])
        ->assertSessionHasNoErrors()
        ->assertRedirect('/recover');

    $this->withoutVite()->get('/recover')->assertInertia(fn ($page) => $page->where('stage', 'reset'));

    $this->post('/recover/reset', [
        'auth_type' => 'pin6',
        'credential' => '480913',
        'credential_confirmation' => '480913',
    ])->assertSessionHasNoErrors()->assertRedirect('/recover/done');

    $this->withoutVite()->get('/recover/done')->assertOk()
        ->assertInertia(fn ($page) => $page->where('stage', 'done'));

    $admin = User::admin();
    expect($admin->auth_type)->toBe('pin6');

    // Old credential no longer works, the new one does
    $this->post('/login', ['credential' => '2580'])->assertSessionHasErrors('credential');
    $this->assertGuest();
    $this->post('/login', ['credential' => '480913'])->assertRedirect(route('dashboard', absolute: false));
    $this->assertAuthenticated();
});

test('the new credential must pass the normal sign-in rules', function (string $type, string $value, string $confirmation) {
    setupPos();
    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS]);

    $this->post('/recover/reset', [
        'auth_type' => $type,
        'credential' => $value,
        'credential_confirmation' => $confirmation,
    ])->assertSessionHasErrors('credential');

    expect(Hash::check('2580', User::admin()->password))->toBeTrue();
})->with([
    'simple pin' => ['pin4', '1234', '1234'],
    'mismatch' => ['pin4', '3691', '3692'],
    'weak password' => ['password', 'password', 'password'],
]);

test('a verification can only be used once', function () {
    setupPos();
    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS]);
    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691']);

    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '7410', 'credential_confirmation' => '7410'])
        ->assertRedirect('/recover');

    expect(Hash::check('3691', User::admin()->password))->toBeTrue();
});

test('a verification expires after ten minutes', function () {
    setupPos();
    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS]);

    $this->travel(11)->minutes();

    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691'])
        ->assertRedirect('/recover');
    expect(Hash::check('2580', User::admin()->password))->toBeTrue();
});

test('repeated wrong answers lock recovery, even for the correct answers', function () {
    setupPos();

    foreach (range(1, 5) as $attempt) {
        $this->post('/recover/verify', ['answers' => ['x1', 'x2', 'x3']]);
    }

    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS])
        ->assertSessionHasErrors('answers');
    $this->withoutVite()->get('/recover')->assertInertia(fn ($page) => $page->where('stage', 'questions'));

    // The lock lifts after 15 minutes
    $this->travel(16)->minutes();
    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS])->assertSessionHasNoErrors();
});

test('a successful recovery lifts the unlock-screen lockout', function () {
    setupPos();

    foreach (range(1, 5) as $attempt) {
        $this->post('/login', ['credential' => '9999']);
    }
    $this->post('/login', ['credential' => '2580'])->assertSessionHasErrors('credential');

    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS]);
    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691']);

    $this->post('/login', ['credential' => '3691'])->assertRedirect(route('dashboard', absolute: false));
    $this->assertAuthenticated();
});

test('installs without security questions point to the local reset command', function () {
    setupPos();
    RecoveryQuestion::query()->delete();

    $this->withoutVite()->get('/recover')->assertInertia(fn ($page) => $page->where('stage', 'unavailable'));
    $this->post('/recover/verify', ['answers' => CORRECT_ANSWERS])->assertSessionHasErrors('answers');
});

test('the emergency reset command still works', function () {
    setupPos();

    $this->artisan('pos:reset-credential', ['--type' => 'pin4'])
        ->expectsQuestion('New 4-digit PIN', '3691')
        ->expectsQuestion('Confirm 4-digit PIN', '3691')
        ->assertSuccessful();

    expect(Hash::check('3691', User::admin()->password))->toBeTrue();
});
