import React, { useEffect, useRef, useState } from 'react';
import { Head, useForm } from '@inertiajs/react';
import axios from 'axios';
import AuthSplitLayout from '@/Layouts/AuthSplitLayout';
import CredentialFields, { checkCredential, isPinType } from '@/Components/CredentialFields';

const STEPS = [
    { title: 'Store Details', description: 'How your store appears on screens and receipts.' },
    { title: 'Admin Account', description: 'Your details as the owner and only user of this POS.' },
    { title: 'Sign-in Method', description: 'How you will unlock the POS each time you open it.' },
    { title: 'Account Recovery', description: 'Three questions that let you reset your sign-in if you forget it. Answers are not case-sensitive.' },
];

/** Which form fields belong to each step (used to jump back to a step with server errors). */
const STEP_FIELDS = [
    ['store_name', 'store_address', 'store_phone', 'store_logo'],
    ['admin_name', 'phone_number', 'address', 'city', 'province', 'country'],
    ['auth_type', 'credential', 'credential_confirmation'],
    ['recovery'],
];

const CUSTOM = 'custom';
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

const normalize = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const questionText = (entry) => (entry.question === CUSTOM ? entry.custom_question.trim() : entry.question);

const stepOfField = (field) => STEP_FIELDS.findIndex((fields) => fields.some((f) => field === f || field.startsWith(`${f}.`)));

/** Flattens a Laravel 422 response ({ errors: { field: [msg] } }) to { field: msg }. */
const flattenErrors = (errors = {}) => Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));

/**
 * First-Time Setup wizard
 * Store Details → Admin Account → Sign-in Method → Account Recovery.
 * Each step is checked before moving on; everything is saved only when setup completes.
 */
