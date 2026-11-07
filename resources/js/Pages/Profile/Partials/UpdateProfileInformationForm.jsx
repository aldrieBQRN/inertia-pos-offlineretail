import { useRef, useState, useEffect } from 'react';
import { useForm } from '@inertiajs/react';
import Swal from 'sweetalert2';

export default function UpdateProfileInformationForm({ isOpen, onClose, user }) {
    const fileInput = useRef();
    const [avatarPreview, setAvatarPreview] = useState(user.avatar_path ? `/storage/${user.avatar_path}` : null);

    // Simulate loading for skeleton animation on open
    const [isLoading, setIsLoading] = useState(true);
    const { data, setData, post, errors, processing, reset, clearErrors } = useForm({
        name: user.name || '',
        phone_number: user.phone_number || '',
        address: user.address || '',
        city: user.city || '',
        province: user.province || '',
        country: user.country || '',
        avatar: null,
        _method: 'patch',
    });

    useEffect(() => {
        if (isOpen) {
            setIsLoading(true);
            reset();
            clearErrors();
            setAvatarPreview(user.avatar_path ? `/storage/${user.avatar_path}` : null);

            // Artificial delay to show skeleton
            const timer = setTimeout(() => setIsLoading(false), 400);
            return () => clearTimeout(timer);
        }
    }, [isOpen, user]);

    if (!isOpen) return null;

    const handleAvatarChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setData('avatar', file);
            setAvatarPreview(URL.createObjectURL(file));
        }
    };

    const submit = (e) => {
        e.preventDefault();
        clearErrors();
        patchProfile();
    };

    const patchProfile = () => {
        post(route('profile.update'), {
            forceFormData: true,
            onSuccess: () => {
                onClose();
                Swal.fire({
                    icon: 'success',
                    title: 'Profile Updated!',
                    text: 'Your account information has been saved.',
                    confirmButtonColor: '#1B3B6A'
                });
            },
            onError: () => {
                Swal.close();
            }
        });
    };

    const getInitials = (name) => name ? name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : '??';

    const inputClasses = "w-full border border-gray-200 bg-gray-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/20 focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-bold text-gray-900 shadow-2xs placeholder:text-gray-400";
    const labelClasses = "block text-[11px] font-black text-gray-600 uppercase tracking-wider mb-1.5 ml-0.5";
    const errorClasses = "text-rose-500 text-[10px] font-black mt-1.5 ml-1 uppercase tracking-wide";

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className={`bg-white rounded-none shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]`}>

                {/* Standard App Modal Navy Header */}
                <div className="px-6 py-4 bg-[#1B3B6A] text-white flex justify-between items-center shrink-0 shadow-md">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-none bg-white/10 flex items-center justify-center shrink-0 text-white">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                        </div>
                        <div>
                            <h3 className="font-black text-base tracking-tight text-white">
                                Edit Profile Details
                            </h3>
                            <p className="text-xs text-white/80 font-medium mt-0.5">
                                Update your name, photo and contact details
                            </p>
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

                    {/* SKELETON LOADING STATE */}
                    {isLoading ? (
                        <div className="space-y-6 animate-pulse">
                            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 pb-5 border-b border-gray-100">
                                <div className="w-20 h-20 rounded-none bg-gray-200 shrink-0"></div>
                                <div className="w-full text-center sm:text-left space-y-2">
                                    <div className="h-4 bg-gray-200 rounded-none w-28 mx-auto sm:mx-0"></div>
                                    <div className="h-3 bg-gray-200 rounded-none w-40 mx-auto sm:mx-0 mb-3"></div>
                                    <div className="h-9 bg-gray-200 rounded-none w-32 mx-auto sm:mx-0"></div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* ACTUAL FORM */
                        <form id="profile-form" onSubmit={submit} className="space-y-5 animate-in fade-in duration-300">

                            {/* Avatar Upload */}
                            <div className={`flex flex-col sm:flex-row items-center sm:items-start gap-5 pb-6 border-b border-gray-100`}>
                                <div
                                    onClick={() => fileInput.current.click()}
                                    className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-none ring-4 ring-[#EFF4F9] flex items-center justify-center overflow-hidden cursor-pointer group hover:ring-[#1B3B6A]/30 transition-all shadow-sm shrink-0"
                                >
                                    {avatarPreview ? (
                                        <img src={avatarPreview} alt="Preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full bg-gradient-to-tr from-[#1B3B6A] to-[#2C5E9E] flex items-center justify-center text-white font-black text-2xl">
                                            {getInitials(user.name)}
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-[#1B3B6A]/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="text-center sm:text-left">
                                    <h4 className="font-black text-gray-900 text-sm">Profile Avatar</h4>
                                    <p className="text-xs text-gray-500 mt-0.5 mb-2.5">JPG, PNG, or WEBP. Max size 2MB.</p>
                                    <button
                                        type="button"
                                        onClick={() => fileInput.current.click()}
                                        className="text-xs font-bold text-[#1B3B6A] bg-white border border-[#CBD7E6] hover:bg-[#EFF4F9] px-3.5 py-1.5 rounded-none transition-all shadow-2xs cursor-pointer active:scale-95"
                                    >
                                        Choose New Photo
                                    </button>
                                    <input type="file" ref={fileInput} onChange={handleAvatarChange} className="hidden" accept="image/jpeg, image/png, image/webp, image/jpg" />
                                    {errors.avatar && <p className={errorClasses}>{errors.avatar}</p>}
                                </div>
                            </div>

                            {/* Editable Grids */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">

                                    {/* Left Column: Personal */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                                            <svg className="w-4 h-4 text-[#1B3B6A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                            Personal Details
                                        </h4>
                                        <div>
                                            <label className={labelClasses}>Full Legal Name</label>
                                            <input type="text" value={data.name} onChange={e => setData('name', e.target.value)} required className={inputClasses} placeholder="e.g. Jane Doe" />
                                            {errors.name && <p className={errorClasses}>{errors.name}</p>}
                                        </div>
                                        <div>
                                            <label className={labelClasses}>Phone Number <span className="normal-case font-medium text-gray-400">(Optional)</span></label>
                                            <input type="text" value={data.phone_number} onChange={e => setData('phone_number', e.target.value)} className={inputClasses} placeholder="+1 (555) 000-0000" />
                                            {errors.phone_number && <p className={errorClasses}>{errors.phone_number}</p>}
                                        </div>
                                    </div>

                                    {/* Right Column: Location */}
                                    <div className="space-y-4">
                                        <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider flex items-center gap-2 border-b border-gray-100 pb-2">
                                            <svg className="w-4 h-4 text-[#1B3B6A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                            Location Details
                                        </h4>
                                        <div>
                                            <label className={labelClasses}>Street Address</label>
                                            <input type="text" value={data.address} onChange={e => setData('address', e.target.value)} className={inputClasses} placeholder="e.g. 123 Main St, Apt 4B" />
                                            {errors.address && <p className={errorClasses}>{errors.address}</p>}
                                        </div>

                                        {/* 2-Column inner grid for City/Municipality & Province */}
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className={labelClasses}>City / Municipality</label>
                                                <input type="text" value={data.city} onChange={e => setData('city', e.target.value)} className={inputClasses} placeholder="e.g. Makati" />
                                                {errors.city && <p className={errorClasses}>{errors.city}</p>}
                                            </div>
                                            <div>
                                                <label className={labelClasses}>Province</label>
                                                <input type="text" value={data.province} onChange={e => setData('province', e.target.value)} className={inputClasses} placeholder="e.g. Metro Manila" />
                                                {errors.province && <p className={errorClasses}>{errors.province}</p>}
                                            </div>
                                        </div>

                                        <div>
                                            <label className={labelClasses}>Country</label>
                                            <input type="text" value={data.country} onChange={e => setData('country', e.target.value)} className={inputClasses} placeholder="e.g. Philippines" />
                                            {errors.country && <p className={errorClasses}>{errors.country}</p>}
                                        </div>
                                    </div>
                                </div>
                        </form>
                    )}
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
                        form="profile-form"
                        disabled={processing || isLoading}
                        className="px-5 py-2.5 rounded-none bg-[#1B3B6A] hover:bg-[#142E54] text-white text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer flex items-center gap-2 disabled:opacity-50"
                    >
                        {processing ? (
                            <>
                                <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span>Saving...</span>
                            </>
                        ) : (
                            <span>Save Changes</span>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
}