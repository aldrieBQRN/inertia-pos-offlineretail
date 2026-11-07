<?php

use Illuminate\Support\Facades\Hash;

test('the admin can change the PIN', function () {
    $admin = setupPos('pin4', '2580');

    $this->actingAs($admin)
        ->from('/profile')
        ->put('/profile/credential', [
            'current_credential' => '2580',
            'auth_type' => 'pin4',
            'credential' => '7391',
            'credential_confirmation' => '7391',
        ])
        ->assertSessionHasNoErrors()
        ->assertRedirect('/profile');

    expect(Hash::check('7391', $admin->refresh()->password))->toBeTrue();
});

test('the admin can switch from a PIN to a password', function () {
    $admin = setupPos('pin4', '2580');

    $this->actingAs($admin)->put('/profile/credential', [
        'current_credential' => '2580',
        'auth_type' => 'password',
        'credential' => 'Sari-Sari#2026',
        'credential_confirmation' => 'Sari-Sari#2026',
    ])->assertSessionHasNoErrors();

    $admin->refresh();
    expect($admin->auth_type)->toBe('password')
        ->and(Hash::check('Sari-Sari#2026', $admin->password))->toBeTrue();
});

test('the current credential must be correct', function () {
    $admin = setupPos('pin4', '2580');

    $this->actingAs($admin)->put('/profile/credential', [
        'current_credential' => '0001',
        'auth_type' => 'pin4',
        'credential' => '7391',
        'credential_confirmation' => '7391',
    ])->assertSessionHasErrors('current_credential');

    expect(Hash::check('2580', $admin->refresh()->password))->toBeTrue();
});
