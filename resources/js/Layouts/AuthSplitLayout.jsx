import React from 'react';
import ApplicationLogo from '@/Components/ApplicationLogo';

/**
 * Dual-panel layout shared by the Admin unlock screen and First-Time Setup.
 * Left: brand hero panel with the bundled Inertia Solutions logo. Right: the page content.
 */
export default function AuthSplitLayout({ storeName, wide = false, children }) {

    return (
        <div className="min-h-screen grid grid-cols-1 lg:grid-cols-12 bg-white selection:bg-[#1B3B6A] selection:text-white">

            {/* LEFT HERO PANEL (Desktop Only / Top Banner on Mobile) */}
            <div className="lg:col-span-5 xl:col-span-5 bg-gradient-to-br from-[#0E2240] via-[#1B3B6A] to-[#142E54] text-white p-8 sm:p-12 lg:p-12 xl:p-16 flex flex-col justify-between relative overflow-hidden shrink-0 min-h-[220px] sm:min-h-[260px] lg:sticky lg:top-0 lg:self-start lg:h-screen">

                {/* Background Image & Ambient Radial Lighting */}
                <div className="absolute inset-0 pointer-events-none">
                    <img
                        src="/images/auth-bg.png"
                        alt=""
                        className="w-full h-full object-cover opacity-25 mix-blend-overlay"
                        onError={(e) => {
                            e.target.style.display = 'none';
                        }}
                    />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.15)_0%,transparent_60%)]"></div>
                    <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-blue-400/10 rounded-full blur-3xl pointer-events-none"></div>
                </div>

                {/* Top: Branding Header */}
                <div className="relative z-10 flex items-center gap-4">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white rounded-none border border-white/20 shadow-xl flex items-center justify-center overflow-hidden shrink-0 p-1">
                        <img src="/logo.png" alt="Inertia Solutions" className="w-full h-full object-contain" />
                    </div>
                    <ApplicationLogo size="lg" dark={true} showSubtitle={true} />
                </div>

                {/* Center: System Value Proposition */}
                <div className="relative z-10 my-4 sm:my-6 lg:my-8 space-y-3 sm:space-y-4 lg:space-y-8 animate-in fade-in slide-in-from-left-6 duration-700">
                    <div className="space-y-2 sm:space-y-3">
                        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-none bg-white/10 border border-white/15 text-blue-200 text-xs font-semibold backdrop-blur-sm">
                            Standalone Offline POS
                        </div>
                        <h2 className="text-lg sm:text-2xl lg:text-3xl xl:text-4xl font-extrabold tracking-tight leading-tight text-white">
                            Streamline retail checkout & manage inventory stock effortlessly.
                        </h2>
                        <p className="text-xs sm:text-sm text-blue-100/80 leading-relaxed max-w-md hidden sm:block">
                            Rapid barcode checkout, real-time stock tracking, drawer cash reconciliation and sales reporting, all stored on this device. No internet required.
                        </p>
                    </div>

                    {/* Feature Badges (Tablet & Desktop) */}
                    <div className="hidden sm:flex flex-col space-y-3 pt-2">
                        <div className="flex items-center gap-3 p-3.5 rounded-none bg-white/5 border border-white/10 backdrop-blur-sm">
                            <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center text-blue-200 shrink-0">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-white">High-Speed POS & Barcode Scanner</h4>
                                <p className="text-[11px] text-blue-200/70">Instant product lookup and quick payments</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 p-3.5 rounded-none bg-white/5 border border-white/10 backdrop-blur-sm">
                            <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center text-blue-200 shrink-0">
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-white">Works Fully Offline</h4>
                                <p className="text-[11px] text-blue-200/70">All products, sales and reports are kept on this device</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Footer (Desktop) */}
                <div className="relative z-10 text-xs text-blue-200/60 hidden lg:block pt-4 border-t border-white/10">
                    &copy; {new Date().getFullYear()} {storeName || 'Inertia POS'}. All rights reserved.
                </div>
            </div>

            {/* RIGHT CONTENT PANEL */}
            <div className="lg:col-span-7 xl:col-span-7 bg-white p-6 sm:p-12 lg:p-16 xl:p-20 flex flex-col justify-center relative">
                <div className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} mx-auto space-y-8 animate-in fade-in duration-500`}>
                    {children}

                    {/* Mobile Footer Notice */}
                    <div className="text-center text-xs text-gray-400 lg:hidden pt-4">
                        &copy; {new Date().getFullYear()} {storeName || 'Inertia POS'}. All rights reserved.
                    </div>
                </div>
            </div>
        </div>
    );
}
