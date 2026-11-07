<?php

/**
 * Inertia POS License Management Portal - Comprehensive Views Polish
 */

$portalDir = 'C:/laragon/www/inertia-pos-license-portal';
$viewsDir = $portalDir . '/resources/views';

echo "=== Updating All Portal Blade Views (with safe \$errors checks) ===\n\n";

// =============================================================================
// 1. auth/login.blade.php
// =============================================================================
$loginCode = <<<'BLADE'
<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-950">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $isFirstRun ? 'Master Admin Setup' : 'Administrator Sign In' }} - Inertia POS</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        navy: {
                            950: '#060911',
                            900: '#0b0f19',
                            800: '#111827',
                            700: '#1f2937',
                        }
                    },
                    fontFamily: {
                        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
                        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
                    }
                }
            }
        }
    </script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    </style>
</head>
<body class="h-full flex items-center justify-center p-4 sm:p-6 text-slate-100 bg-[#070b14] relative overflow-hidden">
    <!-- Subtle architectural background glow -->
    <div class="absolute -top-40 -left-40 w-96 h-96 bg-sky-600/10 rounded-full blur-3xl pointer-events-none"></div>
    <div class="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>

    <div class="max-w-md w-full relative z-10">
        <!-- Brand Header -->
        <div class="text-center mb-6 sm:mb-8">
            <div class="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-500 to-sky-600 text-white font-bold text-lg flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-500/20 ring-1 ring-sky-400/30">
                IP
            </div>
            <h1 class="text-lg font-bold tracking-wider text-white uppercase">Inertia POS</h1>
            <p class="text-xs text-slate-400 font-medium tracking-widest uppercase mt-0.5">License Management Authority</p>
        </div>

        <!-- Auth Card -->
        <div class="bg-navy-900/90 border border-slate-800/90 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            @if($isFirstRun)
                <div class="mb-6 pb-4 border-b border-slate-800">
                    <div class="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold mb-2">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        <span>First-Time Initialization</span>
                    </div>
                    <h2 class="text-base font-semibold text-white">Create Master Administrator</h2>
                    <p class="text-xs text-slate-400 mt-1 leading-relaxed">Set up your private administrator account. This account holds master authority over Ed25519 license generation.</p>
                </div>
            @else
                <div class="mb-6 pb-4 border-b border-slate-800">
                    <h2 class="text-base font-semibold text-white">Administrator Sign In</h2>
                    <p class="text-xs text-slate-400 mt-1">Authenticate to access the private license generation portal.</p>
                </div>
            @endif

            @if(isset($errors) && $errors->any())
                <div class="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start space-x-2">
                    <svg class="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                    <span>{{ $errors->first() }}</span>
                </div>
            @endif

            <form method="POST" action="{{ route('login.post') }}" class="space-y-4" id="loginForm">
                @csrf
                <div>
                    <label for="username" class="block text-xs font-semibold text-slate-300 mb-1.5">Username</label>
                    <div class="relative">
                        <input type="text" name="username" id="username" value="{{ old('username', $isFirstRun ? 'admin' : '') }}" required autofocus
                            placeholder="e.g. admin"
                            class="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition">
                    </div>
                </div>

                <div>
                    <label for="password" class="block text-xs font-semibold text-slate-300 mb-1.5">Password</label>
                    <div class="relative">
                        <input type="password" name="password" id="password" required placeholder="••••••••"
                            class="w-full pl-3.5 pr-10 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition">
                        <button type="button" onclick="togglePasswordVisibility('password', this)" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 focus:outline-none" aria-label="Toggle password visibility">
                            <svg class="w-4 h-4 eye-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        </button>
                    </div>
                </div>

                @if($isFirstRun)
                    <div>
                        <label for="password_confirmation" class="block text-xs font-semibold text-slate-300 mb-1.5">Confirm Password</label>
                        <div class="relative">
                            <input type="password" name="password_confirmation" id="password_confirmation" required placeholder="••••••••"
                                class="w-full pl-3.5 pr-10 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition">
                            <button type="button" onclick="togglePasswordVisibility('password_confirmation', this)" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-200 focus:outline-none" aria-label="Toggle password visibility">
                                <svg class="w-4 h-4 eye-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                            </button>
                        </div>
                    </div>
                @endif

                <div class="pt-2">
                    <button type="submit" id="submitBtn"
                        class="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white font-semibold text-xs rounded-xl transition duration-150 shadow-md shadow-sky-500/20 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-navy-900 flex items-center justify-center space-x-2">
                        <span>{{ $isFirstRun ? 'Create Account & Initialize Portal' : 'Sign In to Portal' }}</span>
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                    </button>
                </div>
            </form>
        </div>

        <!-- Footer Notice -->
        <div class="text-center mt-6 text-[11px] text-slate-500 space-y-1">
            <div class="flex items-center justify-center space-x-1.5">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>Secure Local Administration</span>
                <span>&bull;</span>
                <span>Ed25519 Engine</span>
            </div>
            <div>Inertia POS &bull; Private Administrator Authority</div>
        </div>
    </div>

    <script>
        function togglePasswordVisibility(fieldId, btn) {
            const field = document.getElementById(fieldId);
            if (field.type === 'password') {
                field.type = 'text';
                btn.innerHTML = `<svg class="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>`;
            } else {
                field.type = 'password';
                btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
            }
        }
    </script>
