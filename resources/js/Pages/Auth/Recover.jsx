import React from 'react';
import { Head, Link, useForm } from '@inertiajs/react';
import AuthSplitLayout from '@/Layouts/AuthSplitLayout';
import CredentialFields, { checkCredential, isPinType } from '@/Components/CredentialFields';

const inputClasses = "appearance-none block w-full px-4 py-3 border border-gray-200 rounded-none shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] sm:text-sm font-bold text-gray-900 bg-gray-50/50 transition-colors";
const labelClasses = "block text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1 mb-1.5";
const errorClasses = "mt-1.5 ml-1 text-[10px] font-bold text-red-500 uppercase tracking-wide";
const primaryButton = "w-full py-4 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-black text-[12px] uppercase tracking-widest rounded-none transition-colors flex justify-center items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

function BackToLogin() {
    return (
        <div className="text-center">
            <Link href={route('login')} className="text-sm font-bold text-[#1B3B6A] hover:text-[#142E54] hover:underline">
                Back to unlock screen
            </Link>
        </div>
    );
}

function Heading({ title, description }) {
    return (
        <div>
            <div className="inline-flex items-center px-2.5 py-1 rounded-none bg-[#EFF4F9] border border-[#CBD7E6] text-[#1B3B6A] text-[10px] font-black uppercase tracking-widest">
                Account Recovery
            </div>
            <h2 className="mt-3 text-2xl sm:text-3xl font-black text-gray-900 tracking-tight">{title}</h2>
            <p className="mt-1.5 text-sm font-semibold text-gray-500">{description}</p>
        </div>
    );
}

function AnswerQuestions({ questions, noun }) {
    const { data, setData, post, processing, errors, clearErrors } = useForm({
        answers: questions.map(() => ''),
    });

    const submit = (e) => {
        e.preventDefault();
        post(route('recover.verify'), {
            preserveScroll: true,
            onError: () => setData('answers', questions.map(() => '')),
        });
    };

    const fieldError = Object.entries(errors).find(([k]) => k.startsWith('answers.'))?.[1];

    return (
        <>
            <Heading title={`Forgot your ${noun}?`} description="Answer your three security questions to set a new sign-in method. Answers are not case-sensitive." />
            <form onSubmit={submit} className="space-y-5" noValidate>
                {questions.map((question, i) => (
                    <div key={i}>
                        <label className={labelClasses} htmlFor={`answer_${i}`}>{question}</label>
                        <input
                            id={`answer_${i}`}
                            type="text"
                            autoComplete="off"
                            maxLength={100}
                            autoFocus={i === 0}
                            value={data.answers[i]}
                            onChange={(e) => {
                                clearErrors();
                                setData('answers', data.answers.map((a, j) => (j === i ? e.target.value : a)));
                            }}
                            className={inputClasses}
                        />
                    </div>
                ))}
                {(errors.answers || fieldError) && (
                    <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 p-3" role="alert">{errors.answers || fieldError}</p>
                )}
                <div className="pt-4 border-t border-gray-100">
                    <button type="submit" disabled={processing || data.answers.some((a) => !a.trim())} className={primaryButton}>
                        {processing ? 'Verifying…' : 'Verify Answers'}
                    </button>
                </div>
            </form>
            <BackToLogin />
        </>
    );
}

function SetNewCredential({ currentAuthType }) {
    const { data, setData, post, processing, errors, setError, clearErrors } = useForm({
        auth_type: currentAuthType,
        credential: '',
        credential_confirmation: '',
    });

    const submit = (e) => {
        e.preventDefault();
        const local = checkCredential(data.auth_type, data.credential, data.credential_confirmation);
        if (Object.keys(local).length) {
            clearErrors();
            setError(local);
            return;
        }
        post(route('recover.reset'), {
            onError: () => setData((prev) => ({ ...prev, credential: '', credential_confirmation: '' })),
        });
    };

    return (
        <>
            <Heading title="Set a new sign-in method" description="Your answers were verified. Choose a new PIN or password; the old one will stop working." />
            <form onSubmit={submit} className="space-y-6" noValidate>
                <CredentialFields
                    authType={data.auth_type}
                    credential={data.credential}
                    confirmation={data.credential_confirmation}
                    onChange={(patch) => {
                        setData((prev) => ({ ...prev, ...patch }));
                        clearErrors();
                    }}
                    errors={errors}
                    labelClasses={labelClasses}
                    inputClasses={inputClasses}
                    errorClasses={errorClasses}
                />
                {errors.answers && <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-200 p-3" role="alert">{errors.answers}</p>}
                <div className="pt-4 border-t border-gray-100">
                    <button type="submit" disabled={processing} className={primaryButton}>
                        {processing ? 'Saving…' : 'Save New Sign-in'}
                    </button>
                </div>
            </form>
            <BackToLogin />
        </>
    );
}

/**
 * Offline account recovery: security questions → new PIN/password → done.
 */
export default function Recover({ stage, questions = [], auth_type = 'password', store_name, recovered_label }) {
    const noun = isPinType(auth_type) ? 'PIN' : 'password';

    return (
        <AuthSplitLayout storeName={store_name}>
            <Head title="Account Recovery" />

            {stage === 'questions' && <AnswerQuestions questions={questions} noun={noun} />}

            {stage === 'reset' && <SetNewCredential currentAuthType={auth_type} />}

            {stage === 'done' && (
                <>
                    <Heading title="Sign-in reset" description={`Your new ${recovered_label || noun} is ready. Use it to unlock the POS.`} />
                    <Link href={route('login')} className={primaryButton}>Return to Unlock Screen</Link>
                </>
            )}

            {stage === 'unavailable' && (
                <>
                    <Heading title="Recovery is not set up" description="This POS has no security questions configured." />
                    <p className="text-sm text-gray-600 leading-relaxed">
                        To reset the sign-in method, run this command in the POS folder on this computer:
                    </p>
                    <code className="block font-mono text-sm bg-gray-50 border border-gray-200 p-3 text-gray-800">php artisan pos:reset-credential</code>
                    <BackToLogin />
                </>
            )}
        </AuthSplitLayout>
    );
}
