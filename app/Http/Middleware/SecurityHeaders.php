<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Support\Facades\App;

class SecurityHeaders
{
    /**
     * Handle an incoming request.
     *
     * @param  \Closure(\Illuminate\Http\Request): (\Symfony\Component\HttpFoundation\Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        // Prevent clickjacking attacks
        // SAMEORIGIN: iframe only allowed from same origin
        $response->header('X-Frame-Options', 'SAMEORIGIN');

        // Prevent MIME type sniffing
        // Forces browser to respect declared content-type
        $response->header('X-Content-Type-Options', 'nosniff');

        // XSS Protection
        // Modern browsers: 1; mode=block stops page if XSS detected
        $response->header('X-XSS-Protection', '1; mode=block');

        // Strict Transport Security (HSTS)
        // Only enable if explicitly configured in .env with FORCE_HTTPS=true
        if (config('app.force_https', false) && request()->secure()) {
            $response->header('Strict-Transport-Security', 'max-age=31536000');
        }

        // Referrer Policy
        // strict-origin-when-cross-origin:
        // - Send full URL for same-origin requests
        // - Send only origin for cross-origin requests
        $response->header('Referrer-Policy', 'strict-origin-when-cross-origin');

        // Permissions Policy (formerly Feature Policy)
        // Camera stays available to this app only (barcode scanning via device camera)
        $response->header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self), payment=()');

        // Content Security Policy (CSP)
        // Standalone offline build: every script, style, font, image and request must come
        // from this local installation. In development, also allow the Vite dev server.
        $isLocal = App::environment('local', 'development');
        $devHosts = 'http://localhost:* ws://localhost:* http://127.0.0.1:* ws://127.0.0.1:*';
        $scriptSrc = $isLocal
            ? "'self' 'unsafe-inline' 'unsafe-eval' {$devHosts}"
            : "'self' 'unsafe-inline'";
        $devSrc = $isLocal ? " {$devHosts}" : '';

        $csp = "default-src 'self'; "
            . "script-src {$scriptSrc}; "
            . "style-src 'self' 'unsafe-inline'{$devSrc}; "
            . "img-src 'self' data: blob:{$devSrc}; "
            . "font-src 'self' data:{$devSrc}; "
            . "connect-src 'self'{$devSrc}; "
            . "frame-ancestors 'self'; "
            . "base-uri 'self'; "
            . "form-action 'self';";

        $response->header('Content-Security-Policy', $csp);

        return $response;
    }
}
