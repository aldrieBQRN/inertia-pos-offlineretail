<?php

it('sends a fresh install to first-time setup', function () {
    $this->get('/')->assertRedirect('/setup');
});

it('sends a configured but locked POS to the unlock screen', function () {
    setupPos();

    $this->get('/')->assertRedirect('/login');
});
