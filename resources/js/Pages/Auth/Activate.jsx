import React, { useState } from 'react';
import { Head, useForm } from '@inertiajs/react';
import AuthSplitLayout from '@/Layouts/AuthSplitLayout';

export default function Activate({ machine_id, product_name = 'Inertia POS Standalone', status }) {
    const [copied, setCopied] = useState(false);
    const { data, setData, post, processing, errors, clearErrors } = useForm({
        license_key: '',
    });

    const handleCopy = () => {
        if (!machine_id) return;
        navigator.clipboard.writeText(machine_id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
        });
    };

    const submit = (e) => {
        e.preventDefault();
        clearErrors();
        post(route('activate.store'), {
            preserveScroll: true,
        });
    };

    return (
        <AuthSplitLayout>
            <Head title="License Activation" />

            {/* Header */}
            <div className="space-y-2 text-center sm:text-left">
                <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-[#1B3B6A] bg-blue-50 border border-blue-200">
                    Step 1 · Software Activation
                </div>
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">
                    {product_name}
                </h1>
                <p className="text-sm font-semibold text-gray-500">
                    Activate your offline machine license to proceed with store setup.
                </p>
            </div>

            {status && (
                <div className="p-3.5 text-sm font-bold text-emerald-800 bg-emerald-50 border border-emerald-200">
                    {status}
                </div>
            )}

            {/* Machine ID Box */}
            <div className="p-4 bg-gray-50 border border-gray-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        This Device's Machine ID
                    </span>
                    <button
                        type="button"
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold text-[#1B3B6A] hover:bg-blue-100/60 transition-colors border border-blue-200 bg-white"
                        title="Copy Machine ID"
                    >
                        {copied ? (
                            <>
                                <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                                </svg>
                                <span className="text-emerald-700">Copied!</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                                <span>Copy ID</span>
                            </>
                        )}
                    </button>
                </div>
                <div className="font-mono text-base sm:text-lg font-black tracking-wider text-gray-900 bg-white p-2.5 border border-gray-200 select-all break-all">
                    {machine_id || 'RESOLVING...'}
                </div>
                <p className="text-[11px] text-gray-500 font-medium">
                    Provide this Machine ID to your administrator to issue your offline license.
                </p>
            </div>

            {/* Activation Form */}
            <form onSubmit={submit} className="space-y-5">
                <div>
                    <label htmlFor="license_key" className="block text-[10px] font-black uppercase tracking-widest text-gray-600 mb-1.5">
                        License Key
                    </label>
                    <textarea
                        id="license_key"
                        rows={4}
                        value={data.license_key}
                        onChange={(e) => setData('license_key', e.target.value)}
                        placeholder="Paste your signed offline license key here..."
                        disabled={processing}
                        className={`block w-full p-3 font-mono text-xs text-gray-900 bg-gray-50 border rounded-none shadow-sm focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] transition-all ${
                            errors.license_key ? 'border-red-400 bg-red-50/30' : 'border-gray-200'
                        }`}
                    />
                    {errors.license_key && (
                        <p className="mt-1.5 text-xs font-bold text-red-600">
                            {errors.license_key}
                        </p>
                    )}
                </div>

                <button
                    type="submit"
                    disabled={processing || !data.license_key.trim()}
                    className="w-full py-3.5 px-4 bg-[#1B3B6A] hover:bg-[#142E54] disabled:opacity-50 text-white font-bold text-sm tracking-wide rounded-none transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                    {processing ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>Verifying License...</span>
                        </>
                    ) : (
                        <span>Activate POS</span>
                    )}
                </button>
            </form>
        </AuthSplitLayout>
    );
}