</body>
</html>
BLADE;
file_put_contents($viewsDir . '/auth/login.blade.php', $loginCode);
echo "  [OK] Updated auth/login.blade.php\n";

// =============================================================================
// 2. licenses/create.blade.php
// =============================================================================
$createCode = <<<'BLADE'
@extends('layouts.app')

@section('content')
<div class="max-w-2xl mx-auto space-y-6">
    <!-- Breadcrumb & Header -->
    <div>
        <a href="{{ route('licenses.index') }}" class="text-xs font-medium text-slate-500 hover:text-slate-900 inline-flex items-center space-x-1 mb-2 group transition">
            <svg class="w-3.5 h-3.5 text-slate-400 group-hover:-translate-x-0.5 transition" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            <span>Back to Licenses</span>
        </a>
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Issue Lifetime License</h1>
        <p class="text-xs text-slate-500 mt-0.5">Cryptographically sign a permanent offline license bound to the client's hardware.</p>
    </div>

    <!-- Form Container -->
    <div class="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm">
        @if(isset($errors) && $errors->any())
            <div class="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start space-x-2.5">
                <svg class="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span>{{ $errors->first() }}</span>
            </div>
        @endif

        <form method="POST" action="{{ route('licenses.store') }}" class="space-y-6" id="licenseForm" onsubmit="handleFormSubmit(this)">
            @csrf

            <!-- Client Store Name -->
            <div>
                <label for="client_name" class="block text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                    Client Store Name <span class="text-rose-500">*</span>
                </label>
                <input type="text" name="client_name" id="client_name" value="{{ old('client_name') }}" placeholder="e.g. Juan Retail Store" required autofocus
                    class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition">
                <p class="text-[11px] text-slate-400 mt-1.5">The business name or customer entity receiving this license.</p>
            </div>

            <!-- Machine ID Input with Auto-formatting -->
            <div>
                <div class="flex items-center justify-between mb-2">
                    <label for="machine_id" class="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Client Machine ID <span class="text-rose-500">*</span>
                    </label>
                    <span class="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded">POS-XXXX-XXXX-XXXX-XXXX</span>
                </div>
                <input type="text" name="machine_id" id="machine_id" value="{{ old('machine_id') }}" placeholder="POS-AAD3-0752-1729-737A" required
                    class="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent uppercase tracking-wider transition"
                    oninput="formatMachineId(this)">
                <p class="text-[11px] text-slate-400 mt-1.5">
                    Found on the client's screen on Step 1 (Software Activation) of their offline installation.
                </p>
            </div>

            <!-- Lifetime License Terms Callout -->
            <div class="p-4 sm:p-5 bg-slate-50 border border-slate-200/80 rounded-xl space-y-3">
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">License Model</span>
                    <span class="font-bold text-emerald-700 bg-emerald-100/70 border border-emerald-200/60 px-2.5 py-0.5 rounded-full text-[11px] flex items-center space-x-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                        <span>Lifetime / Perpetual</span>
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-200/60 text-slate-600">
                    <div>
                        <span class="text-slate-400 block text-[11px]">Validity:</span>
                        <span class="font-medium text-slate-800">Never Expires</span>
                    </div>
                    <div>
                        <span class="text-slate-400 block text-[11px]">Signing Algorithm:</span>
                        <span class="font-medium text-slate-800 font-mono">Ed25519 Detached</span>
                    </div>
                </div>
            </div>

            <!-- Form Actions -->
            <div class="pt-2 flex items-center justify-end space-x-3">
                <a href="{{ route('licenses.index') }}" class="px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition">
                    Cancel
                </a>
                <button type="submit" id="generateSubmitBtn"
                    class="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-600/20 transition flex items-center space-x-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    <span>Generate & Sign License</span>
                </button>
            </div>
        </form>
    </div>
</div>

