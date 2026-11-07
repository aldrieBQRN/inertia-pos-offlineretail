import React, { useState, useEffect } from 'react';
import { Head, Link, useForm } from '@inertiajs/react';
import AuthSplitLayout from '@/Layouts/AuthSplitLayout';
import PinPad from '@/Components/PinPad';

/**
 * Admin Unlock Screen
 * The standalone POS has a single Admin account, so only the PIN or password is asked for.
 */
export default function Login({ status, admin_name, auth_type = 'password', store_name, store_logo_path }) {
    const isPin = auth_type === 'pin4' || auth_type === 'pin6';
    const pinLength = auth_type === 'pin6' ? 6 : 4;

    const [showPassword, setShowPassword] = useState(false);
    const { data, setData, post, transform, processing, errors, reset, clearErrors } = useForm({ credential: '' });

    useEffect(() => {
        return () => reset('credential');
    }, []);

    // Clear a wrong PIN so the Admin can retype immediately
    useEffect(() => {
        if (errors.credential && isPin) {
            const t = setTimeout(() => setData('credential', ''), 350);
            return () => clearTimeout(t);
        }
    }, [errors]);

    const submit = (e) => {
        e?.preventDefault();
        transform((d) => d);
        post(route('login'), { preserveScroll: true });
    };

    const submitPin = (pin) => {
        // useForm state updates are async; submit the completed PIN explicitly
        transform(() => ({ credential: pin }));
        post(route('login'), { preserveScroll: true });
    };

    const storeLogoUrl = store_logo_path
        ? (store_logo_path.startsWith('/') ? store_logo_path : `/storage/${store_logo_path}`)
        : null;


    const inputClasses = "appearance-none block w-full px-4 py-3.5 border border-gray-200 rounded-none shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] sm:text-sm font-bold text-gray-900 bg-gray-50/50 transition-all";
    const labelClasses = "block text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1 mb-1.5";
    const errorClasses = "mt-1.5 ml-1 text-[10px] font-bold text-red-500 uppercase tracking-wide";

    return (
        <AuthSplitLayout storeName={store_name}>
            <Head title="Unlock POS" />

            {/* Header */}
            <div className="flex flex-col items-center gap-4 text-center">
                {storeLogoUrl && (
                    <div className="w-14 h-14 rounded-none border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
                        <img src={storeLogoUrl} alt={store_name || 'Store logo'} className="w-full h-full object-contain" />
                    </div>
                )}
                <div className="min-w-0 max-w-full">
                    <h2 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight truncate">
                        Welcome back{admin_name ? `, ${admin_name.split(' ')[0]}` : ''}
                    </h2>
                    <p className="mt-1 text-sm font-semibold text-gray-500 truncate">
                        {isPin ? `Enter your ${pinLength}-digit PIN to unlock ${store_name || 'the POS'}.` : `Enter your password to unlock ${store_name || 'the POS'}.`}
                    </p>
                </div>
            </div>

            {status && (
                <div className="font-bold text-sm text-emerald-700 text-center bg-emerald-50 p-3.5 rounded-none border border-emerald-200">
                    {status}
                </div>
            )}

            {isPin ? (
                <div className="space-y-4">
                    <PinPad
                        length={pinLength}
                        value={data.credential}
                        onChange={(v) => {
                            clearErrors();
                            setData('credential', v);
                        }}
                        onComplete={submitPin}
                        disabled={processing}
                        hasError={Boolean(errors.credential)}
                    />
                    <p className={`text-center min-h-[16px] ${errorClasses}`} role="alert">{errors.credential}</p>
                </div>
            ) : (
                <form onSubmit={submit} className="space-y-5">
                    <div className="relative">
                        <label className={labelClasses} htmlFor="credential">Password</label>
                        <input
                            id="credential"
                            type={showPassword ? 'text' : 'password'}
                            name="credential"
                            value={data.credential}
                            onChange={(e) => setData('credential', e.target.value)}
                            className={inputClasses}
                            placeholder="Enter your password"
                            autoComplete="current-password"
                            autoFocus
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-[38px] text-gray-400 hover:text-gray-600 transition-colors cursor-pointer"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                            {showPassword ? (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0a10.05 10.05 0 015.188-1.583 8.32 8.32 0 013.89.981L19.5 19.5" /></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            )}
                        </button>
                        {errors.credential && <p className={errorClasses} role="alert">{errors.credential}</p>}
                    </div>

                    <div className="pt-4 border-t border-gray-100">
                        <button
                            type="submit"
                            disabled={processing || !data.credential}
                            className={`w-full py-4 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-black text-[12px] uppercase tracking-widest rounded-none shadow-lg shadow-[#1B3B6A]/20 active:scale-[0.98] transition-all flex justify-center items-center gap-2 cursor-pointer
                                ${processing || !data.credential ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                            {processing ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    Unlocking...
                                </>
                            ) : 'Unlock'}
                        </button>
                    </div>
                </form>
            )}

            <div className="text-center">
                <Link
                    href={route('recover')}
                    className="text-sm font-bold text-[#1B3B6A] hover:text-[#142E54] hover:underline"
                >
                    Forgot {isPin ? 'PIN' : 'password'}?
                </Link>
            </div>
        </AuthSplitLayout>
    );
}
