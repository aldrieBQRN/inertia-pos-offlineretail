<?php

namespace App\Http\Middleware;

use App\Models\User;
use App\Services\LicenseService;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Routes the device to License Activation until an active license is bound,
 * then to First-Time Setup until the Admin account exists,
 * and keeps setup/activation screens closed once configured.
 */
class EnsureAppIsConfigured
{
    public function handle(Request $request, Closure $next): Response
    {
        // Static/utility endpoints never depend on setup or license state
        if ($request->is('up', 'storage/*', 'manifest.webmanifest', 'build/*')) {
            return $next($request);
        }

        $licenseService = app(LicenseService::class);
        $activated = $licenseService->isActivated();
        $onActivate = $request->routeIs('activate', 'activate.store', 'activate.deactivate');

        // 1. Activation Gate
        if (!$activated) {
            if ($onActivate) {
                return $next($request);
            }

            if ($request->expectsJson() && !$request->header('X-Inertia')) {
                return response()->json(['message' => 'License has not been activated.'], 403);
            }

            return redirect()->route('activate');
        }

        $configured = self::isConfigured();

        // If activated but user attempts to visit /activate, redirect forward
        if ($activated && $onActivate) {
            return redirect()->route($configured ? ($request->user() ? 'dashboard' : 'login') : 'setup');
        }

        // 2. First-Time Setup Gate
        $onSetup = $request->routeIs('setup', 'setup.store', 'setup.validate');

        if (!$configured && !$onSetup) {
            if ($request->expectsJson() && !$request->header('X-Inertia')) {
                return response()->json(['message' => 'First-Time Setup has not been completed.'], 409);
            }

            return redirect()->route('setup');
        }

        if ($configured && $onSetup) {
            return redirect()->route($request->user() ? 'dashboard' : 'login');
        }

        return $next($request);
    }

    public static function isConfigured(): bool
    {
        try {
            return User::query()->exists();
        } catch (\Throwable $e) {
            // Database not migrated yet: treat as unconfigured
            return false;
        }
    }
}
