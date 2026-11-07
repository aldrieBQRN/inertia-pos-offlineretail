import React, { useState, useEffect } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import UpdatePasswordForm from './Partials/UpdatePasswordForm';
import UpdateProfileInformationForm from './Partials/UpdateProfileInformationForm';
import { Head } from '@inertiajs/react';

/**
 * Account Settings / Profile Page
 * Standardized with Unified Design System matching Inventory, Transactions, Shift History, Reports, and Store Settings.
 */
export default function Edit({ auth, auth_type = 'password' }) {
    const user = auth?.user || {};
    const [showProfileModal, setShowProfileModal] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);

    // Initial loading animation
    const [loading, setLoading] = useState(false);

    const getInitials = (name) => {
        if (!name) return '??';
        return name
            .split(' ')
            .filter(Boolean)
            .map((n) => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
    };

    const adminBadge = (
        <span className="px-2.5 py-0.5 rounded-none text-xs font-bold uppercase tracking-wider inline-flex items-center justify-center shrink-0 border shadow-xs bg-[#EFF4F9] text-[#1B3A69] border-[#CBD7E6]">Store Administrator</span>
    );

    const signInMethod = { pin4: '4-digit PIN', pin6: '6-digit PIN', password: 'Password' }[auth_type] || 'Password';

    const formatDate = (dateString) => {
        if (!dateString) return 'Not available';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    // Standardized Info Row Component
    const InfoRow = ({ icon, label, value, badge }) => (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between py-3.5 border-b border-gray-100 last:border-0 gap-1.5 sm:gap-4 transition-colors">
            <dt className="flex items-center gap-2.5 text-xs sm:text-sm font-medium text-gray-500">
                <div className="p-1.5 rounded-none bg-gray-50 text-gray-400 border border-gray-100 shrink-0">
                    {icon}
                </div>
                <span>{label}</span>
            </dt>
            <dd className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-gray-900 sm:text-right break-words pl-8 sm:pl-0">
                {value ? (
                    <span>{value}</span>
                ) : (
                    <span className="text-gray-400 font-normal italic text-xs">Not provided</span>
                )}
                {badge}
            </dd>
        </div>
    );

    // ==========================================
    // LOADING SKELETON STATE
    // ==========================================
    if (loading) {
        return (
            <AuthenticatedLayout
                user={user}
                header={
                    <div>
                        <h2 className="font-black text-xl text-gray-900 tracking-tight">Account Settings</h2>
                        <p className="text-xs font-semibold text-gray-500 mt-0.5">
                            Manage your personal profile, credentials, and account security
                        </p>
                    </div>
                }
            >
                <Head title="Account Settings" />
                <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                    <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 animate-pulse space-y-6">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                            <div className="lg:col-span-4 h-96 bg-gray-200 rounded-none"></div>
                            <div className="lg:col-span-8 space-y-6">
                                <div className="h-64 bg-gray-200 rounded-none"></div>
                                <div className="h-64 bg-gray-200 rounded-none"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </AuthenticatedLayout>
        );
    }

    return (
        <AuthenticatedLayout
            user={user}
            header={
                <div>
                    <h2 className="font-black text-xl text-gray-900 tracking-tight">Account Settings</h2>
                    <p className="text-xs font-semibold text-gray-500 mt-0.5">
                        Manage your personal profile, credentials, and account security
                    </p>
                </div>
            }
        >
            <Head title="Account Settings" />

            <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 space-y-6 pb-12">

                    {/* MAIN GRID */}
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                        {/* LEFT COLUMN: IDENTITY & QUICK STATS (lg:col-span-4) */}
                        <div className="lg:col-span-4 space-y-6">
                            
                            {/* Primary User Identity Card */}
                            <div className="bg-white rounded-none border border-gray-200/80 shadow-xs p-6 sm:p-7 text-center relative overflow-hidden flex flex-col items-center">
                                {/* Subtle decorative header gradient */}
                                <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-[#EFF4F9] to-transparent pointer-events-none"></div>

                                {/* Avatar Container */}
                                <div className="relative inline-block mt-2 mb-4">
                                    <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-none ring-4 ring-white shadow-md bg-white overflow-hidden mx-auto z-10 relative border border-gray-200">
                                        {user.avatar_path ? (
                                            <img
                                                src={`/storage/${user.avatar_path}`}
                                                alt={user.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full bg-gradient-to-tr from-[#1B3B6A] to-[#2C5E9E] flex items-center justify-center text-white font-bold text-2xl sm:text-3xl">
                                                {getInitials(user.name)}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* User Meta */}
                                <div className="space-y-1.5 mb-5 relative z-10 w-full">
                                    <h1 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">{user.name}</h1>
                                    <div className="flex flex-col items-center justify-center gap-1.5">
                                        {adminBadge}
                                        <p className="text-xs font-mono font-medium text-gray-400 uppercase tracking-wider mt-0.5">
                                            ID: #{user.account_number || 'ACC-001'}
                                        </p>
                                    </div>
                                </div>

                                {/* Action Buttons - Aligned with Inventory.jsx button sizing */}
                                <div className="flex flex-col gap-2.5 w-full pt-4 border-t border-gray-100">
                                            <button
                                                type="button"
                                                onClick={() => setShowProfileModal(true)}
                                                className="w-full px-4 py-2 sm:py-2.5 rounded-none bg-[#1B3A69] text-white font-bold text-xs sm:text-sm hover:bg-[#142E54] transition-all shadow-xs active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                            >
                                                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                                Edit Profile Details
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setShowPasswordModal(true)}
                                                className="w-full px-4 py-2 sm:py-2.5 rounded-none border border-gray-200 bg-white text-gray-700 font-bold text-xs sm:text-sm hover:bg-gray-50 transition-all shadow-xs active:scale-95 flex items-center justify-center gap-2 cursor-pointer"
                                            >
                                                <svg className="w-4 h-4 shrink-0 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                                </svg>
                                                Change PIN / Password
                                            </button>
                                </div>
                            </div>

                            {/* Account Status & Security Card */}
                            <div className="bg-white rounded-none border border-gray-200/80 shadow-xs p-5 sm:p-6 space-y-4">
                                <div className="border-b border-gray-100 pb-3">
                                    <h3 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2">
                                        <svg className="w-4 h-4 text-[#1B3A69]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        Account Standing
                                    </h3>
                                </div>

                                <div className="space-y-3 text-xs sm:text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500 font-medium">Account Status</span>
                                        <span className="font-bold text-emerald-600">Active</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500 font-medium">Member Since</span>
                                        <span className="font-semibold text-gray-800">{formatDate(user.created_at)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-500 font-medium">Security Level</span>
                                        <span className="font-semibold text-[#1B3A69]">Encrypted / Protected</span>
                                    </div>
                                </div>
                            </div>

                        </div>

                        {/* RIGHT COLUMN: DETAILED SECTIONS (lg:col-span-8) */}
                        <div className="lg:col-span-8 space-y-6">

                            {/* Section 1: Personal & Contact Information */}
                            <div className="bg-white rounded-none border border-gray-200/80 shadow-xs overflow-hidden">
                                <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                                    <div className="p-2 bg-[#EFF4F9] text-[#1B3A69] rounded-none shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h2 className="text-sm sm:text-base font-bold text-gray-900">Personal Information</h2>
                                        <p className="text-xs text-gray-500 mt-0.5">Your Admin profile and contact details.</p>
                                    </div>
                                </div>

                                <div className="p-5 sm:p-6">
                                    <dl className="space-y-1">
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>}
                                            label="Sign-in Method"
                                            value={signInMethod}
                                        />
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>}
                                            label="Contact Phone"
                                            value={user.phone_number}
                                        />
                                    </dl>
                                </div>
                            </div>

                            {/* Section 2: Location & Address */}
                            <div className="bg-white rounded-none border border-gray-200/80 shadow-xs overflow-hidden">
                                <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-center gap-3">
                                    <div className="p-2 bg-[#EFF4F9] text-[#1B3A69] rounded-none shrink-0">
                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                    <div>
                                        <h2 className="text-sm sm:text-base font-bold text-gray-900">Location & Address</h2>
                                        <p className="text-xs text-gray-500 mt-0.5">Physical location and regional assignment details.</p>
                                    </div>
                                </div>

                                <div className="p-5 sm:p-6">
                                    <dl className="space-y-1">
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>}
                                            label="Street Address"
                                            value={user.address}
                                        />
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}
                                            label="City / Municipality"
                                            value={user.city}
                                        />
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>}
                                            label="Province / Region"
                                            value={user.province}
                                        />
                                        <InfoRow
                                            icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                                            label="Country"
                                            value={user.country}
                                        />
                                    </dl>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* MODALS */}
            <UpdateProfileInformationForm
                isOpen={showProfileModal}
                onClose={() => setShowProfileModal(false)}
                user={user}
            />

            <UpdatePasswordForm
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
                currentAuthType={auth_type}
            />

        </AuthenticatedLayout>
    );
}