<?php

use App\Http\Controllers\Auth\AccountRecoveryController;
use App\Http\Controllers\Auth\AuthenticatedSessionController;
use Illuminate\Support\Facades\Route;

Route::middleware('guest')->group(function () {
    Route::get('login', [AuthenticatedSessionController::class, 'create'])
        ->name('login');

    Route::post('login', [AuthenticatedSessionController::class, 'store']);

    // Offline account recovery (security questions)
    Route::get('recover', [AccountRecoveryController::class, 'show'])->name('recover');
    Route::post('recover/verify', [AccountRecoveryController::class, 'verify'])->name('recover.verify');
    Route::post('recover/reset', [AccountRecoveryController::class, 'reset'])->name('recover.reset');
    Route::get('recover/done', [AccountRecoveryController::class, 'done'])->name('recover.done');
});

Route::middleware('auth')->group(function () {
    Route::post('logout', [AuthenticatedSessionController::class, 'destroy'])
        ->name('logout');
});
