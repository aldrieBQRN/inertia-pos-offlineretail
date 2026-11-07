<?php

test('login screen can be rendered after setup', function () {
    setupPos();

    $this->withoutVite()->get('/login')->assertOk();
});

test('the admin can unlock the POS with the PIN', function () {
    setupPos('pin4', '2580');

    $response = $this->post('/login', ['credential' => '2580']);

    $this->assertAuthenticated();
    $response->assertRedirect(route('dashboard', absolute: false));
});

test('the admin can unlock the POS with a password', function () {
    setupPos('password', 'Sari-Sari#2026');

    $this->post('/login', ['credential' => 'Sari-Sari#2026']);

    $this->assertAuthenticated();
});

test('a wrong PIN is rejected', function () {
    setupPos('pin4', '2580');

    $this->post('/login', ['credential' => '1111'])->assertSessionHasErrors('credential');

    $this->assertGuest();
});

test('repeated wrong PINs lock the screen', function () {
    setupPos('pin4', '2580');

    foreach (range(1, 5) as $attempt) {
        $this->post('/login', ['credential' => '9999']);
    }

    // Even the correct PIN is refused while locked out
    $this->post('/login', ['credential' => '2580'])->assertSessionHasErrors('credential');
    $this->assertGuest();
});

test('the admin can sign out', function () {
    setupPos('pin4', '2580');
    $this->post('/login', ['credential' => '2580']);

    $this->post('/logout')->assertRedirect('/login');

    $this->assertGuest();
});
