<?php

// First install flow: License Activation -> First-Time Setup -> Login

it('sends a fresh install to license activation first', function () {
    $this->get('/')->assertRedirect('/activate');
    $this->get('/setup')->assertRedirect('/activate');
});

it('sends an activated but unconfigured POS to first-time setup', function () {
    activateLicense();

    $this->get('/')->assertRedirect('/setup');
    $this->get('/activate')->assertRedirect('/setup');
});

it('sends a configured but locked POS to the unlock screen', function () {
    setupPos();

    $this->get('/')->assertRedirect('/login');
});
