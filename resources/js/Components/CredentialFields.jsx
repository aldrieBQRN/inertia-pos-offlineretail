import React, { useState } from 'react';

export const AUTH_TYPES = [
    { id: 'pin4', label: '4-digit PIN', hint: 'Fastest unlock at the counter' },
    { id: 'pin6', label: '6-digit PIN', hint: 'Quick unlock, harder to guess' },
    { id: 'password', label: 'Password', hint: '12+ characters, upper & lower case, a number and a symbol' },
];

export const isPinType = (type) => type === 'pin4' || type === 'pin6';
export const pinLength = (type) => (type === 'pin6' ? 6 : 4);

/**
 * Client-side mirror of the server's credential rules (App\Support\AdminCredential).
 * Returns { field: message } for anything wrong, or {} when valid.
 */
export function checkCredential(authType, credential, confirmation) {
    const errors = {};
    if (isPinType(authType)) {
        const len = pinLength(authType);
        if (!new RegExp(`^\\d{${len}}$`).test(credential)) {
            errors.credential = `The PIN must be exactly ${len} digits.`;
        } else if (new Set(credential).size === 1) {
            errors.credential = 'The PIN cannot use the same digit repeatedly.';
        } else if ('01234567890'.includes(credential) || '09876543210'.includes(credential)) {
            errors.credential = 'The PIN cannot be a simple sequence like 1234.';
        }
    } else if (
        credential.length < 12
        || !/[a-z]/.test(credential)
        || !/[A-Z]/.test(credential)
        || !/\d/.test(credential)
        || !/[^A-Za-z0-9]/.test(credential)
    ) {
        errors.credential = 'Use at least 12 characters with upper and lower case letters, a number and a symbol.';
    }

    if (!errors.credential && credential !== confirmation) {
        errors.credential_confirmation = `The ${isPinType(authType) ? 'PIN' : 'password'} confirmation does not match.`;
    }

    return errors;
}

/**
 * Sign-in method picker plus credential + confirmation inputs.
 * Shared by First-Time Setup and offline account recovery.
 */
export default function CredentialFields({ authType, credential, confirmation, onChange, errors = {}, labelClasses, inputClasses, errorClasses }) {
    const [show, setShow] = useState(false);
    const pinMode = isPinType(authType);
    const noun = pinMode ? 'PIN' : 'Password';

    const sanitize = (value) => (pinMode ? value.replace(/\D/g, '').slice(0, pinLength(authType)) : value);

    return (
        <div className="space-y-5">
            <div>
                <span className={labelClasses}>Sign-in Method</span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Sign-in method">
                    {AUTH_TYPES.map((type) => (
                        <button
                            key={type.id}
                            type="button"
                            onClick={() => onChange({ auth_type: type.id, credential: '', credential_confirmation: '' })}
                            aria-pressed={authType === type.id}
                            className={`px-2 py-2.5 rounded-none border text-xs font-bold transition-colors cursor-pointer ${authType === type.id
                                ? 'border-[#1B3B6A] bg-[#EFF4F9] text-[#1B3B6A]'
                                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                            {type.label}
                        </button>
                    ))}
                </div>
                <p className="text-[11px] text-gray-500 mt-1.5 ml-1 font-medium">
                    {AUTH_TYPES.find((t) => t.id === authType)?.hint}
                </p>
                {errors.auth_type && <p className={errorClasses}>{errors.auth_type}</p>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className={labelClasses} htmlFor="credential">{noun}</label>
                    <input
                        id="credential"
                        type={show ? 'text' : 'password'}
                        inputMode={pinMode ? 'numeric' : undefined}
                        maxLength={pinMode ? pinLength(authType) : 128}
                        value={credential}
                        onChange={(e) => onChange({ credential: sanitize(e.target.value) })}
                        className={`${inputClasses} ${pinMode ? 'tracking-[0.5em] text-center' : ''}`}
                        placeholder={pinMode ? '•'.repeat(pinLength(authType)) : 'Create a password'}
                        autoComplete="new-password"
                    />
                </div>
                <div>
                    <label className={labelClasses} htmlFor="credential_confirmation">Confirm {noun}</label>
                    <input
                        id="credential_confirmation"
                        type={show ? 'text' : 'password'}
                        inputMode={pinMode ? 'numeric' : undefined}
                        maxLength={pinMode ? pinLength(authType) : 128}
                        value={confirmation}
                        onChange={(e) => onChange({ credential_confirmation: sanitize(e.target.value) })}
                        className={`${inputClasses} ${pinMode ? 'tracking-[0.5em] text-center' : ''}`}
                        placeholder={pinMode ? '•'.repeat(pinLength(authType)) : 'Repeat the password'}
                        autoComplete="new-password"
                    />
                </div>
            </div>
            {errors.credential && <p className={errorClasses} role="alert">{errors.credential}</p>}
            {errors.credential_confirmation && <p className={errorClasses} role="alert">{errors.credential_confirmation}</p>}

            <label className="flex items-center gap-2 text-xs font-bold text-gray-600 cursor-pointer select-none ml-1">
                <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="rounded-none border-gray-300 text-[#1B3B6A] focus:ring-[#1B3B6A]" />
                Show {noun.toLowerCase()}
            </label>
        </div>
    );
}
