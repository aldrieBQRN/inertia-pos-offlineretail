<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <title inertia>{{ config('app.name', 'Inertia POS') }}</title>

        <!-- Installable app (PWA) meta tags -->
        <meta name="theme-color" content="#0B2545">
        <meta name="description" content="Inertia POS - Standalone offline retail point of sale and inventory management.">
        <meta name="mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-capable" content="yes">
        <meta name="apple-mobile-web-app-status-bar-style" content="black">
        <meta name="apple-mobile-web-app-title" content="Inertia POS">

        <link rel="icon" type="image/png" href="/images/icon-192x192.png">
        <link rel="shortcut icon" type="image/png" href="/images/icon-192x192.png">
        <link rel="manifest" href="/manifest.webmanifest">
        <link rel="apple-touch-icon" href="/images/icon-512x512.png">

        <!-- Fonts are bundled locally (resources/css/fonts.css); no external font requests. -->

        @routes
        @viteReactRefresh
        @vite(['resources/js/app.jsx', "resources/js/Pages/{$page['component']}.jsx"])
        @inertiaHead
    </head>
    <body class="font-sans antialiased">
        @inertia
    </body>
</html>
