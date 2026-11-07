<?php

/**
 * Inertia POS License Management Portal Layout Polish Script
 */

$portalDir = 'C:/laragon/www/inertia-pos-license-portal';
$layoutFile = $portalDir . '/resources/views/layouts/app.blade.php';

$layoutCode = <<<'BLADE'
<!DOCTYPE html>
<html lang="en" class="h-full bg-slate-50">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>{{ $title ?? 'License Management' }} - Inertia POS</title>
    <!-- Tailwind CSS (Offline-safe / CDN fallback) -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: {
                            50: '#f0f9ff',
                            100: '#e0f2fe',
                            500: '#0ea5e9',
                            600: '#0284c7',
                            700: '#0369a1',
                            900: '#0c4a6e',
                        },
                        navy: {
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
        /* Custom scrollbar for data tables and sidebars */
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 9999px; }
        ::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: #334155; }
        .sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }
    </style>
</head>
<body class="h-full antialiased text-slate-800 bg-[#F8FAFC]">
    <div class="min-h-full flex flex-col md:flex-row">

        <!-- Mobile Header Bar (Visible on < md) -->
        <header class="md:hidden bg-navy-900 text-white px-4 py-3 flex items-center justify-between border-b border-slate-800 z-30 sticky top-0">
            <div class="flex items-center space-x-2.5">
                <div class="w-7 h-7 rounded-lg bg-sky-500 text-white font-bold text-xs flex items-center justify-center shadow-sm">
                    IP
                </div>
                <div>
                    <span class="font-bold text-xs tracking-wider uppercase">Inertia POS</span>
                    <span class="text-[10px] text-slate-400 block -mt-0.5">License Portal</span>
                </div>
            </div>
            <button id="mobileMenuOpenBtn" type="button" class="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500" aria-label="Open Navigation">
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
            </button>
        </header>

        <!-- Mobile Drawer Backdrop & Overlay -->
        <div id="mobileDrawerBackdrop" class="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 transition-opacity duration-300 opacity-0 pointer-events-none md:hidden" onclick="toggleMobileMenu(false)"></div>

        <!-- Sidebar Navigation (Desktop + Mobile Drawer) -->
        <aside id="sidebarDrawer" class="fixed inset-y-0 left-0 w-64 bg-navy-900 text-slate-300 flex flex-col flex-shrink-0 border-r border-slate-800/80 z-50 transform -translate-x-full transition-transform duration-300 ease-in-out md:static md:translate-x-0 md:z-auto">
            <!-- Branding Header -->
            <div class="h-16 flex items-center justify-between px-5 border-b border-slate-800/80 bg-navy-900/90">
                <a href="{{ route('dashboard') }}" class="flex items-center space-x-3 group">
                    <div class="w-8 h-8 rounded-lg bg-sky-500 flex items-center justify-center font-bold text-xs text-white shadow-sm ring-1 ring-sky-400/30 group-hover:bg-sky-400 transition">
                        IP
                    </div>
                    <div>
                        <div class="font-bold text-xs tracking-wider text-white uppercase flex items-center space-x-1.5">
                            <span>Inertia POS</span>
                        </div>
                        <div class="text-[10px] text-slate-400 tracking-wider font-medium uppercase flex items-center space-x-1">
                            <span>License Authority</span>
                            <span class="w-1 h-1 rounded-full bg-emerald-400"></span>
                        </div>
                    </div>
                </a>
                <button type="button" class="md:hidden text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800" onclick="toggleMobileMenu(false)" aria-label="Close Navigation">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
            </div>

            <!-- Navigation Links -->
            <nav class="flex-1 px-3 py-4 space-y-6 overflow-y-auto sidebar-scroll text-xs">
                <!-- Overview -->
                <div class="space-y-1">
                    <a href="{{ route('dashboard') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('dashboard') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                        <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
                        Dashboard
                    </a>
                </div>

                <!-- Licenses -->
                <div>
                    <div class="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">License Authority</div>
                    <div class="space-y-1">
                        <a href="{{ route('licenses.index') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('licenses.index') || request()->routeIs('licenses.show') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                            <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                            All Licenses
                        </a>
                        <a href="{{ route('licenses.create') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('licenses.create') || request()->routeIs('licenses.generated') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                            <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                            Issue Lifetime License
                        </a>
                    </div>
                </div>

                <!-- Clients -->
                <div>
                    <div class="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Directory</div>
                    <div class="space-y-1">
                        <a href="{{ route('clients.index') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('clients.*') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                            <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                            Client Accounts
                        </a>
                    </div>
                </div>

                <!-- System & Security -->
                <div>
                    <div class="px-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Security & System</div>
                    <div class="space-y-1">
                        <a href="{{ route('activity.index') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('activity.index') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                            <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            Activity Audit Trail
                        </a>
                        <a href="{{ route('settings.index') }}" class="flex items-center px-3 py-2 rounded-lg font-medium transition-colors {{ request()->routeIs('settings.index') ? 'bg-sky-500/10 text-sky-400 font-semibold border-l-2 border-sky-400 pl-2.5' : 'text-slate-400 hover:text-white hover:bg-slate-800/50' }}">
                            <svg class="w-4 h-4 mr-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                            Settings & Keys
                        </a>
                    </div>
                </div>
            </nav>

            <!-- Bottom User & Status Profile -->
            <div class="p-3.5 border-t border-slate-800/80 bg-navy-900">
                <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/40 border border-slate-800/60">
                    <div class="flex items-center space-x-2.5 min-w-0">
                        <div class="w-7 h-7 rounded-full bg-slate-700 text-sky-400 font-semibold text-xs flex items-center justify-center flex-shrink-0 border border-slate-600">
                            {{ strtoupper(substr(auth()->user()->username ?? 'A', 0, 1)) }}
                        </div>
                        <div class="min-w-0">
                            <div class="text-xs font-semibold text-white truncate">{{ auth()->user()->username ?? 'Administrator' }}</div>
                            <div class="text-[10px] text-emerald-400 flex items-center space-x-1 font-medium">
                                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                                <span>Master Admin</span>
                            </div>
                        </div>
                    </div>
                    <form method="POST" action="{{ route('logout') }}">
                        @csrf
                        <button type="submit" class="text-slate-400 hover:text-rose-400 p-1.5 rounded-md hover:bg-slate-800 transition" title="Sign Out">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
                        </button>
                    </form>
                </div>
            </div>
        </aside>

        <!-- Main Workspace Area -->
        <div class="flex-1 flex flex-col min-w-0 overflow-y-auto">
            <!-- Desktop Topbar (Header contextual ribbon) -->
            <header class="hidden md:flex h-16 bg-white border-b border-slate-200/80 px-8 items-center justify-between sticky top-0 z-20">
                <div class="flex items-center space-x-2 text-xs text-slate-500">
                    <span class="font-medium text-slate-700">Inertia POS</span>
                    <span>/</span>
                    <span class="text-slate-900 font-semibold">{{ $title ?? 'License Authority' }}</span>
                </div>
                <div class="flex items-center space-x-4">
                    <div class="flex items-center space-x-2 text-[11px] text-slate-600 bg-slate-100/80 px-2.5 py-1 rounded-full border border-slate-200">
                        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                        <span class="font-medium">Ed25519 Engine: Online</span>
                    </div>
                    <a href="{{ route('licenses.create') }}" class="inline-flex items-center px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg shadow-sm transition">
                        <svg class="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                        Issue License
                    </a>
                </div>
            </header>

            <!-- Notification Messages -->
            <div class="px-4 sm:px-6 lg:px-8 pt-4">
                @if(session('success'))
                    <div class="mb-4 rounded-lg bg-emerald-50 border border-emerald-200/90 p-3.5 text-xs text-emerald-800 flex items-center justify-between shadow-sm animate-fade-in">
                        <div class="flex items-center space-x-2">
                            <svg class="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                            <span class="font-medium">{{ session('success') }}</span>
                        </div>
                        <button onclick="this.parentElement.remove()" class="text-emerald-500 hover:text-emerald-700 p-1">&times;</button>
                    </div>
                @endif
                @if(session('error'))
                    <div class="mb-4 rounded-lg bg-rose-50 border border-rose-200/90 p-3.5 text-xs text-rose-800 flex items-center justify-between shadow-sm">
                        <div class="flex items-center space-x-2">
                            <svg class="w-4 h-4 text-rose-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            <span class="font-medium">{{ session('error') }}</span>
                        </div>
                        <button onclick="this.parentElement.remove()" class="text-rose-500 hover:text-rose-700 p-1">&times;</button>
                    </div>
                @endif
                @if(session('info'))
                    <div class="mb-4 rounded-lg bg-sky-50 border border-sky-200/90 p-3.5 text-xs text-sky-800 flex items-center justify-between shadow-sm">
                        <div class="flex items-center space-x-2">
                            <svg class="w-4 h-4 text-sky-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                            <span class="font-medium">{{ session('info') }}</span>
                        </div>
                        <button onclick="this.parentElement.remove()" class="text-sky-500 hover:text-sky-700 p-1">&times;</button>
                    </div>
                @endif
            </div>

            <!-- Main Page Content -->
            <main class="flex-1 px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-7xl w-full mx-auto">
                @yield('content')
            </main>
        </div>
    </div>

    <!-- Global Floating Toast Notification -->
    <div id="copyToast" class="fixed bottom-6 right-6 bg-slate-900 text-white text-xs font-medium px-4 py-3 rounded-xl shadow-xl border border-slate-700/80 transition-all duration-300 opacity-0 translate-y-2 pointer-events-none z-50 flex items-center space-x-2.5">
        <div class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center flex-shrink-0">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
        </div>
        <span id="copyToastText">Copied to clipboard!</span>
    </div>

    <script>
        function toggleMobileMenu(open) {
            const drawer = document.getElementById('sidebarDrawer');
            const backdrop = document.getElementById('mobileDrawerBackdrop');
            if (open) {
                drawer.classList.remove('-translate-x-full');
                backdrop.classList.remove('opacity-0', 'pointer-events-none');
            } else {
                drawer.classList.add('-translate-x-full');
                backdrop.classList.add('opacity-0', 'pointer-events-none');
            }
        }

        document.getElementById('mobileMenuOpenBtn')?.addEventListener('click', () => toggleMobileMenu(true));

        function copyToClipboard(text, licenseId = null, btn = null) {
            navigator.clipboard.writeText(text).then(function() {
                const toast = document.getElementById('copyToast');
                const toastText = document.getElementById('copyToastText');
                toastText.innerText = 'License key copied to clipboard!';
                toast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
                setTimeout(() => {
                    toast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
                }, 2200);

                if (btn) {
                    const originalHtml = btn.innerHTML;
                    btn.innerHTML = `
                        <svg class="w-3.5 h-3.5 text-emerald-400 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                        <span>Copied!</span>
                    `;
                    btn.classList.add('text-emerald-400');
                    setTimeout(() => {
                        btn.innerHTML = originalHtml;
                        btn.classList.remove('text-emerald-400');
                    }, 2000);
                }

                if (licenseId) {
                    fetch(`/licenses/${licenseId}/log-copy`, {
                        method: 'POST',
                        headers: {
                            'X-CSRF-TOKEN': document.querySelector('meta[name="csrf-token"]').getAttribute('content'),
                            'Accept': 'application/json'
                        }
                    }).catch(() => {});
                }
            }).catch(err => {
                alert('Could not copy automatically. Please select and copy manually.');
            });
        }

        function copyFormattedText(text, message = 'Message copied to clipboard!') {
            navigator.clipboard.writeText(text).then(function() {
                const toast = document.getElementById('copyToast');
                const toastText = document.getElementById('copyToastText');
                toastText.innerText = message;
                toast.classList.remove('opacity-0', 'translate-y-2', 'pointer-events-none');
                setTimeout(() => {
                    toast.classList.add('opacity-0', 'translate-y-2', 'pointer-events-none');
                }, 2200);
            });
        }
    </script>
</body>
</html>
BLADE;

file_put_contents($layoutFile, $layoutCode);
echo "[OK] Updated resources/views/layouts/app.blade.php\n";
