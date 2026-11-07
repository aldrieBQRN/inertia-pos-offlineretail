import { useRef, useState, useEffect } from 'react';
import { useForm } from '@inertiajs/react';
import Swal from 'sweetalert2';

const AUTH_TYPES = [
    { id: 'pin4', label: '4-digit PIN', hint: 'Quick unlock with 4 digits' },
    { id: 'pin6', label: '6-digit PIN', hint: 'Quick unlock with 6 digits' },
    { id: 'password', label: 'Password', hint: '12+ characters with upper & lower case, a number and a symbol' },
];

const isPin = (type) => type === 'pin4' || type === 'pin6';
const pinLength = (type) => (type === 'pin6' ? 6 : 4);

/**
 * Change the Admin sign-in credential (4-digit PIN, 6-digit PIN or strong password).
 */
export default function UpdatePasswordForm({ isOpen, onClose, currentAuthType = 'password' }) {
    const passwordInput = useRef();
    const currentPasswordInput = useRef();

    // Password visibility states
    const [showCurrentPassword, setShowCurrentPassword] = useState(false);
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const { data, setData, errors, put, reset, clearErrors, processing } = useForm({
        current_credential: '',
        auth_type: currentAuthType,
        credential: '',
        credential_confirmation: '',
    });

    // Reset form and errors whenever the modal is opened or closed
    useEffect(() => {
        if (isOpen) {
            reset();
            setData('auth_type', currentAuthType);
            clearErrors();
            setShowCurrentPassword(false);
            setShowNewPassword(false);
            setShowConfirmPassword(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const newIsPin = isPin(data.auth_type);
    const currentIsPin = isPin(currentAuthType);

    const sanitize = (value, type) => (isPin(type) ? value.replace(/\D/g, '').slice(0, pinLength(type)) : value);

    const selectType = (type) => {
        setData((prev) => ({ ...prev, auth_type: type, credential: '', credential_confirmation: '' }));
        clearErrors('credential', 'credential_confirmation');
    };

    const updatePassword = (e) => {
        e.preventDefault();

        Swal.fire({
            title: 'Securing Account...',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        put(route('credential.update'), {
            preserveScroll: true,
            onSuccess: () => {
                onClose(); // Close modal on success
                reset();
                Swal.fire({
                    icon: 'success',
                    title: 'Sign-in Updated!',
                    text: `You will now unlock the POS with your new ${AUTH_TYPES.find(t => t.id === data.auth_type)?.label.toLowerCase()}.`,
                    confirmButtonColor: '#1B3B6A'
                });
            },
            onError: (errors) => {
                Swal.close();
                if (errors.credential) {
                    setData((prev) => ({ ...prev, credential: '', credential_confirmation: '' }));
                    passwordInput.current?.focus();
                }
                if (errors.current_credential) {
                    setData('current_credential', '');
                    currentPasswordInput.current?.focus();
                }
            },
        });
    };

    // Reusable Toggle Component
    const EyeToggle = ({ isVisible, toggleVisibility }) => (
        <button
            type="button"
            onClick={toggleVisibility}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-700 transition-colors focus:outline-none"
            tabIndex="-1"
        >
            {isVisible ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0a10.05 10.05 0 015.148-1.414c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
            )}
        </button>
    );

    // Premium Input Component styling
    const inputClasses = "w-full border border-gray-200 bg-gray-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/20 focus:border-[#1B3B6A] focus:bg-white transition-all py-3 pl-4 pr-12 text-sm font-bold text-gray-900 shadow-2xs placeholder:text-gray-400 [&::-ms-reveal]:hidden";
    const labelClasses = "block text-[11px] font-black text-gray-600 uppercase tracking-wider mb-1.5 ml-0.5";
    const errorClasses = "text-rose-500 text-[10px] font-black mt-1.5 ml-1 uppercase tracking-wide";

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-none shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">

                {/* Standard App Modal Navy Header */}
                <div className="px-6 py-4 bg-[#1B3B6A] text-white flex justify-between items-center shrink-0 shadow-md">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center shrink-0 text-white">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-base tracking-tight text-white">Change PIN / Password</h3>
                            <p className="text-xs text-white/80 font-medium mt-0.5">Choose how the Admin unlocks this POS</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 w-8 h-8 rounded-none flex items-center justify-center transition-colors cursor-pointer"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable Form Body */}
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 custom-scrollbar relative">
                    <form id="password-update-form" onSubmit={updatePassword} className="space-y-4">

                        <div>
                            <label className={labelClasses}>Current {currentIsPin ? 'PIN' : 'Password'}</label>
                            <div className="relative">
                                <input
                                    ref={currentPasswordInput}
                                    value={data.current_credential}
                                    onChange={e => setData('current_credential', sanitize(e.target.value, currentAuthType))}
                                    type={showCurrentPassword ? "text" : "password"}
                                    inputMode={currentIsPin ? 'numeric' : undefined}
                                    autoComplete="current-password"
                                    className={inputClasses}
                                    placeholder={currentIsPin ? 'Enter current PIN' : 'Enter current password'}
                                    required
                                />
                                <EyeToggle isVisible={showCurrentPassword} toggleVisibility={() => setShowCurrentPassword(!showCurrentPassword)} />
                            </div>
                            {errors.current_credential && <p className={errorClasses}>{errors.current_credential}</p>}
                        </div>

                        <div>
                            <label className={labelClasses}>New Sign-in Method</label>
                            <div className="grid grid-cols-3 gap-2">
                                {AUTH_TYPES.map((type) => (
                                    <button
                                        key={type.id}
                                        type="button"
                                        onClick={() => selectType(type.id)}
                                        className={`px-2 py-2.5 rounded-none border text-xs font-bold transition-all cursor-pointer ${data.auth_type === type.id
                                            ? 'border-[#1B3B6A] bg-[#EFF4F9] text-[#1B3B6A]'
                                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                                    >
                                        {type.label}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1.5 ml-0.5 font-medium">
                                {AUTH_TYPES.find(t => t.id === data.auth_type)?.hint}
                            </p>
                            {errors.auth_type && <p className={errorClasses}>{errors.auth_type}</p>}
                        </div>

                        <div>
                            <label className={labelClasses}>New {newIsPin ? 'PIN' : 'Password'}</label>
                            <div className="relative">
                                <input
                                    ref={passwordInput}
                                    value={data.credential}
                                    onChange={e => setData('credential', sanitize(e.target.value, data.auth_type))}
                                    type={showNewPassword ? "text" : "password"}
                                    inputMode={newIsPin ? 'numeric' : undefined}
                                    maxLength={newIsPin ? pinLength(data.auth_type) : 128}
                                    autoComplete="new-password"
                                    className={inputClasses}
                                    placeholder={newIsPin ? `Enter ${pinLength(data.auth_type)} digits` : 'Enter new password'}
                                    required
                                />
                                <EyeToggle isVisible={showNewPassword} toggleVisibility={() => setShowNewPassword(!showNewPassword)} />
                            </div>
                            {errors.credential && <p className={errorClasses}>{errors.credential}</p>}
                        </div>

                        <div>
                            <label className={labelClasses}>Confirm New {newIsPin ? 'PIN' : 'Password'}</label>
                            <div className="relative">
                                <input
                                    value={data.credential_confirmation}
                                    onChange={e => setData('credential_confirmation', sanitize(e.target.value, data.auth_type))}
                                    type={showConfirmPassword ? "text" : "password"}
                                    inputMode={newIsPin ? 'numeric' : undefined}
                                    maxLength={newIsPin ? pinLength(data.auth_type) : 128}
                                    autoComplete="new-password"
                                    className={inputClasses}
                                    placeholder={newIsPin ? 'Re-enter PIN' : 'Confirm new password'}
                                    required
                                />
                                <EyeToggle isVisible={showConfirmPassword} toggleVisibility={() => setShowConfirmPassword(!showConfirmPassword)} />
                            </div>
                            {errors.credential_confirmation && <p className={errorClasses}>{errors.credential_confirmation}</p>}
                        </div>
                    </form>
                </div>

                {/* Standard App Modal Footer */}
                <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2.5 rounded-none border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-100 active:scale-95 transition-all cursor-pointer"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        form="password-update-form"
                        disabled={processing}
                        className="px-5 py-2.5 rounded-none bg-[#1B3B6A] hover:bg-[#142E54] text-white text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                    >
                        {processing ? (
                            <>
                                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span>Updating...</span>
                            </>
                        ) : (
                            <span>Save Sign-in</span>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
}