<?php

namespace App\Http\Controllers\Auth;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Models\Store;
use App\Models\User;
use App\Services\ActivityService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Admin unlock (login) and lock (logout) for the standalone POS.
 */
class AuthenticatedSessionController extends Controller
{
    public function create(): Response
    {
        $admin = User::admin();
        $store = Store::current();

        return Inertia::render('Auth/Login', [
            'status' => session('status'),
            'admin_name' => $admin?->name,
            'auth_type' => $admin?->auth_type ?? 'password',
            'store_name' => $store?->name,
            'store_logo_path' => $store?->logo_path,
        ]);
    }

    public function store(LoginRequest $request): RedirectResponse
    {
        $request->authenticate();
        $request->session()->regenerate();

        ActivityService::logSecurityAction('login_success', 'Admin signed in');

        return redirect()->intended(route('dashboard', absolute: false));
    }

    public function destroy(Request $request): RedirectResponse
    {
        if (Auth::check()) {
            ActivityService::logSecurityAction('logout', 'Admin signed out');
        }

        Auth::guard('web')->logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }
}
