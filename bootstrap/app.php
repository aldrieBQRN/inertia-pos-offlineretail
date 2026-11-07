<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Inertia\Inertia;
use App\Http\Middleware\EnsureAppIsConfigured;
use App\Http\Middleware\SecurityHeaders;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__ . '/../routes/web.php',
        commands: __DIR__ . '/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->web(append: [
            EnsureAppIsConfigured::class,
            \App\Http\Middleware\HandleInertiaRequests::class,
            SecurityHeaders::class,
        ]);

        // Send an unconfigured install to First-Time Setup before any auth redirect happens
        $middleware->prependToPriorityList(
            before: \Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests::class,
            prepend: EnsureAppIsConfigured::class,
        );

        // Signed-in Admin hitting /login or /setup goes straight to the dashboard
        $middleware->redirectUsersTo('/dashboard');
    })
    ->withExceptions(function (Exceptions $exceptions) {

        // Render Custom Inertia Error Pages
        $exceptions->respond(function (Response $response, \Throwable $exception, Request $request) {
            // API calls and plain JSON (axios) requests keep their JSON error responses
            if ($request->is('api/*') || ($request->expectsJson() && !$request->header('X-Inertia'))) {
                return $response;
            }

            $validStatuses = [500, 503, 404, 403];

            if (in_array($response->getStatusCode(), $validStatuses)) {
                // In local development, let Laravel show its detailed error page for 500 crashes
                if (config('app.debug') && $response->getStatusCode() === 500) {
                    return $response;
                }

                return Inertia::render('Error', ['status' => $response->getStatusCode()])
                    ->toResponse($request)
                    ->setStatusCode($response->getStatusCode());
            }

            return $response;
        });
    })->create();

// Allow production launcher to redirect storage to %LOCALAPPDATA%\InertiaPOS\storage
$customStorage = env('APP_STORAGE_PATH') ?: getenv('APP_STORAGE_PATH') ?: env('LARAVEL_STORAGE_PATH') ?: getenv('LARAVEL_STORAGE_PATH');
if ($customStorage) {
    $app->useStoragePath($customStorage);
}

return $app;
