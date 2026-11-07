<?php

namespace App\Providers;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Facades\Vite;
use Illuminate\Support\ServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Http\Request;

/**
 * Global Application Service Provider
 * * Used to register and bootstrap various services,
 * global configurations, and asset management logic.
 */
class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     * * Bind interfaces to implementations or register singleton services here.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     * * Runs after all other service providers have been registered.
     */
    public function boot(): void
    {
        // Fix for MySQL key length on older MySQL versions / shared hosting (InfinityFree)
        Schema::defaultStringLength(191);

        // Configures Vite to prefetch assets for improved frontend performance
        Vite::prefetch(concurrency: 3);

        // Installed (production) POS: always use the bundled offline assets, even if a stray
        // public/hot file from a Vite dev server is present.
        if ($this->app->isProduction()) {
            Vite::useHotFile(storage_path('framework/vite.hot.disabled'));
        }

        // Production guardrail: never change user flow, only record the risk if debug is left on.
        if (app()->environment('production') && config('app.debug')) {
            Log::warning('Production debug mode is enabled. Set APP_DEBUG=false before deploying.');
        }

        // Force HTTPS scheme only if APP_URL is explicitly configured with https://
        if (str_starts_with(config('app.url') ?? '', 'https://')) {
            URL::forceScheme('https');
        }

        // 1. Guest API Throttling: Strict rate limit to prevent brute force & signature scanning (10 per minute per IP)
        RateLimiter::for('guest_api', function (Request $request) {
            if (app()->environment('local')) {
                return Limit::none();
            }
            return Limit::perMinute(10)->by($request->ip());
        });

        // 2. Auth API Throttling: High limit per User ID to avoid interrupting busy cashiers/admins
        RateLimiter::for('auth_api', function (Request $request) {
            if (app()->environment('local')) {
                return Limit::none();
            }
            return Limit::perMinute(300)->by($request->user()?->id ?: $request->ip());
        });

        // 3. Checkout API Throttling: High limit to support rapid scanning & checkouts, but prevents double clicks
        RateLimiter::for('checkout_api', function (Request $request) {
            if (app()->environment('local')) {
                return Limit::none();
            }
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });
    }
}