export default function FirstTimeSetup({ recovery_questions = [] }) {
    const [step, setStep] = useState(0);
    const [checking, setChecking] = useState(false);
    const [logoPreview, setLogoPreview] = useState(null);
    const logoInput = useRef(null);
    const headingRef = useRef(null);

    const { data, setData, post, processing, errors, setError, clearErrors } = useForm({
        store_name: '',
        store_address: '',
        store_phone: '',
        store_logo: null,
        admin_name: '',
        phone_number: '',
        address: '',
        city: '',
        province: '',
        country: '',
        auth_type: 'pin4',
        credential: '',
        credential_confirmation: '',
        recovery: [0, 1, 2].map(() => ({ question: '', custom_question: '', answer: '' })),
    });

    // Release the preview object URL when it changes / on unmount
    useEffect(() => () => logoPreview && URL.revokeObjectURL(logoPreview), [logoPreview]);

    useEffect(() => {
        headingRef.current?.focus();
    }, [step]);

    const busy = checking || processing;
    const isLast = step === STEPS.length - 1;

    /* ---------------- Client-side checks (the server validates again) ---------------- */

    const clientErrors = (index) => {
        const e = {};
        if (index === 0 && !data.store_name.trim()) e.store_name = 'Enter the store name.';
        if (index === 1 && !data.admin_name.trim()) e.admin_name = 'Enter your full name.';
        if (index === 2) Object.assign(e, checkCredential(data.auth_type, data.credential, data.credential_confirmation));
        if (index === 3) {
            const seen = [];
            data.recovery.forEach((entry, i) => {
                const text = questionText(entry);
                if (!entry.question) e[`recovery.${i}.question`] = 'Choose a question.';
                else if (entry.question === CUSTOM && text.length < 10) e[`recovery.${i}.custom_question`] = 'Write a question of at least 10 characters.';
                else if (seen.includes(normalize(text))) e[`recovery.${i}.question`] = 'Choose three different questions.';
                seen.push(normalize(text));
                if (normalize(entry.answer).length < 2) e[`recovery.${i}.answer`] = 'Each answer must be at least 2 characters.';
            });
        }
        return e;
    };

    const stepPayload = (index) => {
        if (index === 0) {
            const form = new FormData();
            form.append('store_name', data.store_name);
            form.append('store_address', data.store_address);
            form.append('store_phone', data.store_phone);
            if (data.store_logo) form.append('store_logo', data.store_logo);
            return form;
        }
        if (index === 1) {
            const { admin_name, phone_number, address, city, province, country } = data;
            return { admin_name, phone_number, address, city, province, country };
        }
        if (index === 2) {
            const { auth_type, credential, credential_confirmation } = data;
            return { auth_type, credential, credential_confirmation };
        }
        return { recovery: data.recovery };
    };

    const showErrors = (e) => {
        clearErrors();
        setError(e);
    };

    const goNext = async (event) => {
        event?.preventDefault();
        if (busy) return;

        const local = clientErrors(step);
        if (Object.keys(local).length) {
            showErrors(local);
            return;
        }

        if (isLast) {
            complete();
            return;
        }

        setChecking(true);
        try {
            await axios.post(route('setup.validate', step + 1), stepPayload(step));
            clearErrors();
            setStep(step + 1);
        } catch (err) {
            if (err.response?.status === 422) {
                showErrors(flattenErrors(err.response.data.errors));
            } else {
                showErrors({ [STEP_FIELDS[step][0]]: 'Something went wrong. Please try again.' });
            }
        } finally {
            setChecking(false);
        }
    };

    const goBack = () => {
        clearErrors();
        setStep(Math.max(0, step - 1));
    };

    const complete = () => {
        post(route('setup.store'), {
            forceFormData: true,
            onError: (serverErrors) => {
                // Jump to the earliest step that has a problem
                const steps = Object.keys(serverErrors).map(stepOfField).filter((i) => i >= 0);
                if (steps.length) setStep(Math.min(...steps));
            },
        });
    };

    /* ---------------- Store logo ---------------- */

    const pickLogo = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        if (!LOGO_TYPES.includes(file.type)) {
            showErrors({ store_logo: 'The store logo must be a PNG, JPG or WEBP image.' });
            return;
        }
        if (file.size > LOGO_MAX_BYTES) {
            showErrors({ store_logo: 'The store logo must not be larger than 2 MB.' });
            return;
        }

        clearErrors('store_logo');
        setData('store_logo', file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const removeLogo = () => {
        setData('store_logo', null);
        setLogoPreview(null);
        clearErrors('store_logo');
    };

    /* ---------------- Recovery helpers ---------------- */

    const updateRecovery = (index, patch) => {
        setData('recovery', data.recovery.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
        clearErrors(`recovery.${index}.question`, `recovery.${index}.custom_question`, `recovery.${index}.answer`);
    };

    /* ---------------- Styles ---------------- */

    const inputClasses = "appearance-none block w-full px-4 py-3 border border-gray-200 rounded-none shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] sm:text-sm font-bold text-gray-900 bg-gray-50/50 transition-colors";
    const labelClasses = "block text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1 mb-1.5";
    const errorClasses = "mt-1.5 ml-1 text-[10px] font-bold text-red-500 uppercase tracking-wide";
    const optional = <span className="normal-case font-medium text-gray-400">(Optional)</span>;

    const field = (name, label, props = {}, isOptional = true) => (
        <div>
            <label className={labelClasses} htmlFor={name}>{label} {isOptional && optional}</label>
            <input
                id={name}
                type="text"
                value={data[name]}
                onChange={(e) => {
                    setData(name, e.target.value);
                    clearErrors(name);
                }}
                className={inputClasses}
                {...props}
            />
            {errors[name] && <p className={errorClasses} role="alert">{errors[name]}</p>}
        </div>
    );

    return (
        <AuthSplitLayout storeName={data.store_name} wide>
            <Head title="First-Time Setup" />

            {/* Progress indicator */}
            <nav aria-label="Setup progress">
                <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 sm:hidden">
                    Step {step + 1} of {STEPS.length}
                </p>
                <ol className="hidden sm:flex items-center gap-2">
                    {STEPS.map((s, i) => {
                        const state = i < step ? 'done' : i === step ? 'current' : 'todo';
                        return (
                            <li key={s.title} className="flex items-center gap-2 flex-1 min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
                                <span className={`w-6 h-6 shrink-0 flex items-center justify-center text-[11px] font-black border ${state === 'todo'
                                    ? 'border-gray-300 text-gray-400 bg-white'
                                    : 'border-[#1B3B6A] bg-[#1B3B6A] text-white'}`}>
                                    {state === 'done' ? (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    ) : i + 1}
                                </span>
                                <span className={`text-[11px] font-bold truncate ${state === 'current' ? 'text-gray-900' : 'text-gray-400'}`}>{s.title}</span>
                                {i < STEPS.length - 1 && <span className="h-px flex-1 min-w-3 bg-gray-200" aria-hidden="true" />}
                            </li>
                        );
                    })}
                </ol>
            </nav>

            {/* Step heading */}
            <div>
                <h2 ref={headingRef} tabIndex={-1} className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight outline-none">
                    {STEPS[step].title}
                </h2>
                <p className="mt-1.5 text-sm font-semibold text-gray-500">{STEPS[step].description}</p>
            </div>

            <form onSubmit={goNext} className="space-y-6" noValidate>
                {/* STEP 1: Store Details */}
                {step === 0 && (
                    <div className="space-y-4">
                        {field('store_name', 'Store Name', { placeholder: 'e.g. Corner Mini Mart', maxLength: 255, autoFocus: true }, false)}

                        <div>
                            <span className={labelClasses}>Store Logo {optional}</span>
                            <div className="flex items-center gap-4">
                                <div className="w-20 h-20 shrink-0 border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                                    {logoPreview ? (
                                        <img src={logoPreview} alt="Store logo preview" className="w-full h-full object-contain" />
                                    ) : (
                                        <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
                                        </svg>
                                    )}
                                </div>
                                <div className="space-y-2">
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={() => logoInput.current?.click()}
                                            className="px-3.5 py-2 border border-gray-200 bg-white text-xs font-bold text-gray-700 hover:bg-gray-50 cursor-pointer"
                                        >
                                            {logoPreview ? 'Replace' : 'Choose Logo'}
                                        </button>
                                        {logoPreview && (
                                            <button
                                                type="button"
                                                onClick={removeLogo}
                                                className="px-3.5 py-2 border border-gray-200 bg-white text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer"
                                            >
                                                Remove
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-500 font-medium">PNG, JPG or WEBP, up to 2 MB. Saved on this device.</p>
                                </div>
                                <input
                                    ref={logoInput}
                                    id="store_logo"
                                    type="file"
                                    accept="image/png,image/jpeg,image/webp"
                                    onChange={pickLogo}
                                    className="hidden"
                                />
                            </div>
                            {errors.store_logo && <p className={errorClasses} role="alert">{errors.store_logo}</p>}
                        </div>

                        {field('store_address', 'Address', { placeholder: 'e.g. 12 Rizal St., Quezon City', maxLength: 500 })}
                        {field('store_phone', 'Phone', { placeholder: 'e.g. 0917 000 0000', maxLength: 50 })}
                        <p className="text-[11px] text-gray-500 font-medium ml-1">The store name, address and phone are printed on receipts.</p>
                    </div>
                )}

                {/* STEP 2: Admin Account */}
                {step === 1 && (
                    <div className="space-y-4">
                        {field('admin_name', 'Full Name', { placeholder: 'e.g. Maria Santos', maxLength: 255, autoFocus: true, autoComplete: 'name' }, false)}
                        {field('phone_number', 'Phone Number', { placeholder: 'e.g. 0917 000 0000', maxLength: 20, autoComplete: 'tel' })}
                        {field('address', 'Street Address', { placeholder: 'e.g. 123 Main St.', maxLength: 255 })}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {field('city', 'City', { placeholder: 'e.g. Makati', maxLength: 100 })}
                            {field('province', 'Province', { placeholder: 'e.g. Metro Manila', maxLength: 100 })}
                            {field('country', 'Country', { placeholder: 'e.g. Philippines', maxLength: 100 })}
                        </div>
                        <p className="text-[11px] text-gray-500 font-medium ml-1">You can change these later under Profile.</p>
                    </div>
                )}

                {/* STEP 3: Sign-in Method */}
                {step === 2 && (
                    <CredentialFields
                        authType={data.auth_type}
                        credential={data.credential}
                        confirmation={data.credential_confirmation}
                        onChange={(patch) => {
                            setData((prev) => ({ ...prev, ...patch }));
                            clearErrors('auth_type', 'credential', 'credential_confirmation');
                        }}
                        errors={errors}
                        labelClasses={labelClasses}
                        inputClasses={inputClasses}
                        errorClasses={errorClasses}
                    />
                )}

                {/* STEP 4: Account Recovery */}
                {step === 3 && (
                    <div className="space-y-5">
                        {data.recovery.map((entry, i) => {
                            const takenElsewhere = data.recovery.filter((_, j) => j !== i).map((e) => e.question);
                            return (
                                <fieldset key={i} className="space-y-3 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                                    <legend className="sr-only">Security question {i + 1}</legend>
                                    <div>
                                        <label className={labelClasses} htmlFor={`recovery_question_${i}`}>Question {i + 1}</label>
                                        <select
                                            id={`recovery_question_${i}`}
                                            value={entry.question}
                                            onChange={(e) => updateRecovery(i, { question: e.target.value })}
                                            className={`${inputClasses} pr-10 cursor-pointer`}
                                        >
                                            <option value="">Select a question…</option>
                                            {recovery_questions.map((q) => (
                                                <option key={q} value={q} disabled={takenElsewhere.includes(q)}>{q}</option>
                                            ))}
                                            <option value={CUSTOM}>Write my own question…</option>
                                        </select>
                                        {errors[`recovery.${i}.question`] && <p className={errorClasses} role="alert">{errors[`recovery.${i}.question`]}</p>}
                                    </div>

                                    {entry.question === CUSTOM && (
                                        <div>
                                            <label className={labelClasses} htmlFor={`recovery_custom_${i}`}>Your Question</label>
                                            <input
                                                id={`recovery_custom_${i}`}
                                                type="text"
                                                maxLength={150}
                                                value={entry.custom_question}
                                                onChange={(e) => updateRecovery(i, { custom_question: e.target.value })}
                                                className={inputClasses}
                                                placeholder="e.g. What was the name of my first bike?"
                                            />
                                            {errors[`recovery.${i}.custom_question`] && <p className={errorClasses} role="alert">{errors[`recovery.${i}.custom_question`]}</p>}
                                        </div>
                                    )}

                                    <div>
                                        <label className={labelClasses} htmlFor={`recovery_answer_${i}`}>Answer {i + 1}</label>
                                        <input
                                            id={`recovery_answer_${i}`}
                                            type="text"
                                            maxLength={100}
                                            autoComplete="off"
                                            value={entry.answer}
                                            onChange={(e) => updateRecovery(i, { answer: e.target.value })}
                                            className={inputClasses}
                                        />
                                        {errors[`recovery.${i}.answer`] && <p className={errorClasses} role="alert">{errors[`recovery.${i}.answer`]}</p>}
                                    </div>
                                </fieldset>
                            );
                        })}
                        {errors.recovery && <p className={errorClasses} role="alert">{errors.recovery}</p>}
                        <p className="text-[11px] text-gray-500 font-medium ml-1">
                            Pick answers you will remember. Don't use ID numbers, bank details or passwords. Answers are stored as a one-way hash on this device and are never shown again.
                        </p>
                    </div>
                )}

                {/* Navigation */}
                <div className="pt-4 border-t border-gray-100 flex items-center gap-3">
                    {step > 0 && (
                        <button
                            type="button"
                            onClick={goBack}
                            disabled={busy}
                            className="px-5 py-4 border border-gray-200 bg-white text-gray-700 font-black text-[12px] uppercase tracking-widest rounded-none hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
                        >
                            Back
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={busy}
                        className="flex-1 py-4 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-black text-[12px] uppercase tracking-widest rounded-none transition-colors flex justify-center items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {busy && (
                            <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        )}
                        {isLast ? (processing ? 'Completing Setup…' : 'Complete Setup') : (checking ? 'Checking…' : 'Continue')}
                    </button>
                </div>
                {isLast && (
                    <p className="text-[11px] text-gray-500 font-medium text-center">
                        After setup you'll unlock the POS with your new {isPinType(data.auth_type) ? 'PIN' : 'password'}.
                    </p>
                )}
            </form>
        </AuthSplitLayout>
    );
}
