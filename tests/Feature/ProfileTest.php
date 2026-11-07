<?php

test('profile page is displayed', function () {
    $admin = setupPos();

    $this->withoutVite()->actingAs($admin)->get('/profile')->assertOk();
});

test('profile information can be updated', function () {
    $admin = setupPos();

    $this->actingAs($admin)
        ->patch('/profile', [
            'name' => 'Maria Santos',
            'phone_number' => '0917 123 4567',
            'city' => 'Quezon City',
        ])
        ->assertSessionHasNoErrors()
        ->assertRedirect('/profile');

    $admin->refresh();
    expect($admin->name)->toBe('Maria Santos')
        ->and($admin->city)->toBe('Quezon City');
});

test('profile details entered during setup appear on the profile page', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);

    $this->withoutVite()->get('/profile')->assertOk()->assertInertia(fn ($page) => $page
        ->component('Profile/Edit')
        ->where('auth.user.name', 'Store Owner')
        ->where('auth.user.phone_number', '0917 111 2222')
        ->where('auth.user.address', '34 Mabini St.')
        ->where('auth.user.city', 'Makati')
        ->where('auth.user.province', 'Metro Manila')
        ->where('auth.user.country', 'Philippines'));
});