<script>
    function formatMachineId(input) {
        let val = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (val.startsWith('POS')) {
            val = val.substring(3);
        }
        val = val.substring(0, 16);
        let parts = ['POS'];
        for (let i = 0; i < val.length; i += 4) {
            parts.push(val.substring(i, i + 4));
        }
        input.value = parts.join('-');
    }

    function handleFormSubmit(form) {
        const btn = document.getElementById('generateSubmitBtn');
        btn.disabled = true;
        btn.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            <span>Signing License...</span>
        `;
    }
</script>
@endsection
BLADE;
file_put_contents($viewsDir . '/licenses/create.blade.php', $createCode);
echo "  [OK] Updated licenses/create.blade.php\n";

// =============================================================================
// 3. settings/index.blade.php
// =============================================================================
$settingsCode = <<<'BLADE'
@extends('layouts.app')

@section('content')
<div class="max-w-3xl space-y-8">
    <!-- Header -->
    <div>
        <h1 class="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Settings & Security</h1>
        <p class="text-xs text-slate-500 mt-0.5">Cryptographic system health and master administrator credentials.</p>
    </div>

    <!-- Cryptographic Configuration Card -->
    <div class="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
        <div class="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
                <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Cryptographic Authority Status</h2>
                <p class="text-xs text-slate-500 mt-0.5">Asymmetric Ed25519 signing engine parameters.</p>
            </div>
            <span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse"></span>
                Engine Healthy
            </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span class="text-slate-400 block font-medium uppercase text-[10px]">Target Product</span>
                <span class="font-bold text-slate-900 mt-0.5 block text-xs">{{ $productName }} (<code>{{ $product }}</code>)</span>
            </div>

            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span class="text-slate-400 block font-medium uppercase text-[10px]">License Model</span>
                <span class="font-bold text-emerald-700 mt-0.5 block text-xs">Lifetime / Perpetual (Offline)</span>
            </div>

            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span class="text-slate-400 block font-medium uppercase text-[10px]">Signing Algorithm</span>
                <span class="font-bold text-slate-900 mt-0.5 block text-xs font-mono">Ed25519 (Sodium Detached)</span>
            </div>

            <div class="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl">
                <span class="text-slate-400 block font-medium uppercase text-[10px]">Private Signing Key</span>
                <div class="mt-0.5 flex items-center space-x-1.5">
                    @if($keyConfigured)
                        <span class="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                        <span class="font-bold text-emerald-700 text-xs">Configured & Protected</span>
                    @else
                        <span class="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                        <span class="font-bold text-rose-700 text-xs">Missing Private Key</span>
                    @endif
                </div>
            </div>
        </div>

        <!-- Public Key Hex Box with Copy -->
        <div class="pt-2">
            <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-bold text-slate-800 uppercase tracking-wider">Public Verification Key (Bundled in POS)</span>
                <button type="button" onclick="copyToClipboard('{{ $publicKey }}', null, this)" class="text-xs font-semibold text-sky-600 hover:text-sky-700 flex items-center space-x-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
                    <span>Copy Hex</span>
                </button>
            </div>
            <div class="p-2.5 font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl break-all select-all">
                {{ $publicKey }}
            </div>
        </div>

        <div class="text-[11px] text-slate-500 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-1">
            <div class="font-semibold text-slate-800">Security Guarantee</div>
            <p>The private signing key is stored strictly on this machine in <code>keys/license_private.key</code> and is excluded from git and distribution packages. Customers only possess the public verification key.</p>
        </div>
    </div>

    <!-- Change Password Form -->
    <div class="bg-white border border-slate-200/90 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
        <div class="pb-3 border-b border-slate-100">
            <h2 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Change Administrator Password</h2>
            <p class="text-xs text-slate-500 mt-0.5">Update credentials for logging into this local license authority portal.</p>
        </div>

        @if(isset($errors) && $errors->any())
            <div class="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center space-x-2">
                <svg class="w-4 h-4 text-rose-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                <span>{{ $errors->first() }}</span>
            </div>
        @endif

        <form method="POST" action="{{ route('settings.password') }}" class="space-y-4 max-w-md">
            @csrf

            <div>
                <label for="current_password" class="block text-xs font-semibold text-slate-700 mb-1.5">Current Password</label>
                <div class="relative">
                    <input type="password" name="current_password" id="current_password" required
                        class="w-full pl-3.5 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition">
                    <button type="button" onclick="togglePasswordVisibility('current_password', this)" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
            </div>

            <div>
                <label for="new_password" class="block text-xs font-semibold text-slate-700 mb-1.5">New Password</label>
                <div class="relative">
                    <input type="password" name="password" id="new_password" required
                        class="w-full pl-3.5 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition">
                    <button type="button" onclick="togglePasswordVisibility('new_password', this)" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
            </div>

            <div>
                <label for="password_confirmation" class="block text-xs font-semibold text-slate-700 mb-1.5">Confirm New Password</label>
                <div class="relative">
                    <input type="password" name="password_confirmation" id="password_confirmation" required
                        class="w-full pl-3.5 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 transition">
                    <button type="button" onclick="togglePasswordVisibility('password_confirmation', this)" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 focus:outline-none">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    </button>
                </div>
            </div>

            <div class="pt-2">
                <button type="submit" class="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-sm transition">
                    Update Password
                </button>
            </div>
        </form>
    </div>
</div>

<script>
    function togglePasswordVisibility(fieldId, btn) {
        const field = document.getElementById(fieldId);
        if (field.type === 'password') {
            field.type = 'text';
            btn.innerHTML = `<svg class="w-4 h-4 text-sky-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>`;
        } else {
            field.type = 'password';
            btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
        }
    }
</script>
@endsection
BLADE;
file_put_contents($viewsDir . '/settings/index.blade.php', $settingsCode);
echo "  [OK] Updated settings/index.blade.php\n";

echo "\nAll updated views written successfully!\n";
