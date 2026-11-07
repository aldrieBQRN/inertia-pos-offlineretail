<?php

return [
    /*
    |--------------------------------------------------------------------------
    | Product Identification
    |--------------------------------------------------------------------------
    |
    | Used to ensure a license is valid strictly for this product.
    |
    */
    'product' => 'inertia-pos',
    'product_name' => 'Inertia POS Standalone',

    /*
    |--------------------------------------------------------------------------
    | Public Verification Key (Ed25519)
    |--------------------------------------------------------------------------
    |
    | Asymmetric public key used exclusively to verify license signatures.
    | The private signing key is kept strictly by the developer/license generator
    | and must NEVER be placed in this repository or shipped with the POS.
    |
    */
    'public_key' => env('LICENSE_PUBLIC_KEY', 'b4d81d2473b28a6a27f84afe3f916187e23bb8a4523321f01ebbea0f7d98a346'),
];
