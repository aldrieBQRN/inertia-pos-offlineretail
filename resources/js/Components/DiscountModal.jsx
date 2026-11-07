import React, { useState, useEffect, useRef } from 'react';
import useCartStore from '@/Stores/useCartStore';

const PRESETS = [
    {
        id: 'senior',
        fKey: 'F1',
        keyNum: '1',
        name: 'Senior Citizen',
        rate: 20,
        type: 'percentage',
        requiresId: true,
        badge: '20% OFF',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
        ),
        description: 'Statutory 20% + VAT Exemption'
    },
    {
        id: 'pwd',
        fKey: 'F2',
        keyNum: '2',
        name: 'PWD (Person with Disability)',
        rate: 20,
        type: 'percentage',
        requiresId: true,
        badge: '20% OFF',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
        ),
        description: 'Statutory 20% + VAT Exemption'
    },
    {
        id: 'loyalty_5',
        fKey: 'F3',
        keyNum: '3',
        name: 'Loyalty / Regular',
        rate: 5,
        type: 'percentage',
        requiresId: false,
        badge: '5% OFF',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            </svg>
        ),
        description: 'Repeat shopper loyalty discount'
    },
    {
        id: 'loyalty_10',
        fKey: 'F4',
        keyNum: '4',
        name: 'VIP / Special Promo',
        rate: 10,
        type: 'percentage',
        requiresId: false,
        badge: '10% OFF',
        icon: (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
        ),
        description: 'Special promo or VIP campaign'
    }
];

const CUSTOM_REASONS = [
    'Loyal Customer Goodwill',
    'Near Expiry / Clearance',
    'Damaged Packaging',
    'Store Owner Special Agreement',
    'Promotional Coupon / Voucher',
    'Price Match / Customer Satisfaction'
];

export default function DiscountModal({ onClose, showFKeys = true, enableShortcuts = true }) {
    const { discount, applyDiscount, removeDiscount, getComputations } = useCartStore();
    const { subtotal } = getComputations();

    const [selectedTab, setSelectedTab] = useState('presets'); // 'presets' | 'custom'
    const [selectedPresetId, setSelectedPresetId] = useState(discount?.type || 'senior');
    
    // Form inputs for Senior / PWD
    const [customerName, setCustomerName] = useState(discount?.customerName || '');
    const [customerIdNumber, setCustomerIdNumber] = useState(discount?.customerIdNumber || '');

    // Form inputs for Custom Discount
    const [customType, setCustomType] = useState('percentage'); // 'percentage' | 'fixed'
    const [customRate, setCustomRate] = useState(discount?.type === 'custom_percentage' ? (discount.rate || 10) : 10);
    const [customAmountPHP, setCustomAmountPHP] = useState(discount?.type === 'custom_fixed' ? ((discount.amount || 0) / 100) : 20);
    const [customReason, setCustomReason] = useState(discount?.reason || CUSTOM_REASONS[0]);
    const [customReasonOther, setCustomReasonOther] = useState('');

    const [errorMsg, setErrorMsg] = useState('');

    const nameInputRef = useRef(null);
    const idInputRef = useRef(null);
    const customValueInputRef = useRef(null);

    // Initial setup based on currently active discount
    useEffect(() => {
        if (discount?.type) {
            if (discount.type.startsWith('custom_')) {
                setSelectedTab('custom');
                setCustomType(discount.type === 'custom_fixed' ? 'fixed' : 'percentage');
                if (discount.type === 'custom_fixed') {
                    setCustomAmountPHP((discount.amount || 0) / 100);
                } else {
                    setCustomRate(discount.rate || 10);
                }
                setCustomReason(discount.reason || CUSTOM_REASONS[0]);
            } else {
                setSelectedTab('presets');
                setSelectedPresetId(discount.type);
                setCustomerName(discount.customerName || '');
                setCustomerIdNumber(discount.customerIdNumber || '');
            }
        }
    }, []);

    // Focus name input when a preset requiring ID is active
    useEffect(() => {
        const active = PRESETS.find(p => p.id === selectedPresetId);
        if (selectedTab === 'presets' && active?.requiresId && nameInputRef.current) {
            setTimeout(() => {
                nameInputRef.current?.focus();
            }, 100);
        }
    }, [selectedPresetId, selectedTab]);

    // Auto-focus value input when switching to custom tab
    useEffect(() => {
        if (selectedTab === 'custom' && customValueInputRef.current) {
            setTimeout(() => {
                customValueInputRef.current?.focus();
                customValueInputRef.current?.select();
            }, 60);
        }
    }, [selectedTab, customType]);

    // KEYBOARD SHORTCUTS & F-KEYS (No Mouse Needed)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // STOP ALL EVENT PROPAGATION so background POS listeners (F4 Cash In/Out, F1, F5, etc.) NEVER trigger
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();

            const isTyping = ['INPUT', 'TEXTAREA'].includes(e.target?.tagName);

            // Escape: Close Modal
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }

            // If shortcuts are disabled in system settings, only allow Enter & Escape
            if (!enableShortcuts) {
                if (e.key === 'Enter') {
                    if (e.target === nameInputRef.current) {
                        e.preventDefault();
                        idInputRef.current?.focus();
                        return;
                    }
                    e.preventDefault();
                    handleApply();
                }
                return;
            }

            // Alt + P or Alt + M: Focus Manual Typing Input for % or ₱
            if (e.altKey && (e.key === 'p' || e.key === 'P' || e.key === 'm' || e.key === 'M')) {
                e.preventDefault();
                setSelectedTab('custom');
                setTimeout(() => {
                    customValueInputRef.current?.focus();
                    customValueInputRef.current?.select();
                }, 50);
                return;
            }

            // Alt + Number (1-6): Fast Reason selection in Custom tab
            if (e.altKey && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
                e.preventDefault();
                const reasonIdx = parseInt(e.key, 10) - 1;
                if (CUSTOM_REASONS[reasonIdx]) {
                    setCustomReason(CUSTOM_REASONS[reasonIdx]);
                    setErrorMsg('');
                }
                return;
            }

            // Alt + 7: Select "Other" Reason
            if (e.altKey && e.key === '7') {
                e.preventDefault();
                setCustomReason('Other');
                setErrorMsg('');
                return;
            }

            // Ctrl + 1..6: Quick Set Percent in Custom tab even while in input
            if (e.ctrlKey && ['1', '2', '3', '4', '5', '6'].includes(e.key) && selectedTab === 'custom') {
                e.preventDefault();
                const rates = [5, 10, 15, 20, 25, 30];
                const rateIdx = parseInt(e.key, 10) - 1;
                if (rates[rateIdx]) {
                    setCustomType('percentage');
                    setCustomRate(rates[rateIdx]);
                    setTimeout(() => {
                        customValueInputRef.current?.focus();
                        customValueInputRef.current?.select();
                    }, 50);
                }
                return;
            }

            // F-KEYS (F1 - F6) Routing
            if (e.key === 'F1') {
                e.preventDefault();
                if (selectedTab === 'custom') {
                    setCustomType('percentage');
                    setCustomRate(5);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                } else {
                    setSelectedPresetId('senior');
                    setErrorMsg('');
                    setTimeout(() => nameInputRef.current?.focus(), 50);
                }
                return;
            }

            if (e.key === 'F2') {
                e.preventDefault();
                if (selectedTab === 'custom') {
                    setCustomType('percentage');
                    setCustomRate(10);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                } else {
                    setSelectedPresetId('pwd');
                    setErrorMsg('');
                    setTimeout(() => nameInputRef.current?.focus(), 50);
                }
                return;
            }

            if (e.key === 'F3') {
                e.preventDefault();
                if (selectedTab === 'custom') {
                    setCustomType('percentage');
                    setCustomRate(15);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                } else {
                    setSelectedPresetId('loyalty_5');
                    setErrorMsg('');
                }
                return;
            }

            if (e.key === 'F4') {
                e.preventDefault();
                if (selectedTab === 'custom') {
                    setCustomType('percentage');
                    setCustomRate(20);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                } else {
                    setSelectedPresetId('loyalty_10');
                    setErrorMsg('');
                }
                return;
            }

            if (e.key === 'F5') {
                e.preventDefault();
                if (selectedTab === 'custom') {
                    setCustomType('percentage');
                    setCustomRate(25);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                }
                return;
            }

            if (e.key === 'F6') {
                e.preventDefault();
                if (selectedTab === 'custom' && customType === 'percentage') {
                    setCustomRate(30);
                    setTimeout(() => customValueInputRef.current?.focus(), 50);
                } else {
                    setSelectedTab(prev => {
                        const next = prev === 'presets' ? 'custom' : 'presets';
                        if (next === 'custom') {
                            setTimeout(() => {
                                customValueInputRef.current?.focus();
                                customValueInputRef.current?.select();
                            }, 50);
                        }
                        return next;
                    });
                    setErrorMsg('');
                }
                return;
            }

            // Tab key, F9, or 'c' to switch between Presets & Custom Tab (works even when typing)
            if (e.key === 'Tab' || e.key === 'F9' || (!isTyping && (e.key === 'c' || e.key === 'C'))) {
                e.preventDefault();
                setSelectedTab(prev => {
                    const next = prev === 'presets' ? 'custom' : 'presets';
                    if (next === 'custom') {
                        setTimeout(() => {
                            customValueInputRef.current?.focus();
                            customValueInputRef.current?.select();
                        }, 50);
                    }
                    return next;
                });
                setErrorMsg('');
                return;
            }

            // Number keys 1-4 only when on PRESETS tab and NOT typing in an input
            if (!isTyping && selectedTab === 'presets') {
                if (e.key === '1') { e.preventDefault(); setSelectedPresetId('senior'); setTimeout(() => nameInputRef.current?.focus(), 50); return; }
                if (e.key === '2') { e.preventDefault(); setSelectedPresetId('pwd'); setTimeout(() => nameInputRef.current?.focus(), 50); return; }
                if (e.key === '3') { e.preventDefault(); setSelectedPresetId('loyalty_5'); return; }
                if (e.key === '4') { e.preventDefault(); setSelectedPresetId('loyalty_10'); return; }
            }

            // Number keys 1-6 when on CUSTOM tab and NOT typing in input
            if (!isTyping && selectedTab === 'custom' && customType === 'percentage') {
                const rates = [5, 10, 15, 20, 25, 30];
                const keyNum = parseInt(e.key, 10);
                if (keyNum >= 1 && keyNum <= 6) {
                    e.preventDefault();
                    setCustomRate(rates[keyNum - 1]);
                    setTimeout(() => {
                        customValueInputRef.current?.focus();
                        customValueInputRef.current?.select();
                    }, 50);
                    return;
                }
            }

            // F7: Toggle % vs ₱ in Custom mode
            if (e.key === 'F7') {
                e.preventDefault();
                setSelectedTab('custom');
                setCustomType(prev => (prev === 'percentage' ? 'fixed' : 'percentage'));
                setTimeout(() => {
                    customValueInputRef.current?.focus();
                    customValueInputRef.current?.select();
                }, 50);
                return;
            }

            // F8: Remove Discount
            if (e.key === 'F8' || (!isTyping && (e.key === 'Delete' || e.key === 'Backspace'))) {
                if (discount?.type) {
                    e.preventDefault();
                    handleRemove();
                    return;
                }
            }

            // Arrow Keys for preset navigation when not typing
            if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedTab === 'presets') {
                e.preventDefault();
                const currentIndex = PRESETS.findIndex(p => p.id === selectedPresetId);
                let nextIndex = currentIndex;
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    nextIndex = (currentIndex + 1) % PRESETS.length;
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    nextIndex = (currentIndex - 1 + PRESETS.length) % PRESETS.length;
                }
                setSelectedPresetId(PRESETS[nextIndex].id);
                setErrorMsg('');
                return;
            }

            // Enter Key: Advance field or Apply
            if (e.key === 'Enter') {
                if (e.target === nameInputRef.current) {
                    e.preventDefault();
                    idInputRef.current?.focus();
                    return;
                }
                e.preventDefault();
                handleApply();
                return;
            }
        };

        window.addEventListener('keydown', handleKeyDown, true); // useCapture = true for immediate interception
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [selectedTab, selectedPresetId, customerName, customerIdNumber, customType, customRate, customAmountPHP, customReason, customReasonOther, discount, subtotal]);

    // Current preset selected
    const activePreset = PRESETS.find(p => p.id === selectedPresetId) || PRESETS[0];

    // Compute live discount estimate
    let previewDiscountAmount = 0;
    if (selectedTab === 'presets') {
        previewDiscountAmount = Math.round(subtotal * (activePreset.rate / 100));
    } else {
        if (customType === 'fixed') {
            const requestedCents = Math.round(Number(customAmountPHP || 0) * 100);
            previewDiscountAmount = Math.min(subtotal, Math.max(0, requestedCents));
        } else {
            const clampedRate = Math.min(30, Math.max(0, Number(customRate || 0)));
            previewDiscountAmount = Math.round(subtotal * (clampedRate / 100));
        }
    }
    const previewPayable = Math.max(0, subtotal - previewDiscountAmount);

    const handleApply = () => {
        setErrorMsg('');

        if (selectedTab === 'presets') {
            if (activePreset.requiresId) {
                if (!customerName.trim()) {
                    setErrorMsg(`Customer Name is required for ${activePreset.name}.`);
                    nameInputRef.current?.focus();
                    return;
                }
                if (!customerIdNumber.trim()) {
                    setErrorMsg(`Customer ID Number (Senior/PWD Booklet/Card) is required.`);
                    idInputRef.current?.focus();
                    return;
                }
            }

            applyDiscount({
                type: activePreset.id,
                label: `${activePreset.name} (${activePreset.rate}%)`,
                rate: activePreset.rate,
                amount: 0,
                customerName: customerName.trim(),
                customerIdNumber: customerIdNumber.trim(),
                reason: activePreset.requiresId ? `${activePreset.name} Statutory Discount` : activePreset.description,
            });

            onClose();
        } else {
            // Custom discount validation (Owner Safety Caps)
            const finalReason = customReason === 'Other' ? customReasonOther.trim() : customReason;
            if (!finalReason) {
                setErrorMsg('Please specify a reason for the custom discount.');
                return;
            }

            if (customType === 'fixed') {
                const amountVal = parseFloat(customAmountPHP);
                if (isNaN(amountVal) || amountVal <= 0) {
                    setErrorMsg('Please enter a valid fixed discount amount greater than 0.');
                    customValueInputRef.current?.focus();
                    return;
                }
                const maxSafetyCapPHP = 500; // ₱500 safety cap
                if (amountVal > maxSafetyCapPHP && amountVal > (subtotal / 100)) {
                    setErrorMsg(`Safety limit: Fixed custom discount cannot exceed ₱${maxSafetyCapPHP.toFixed(2)}.`);
                    return;
                }
                if ((amountVal * 100) > subtotal) {
                    setErrorMsg('Discount cannot be larger than the order subtotal.');
                    return;
                }

                applyDiscount({
                    type: 'custom_fixed',
                    label: `Custom Discount (₱${amountVal.toFixed(2)} Off)`,
                    rate: null,
                    amount: Math.round(amountVal * 100),
                    customerName: '',
                    customerIdNumber: '',
                    reason: finalReason,
                });
            } else {
                const rateVal = parseFloat(customRate);
                if (isNaN(rateVal) || rateVal <= 0) {
                    setErrorMsg('Please enter a valid discount percentage greater than 0.');
                    customValueInputRef.current?.focus();
                    return;
                }
                if (rateVal > 30) {
                    setErrorMsg('Safety limit: Maximum allowed custom discount rate is 30%.');
                    return;
                }

                applyDiscount({
                    type: 'custom_percentage',
                    label: `Custom Discount (${rateVal}%)`,
                    rate: rateVal,
                    amount: 0,
                    customerName: '',
                    customerIdNumber: '',
                    reason: finalReason,
                });
            }

            onClose();
        }
    };

    const handleRemove = () => {
        removeDiscount();
        onClose();
    };

    const formatCurrency = (cents) => `₱${((cents || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-none shadow-2xl border border-gray-200/90 w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
                
                {/* Header */}
                <div className="bg-[#1B3B6A] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center text-amber-300">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                        </div>
                        <div>
                            <h3 className="text-base sm:text-lg font-black tracking-tight text-white flex items-center gap-2">
                                Order Discount Manager
                                {showFKeys && <span className="text-[10px] font-mono px-1.5 py-0.2 bg-white/20 text-white rounded-none font-extrabold">F10</span>}
                            </h3>
                            <p className="text-xs text-blue-200 font-medium">Apply statutory, promotional, or custom order discounts</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                        title="Close (Esc)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Sub-Header Tabs */}
                <div className="flex border-b border-gray-200 bg-gray-50/80 px-5 pt-3 shrink-0 gap-2 items-center justify-between">
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setSelectedTab('presets'); setErrorMsg(''); }}
                            className={`pb-2.5 px-4 font-bold text-xs sm:text-sm border-b-2 transition-all cursor-pointer ${
                                selectedTab === 'presets'
                                    ? 'border-[#1B3B6A] text-[#1B3B6A] font-black'
                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            <span>Pre-Approved Presets</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => { 
                                setSelectedTab('custom'); 
                                setErrorMsg(''); 
                                setTimeout(() => {
                                    customValueInputRef.current?.focus();
                                    customValueInputRef.current?.select();
                                }, 50);
                            }}
                            className={`pb-2.5 px-4 font-bold text-xs sm:text-sm border-b-2 transition-all cursor-pointer ${
                                selectedTab === 'custom'
                                    ? 'border-[#1B3B6A] text-[#1B3B6A] font-black'
                                    : 'border-transparent text-gray-500 hover:text-gray-800'
                            }`}
                        >
                            <span>Custom Discount (% or ₱)</span>
                        </button>
                    </div>
                    {showFKeys && (
                        <span className="text-[10px] font-mono text-gray-400 font-bold pb-2 hidden sm:inline">
                            Press <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 text-gray-700 font-black">Tab</kbd> to switch
                        </span>
                    )}
                </div>

                {/* Body Content */}
                <div className="p-5 overflow-y-auto space-y-4 flex-1 font-sans">
                    
                    {errorMsg && (
                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-none text-xs font-bold text-rose-700 flex items-center gap-2 animate-shake">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 shrink-0 text-rose-600">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                            </svg>
                            <span>{errorMsg}</span>
                        </div>
                    )}

                    {/* TAB 1: PRESETS */}
                    {selectedTab === 'presets' && (
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                                    Select Discount Option
                                </label>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {PRESETS.map((p) => {
                                    const isSelected = selectedPresetId === p.id;
                                    return (
                                        <button
                                            key={p.id}
                                            type="button"
                                            onClick={() => {
                                                setSelectedPresetId(p.id);
                                                setErrorMsg('');
                                                if (p.requiresId) {
                                                    setTimeout(() => nameInputRef.current?.focus(), 50);
                                                }
                                            }}
                                            className={`p-3 text-left border rounded-none transition-all flex flex-col justify-between cursor-pointer relative ${
                                                isSelected
                                                    ? 'border-[#1B3B6A] bg-[#EFF4F9]/90 ring-2 ring-[#1B3B6A] shadow-xs'
                                                    : 'border-gray-200 bg-white hover:bg-gray-50'
                                            }`}
                                        >
                                            {/* Top Row: Icon + Title + F-Key Badge */}
                                            <div className="flex justify-between items-center gap-2 w-full">
                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                    <span className={`p-1.5 rounded-none shrink-0 ${isSelected ? 'bg-[#1B3B6A] text-white' : 'bg-gray-100 text-gray-600'}`}>
                                                        {p.icon}
                                                    </span>
                                                    <span className="font-extrabold text-xs sm:text-sm text-gray-900 truncate">
                                                        {p.name}
                                                    </span>
                                                </div>
                                                {showFKeys && (
                                                    <span className={`text-[10px] font-mono font-black px-1.5 py-0.5 rounded-none shrink-0 ${
                                                        isSelected ? 'bg-[#1B3B6A] text-white' : 'bg-gray-200 text-gray-700'
                                                    }`}>
                                                        {p.fKey}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Bottom Row: Description + Discount Badge */}
                                            <div className="flex justify-between items-center gap-2 mt-2.5 pt-2 border-t border-gray-100 w-full">
                                                <p className="text-[11px] text-gray-500 font-medium truncate flex-1">
                                                    {p.description}
                                                </p>
                                                <span className={`px-2 py-0.5 text-[10px] font-black rounded-none font-mono shrink-0 ${
                                                    isSelected ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {p.badge}
                                                </span>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Statutory Compliance Fields for Senior / PWD */}
                            {activePreset.requiresId && (
                                <div className="p-4 bg-amber-50/70 border border-amber-200/90 rounded-none space-y-3 mt-3">
                                    <div className="flex items-center gap-2 text-amber-900">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-amber-700 shrink-0">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                                        </svg>
                                        <span className="text-xs font-black uppercase tracking-wider">
                                            Legal & Tax Audit Details (Required by BIR)
                                        </span>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                                Customer Full Name <span className="text-rose-600">*</span>
                                            </label>
                                            <input
                                                ref={nameInputRef}
                                                type="text"
                                                value={customerName}
                                                onChange={(e) => setCustomerName(e.target.value)}
                                                placeholder="e.g. Juan Dela Cruz (Press Enter for ID)"
                                                className="w-full px-3 py-2 text-xs font-bold border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] bg-white"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-bold text-gray-700 mb-1">
                                                Senior / PWD ID / Booklet # <span className="text-rose-600">*</span>
                                            </label>
                                            <input
                                                ref={idInputRef}
                                                type="text"
                                                value={customerIdNumber}
                                                onChange={(e) => setCustomerIdNumber(e.target.value)}
                                                placeholder="e.g. SC-1029348 (Press Enter to Apply)"
                                                className="w-full px-3 py-2 text-xs font-mono font-bold border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] bg-white"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] text-amber-800 font-semibold">
                                        Tip: Press <kbd className="px-1 py-0.2 bg-white border border-amber-300 font-mono text-[9px] font-bold">Enter</kbd> to cycle between Name &rarr; ID &rarr; Apply Discount.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: CUSTOM DISCOUNT */}
                    {selectedTab === 'custom' && (
                        <div className="space-y-4">
                            {/* Type Toggle: Percentage vs Fixed */}
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label className="block text-xs font-black text-gray-500 uppercase tracking-wider">
                                        Discount Calculation Mode
                                    </label>
                                    {showFKeys && (
                                        <span className="text-[10px] font-mono text-gray-400 font-bold">
                                            Press <kbd className="px-1 py-0.2 bg-gray-100 border border-gray-300 font-black">F7</kbd> to toggle
                                        </span>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomType('percentage');
                                            setTimeout(() => {
                                                customValueInputRef.current?.focus();
                                                customValueInputRef.current?.select();
                                            }, 50);
                                        }}
                                        className={`py-2.5 px-3 text-xs font-extrabold rounded-none border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                            customType === 'percentage'
                                                ? 'bg-[#1B3B6A] text-white border-[#1B3B6A] shadow-2xs'
                                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span>% Percentage Off</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setCustomType('fixed');
                                            setTimeout(() => {
                                                customValueInputRef.current?.focus();
                                                customValueInputRef.current?.select();
                                            }, 50);
                                        }}
                                        className={`py-2.5 px-3 text-xs font-extrabold rounded-none border transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                            customType === 'fixed'
                                                ? 'bg-[#1B3B6A] text-white border-[#1B3B6A] shadow-2xs'
                                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span>₱ Fixed Amount Off</span>
                                    </button>
                                </div>
                            </div>

                            {/* Value Input */}
                            {customType === 'percentage' ? (
                                <div>
                                    <div className="flex justify-between items-center mb-1.5">
                                        <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                                            <span>Manual Percentage (Max 30%)</span>
                                            {showFKeys && (
                                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 bg-blue-50 text-[#1B3B6A] border border-blue-200">
                                                    Alt+P
                                                </span>
                                            )}
                                        </label>
                                        <span className="text-[10px] font-bold text-gray-400 font-mono">
                                            {showFKeys ? 'Press F1–F6 for quick presets' : 'Quick percentage presets'}
                                        </span>
                                    </div>
                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                        <div className="flex items-center gap-1.5">
                                            <input
                                                ref={customValueInputRef}
                                                type="number"
                                                min="1"
                                                max="30"
                                                step="1"
                                                value={customRate}
                                                onChange={(e) => setCustomRate(e.target.value)}
                                                className="w-24 px-3 py-2 text-sm font-black font-mono border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] bg-white text-center"
                                            />
                                            <span className="font-bold text-sm text-gray-500 font-mono">%</span>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 flex-1">
                                            {[
                                                { rate: 5, key: 'F1' },
                                                { rate: 10, key: 'F2' },
                                                { rate: 15, key: 'F3' },
                                                { rate: 20, key: 'F4' },
                                                { rate: 25, key: 'F5' },
                                                { rate: 30, key: 'F6' },
                                            ].map(({ rate: val, key }) => (
                                                <button
                                                    key={val}
                                                    type="button"
                                                    onClick={() => {
                                                        setCustomRate(val);
                                                        customValueInputRef.current?.focus();
                                                    }}
                                                    className={`py-1.5 px-2 text-xs font-mono font-bold rounded-none border transition-all cursor-pointer flex flex-col items-center justify-center gap-1 ${
                                                        Number(customRate) === val
                                                            ? 'bg-[#1B3B6A] text-white border-[#1B3B6A] font-black shadow-2xs'
                                                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    <span className="font-black text-sm">{val}%</span>
                                                    {showFKeys && (
                                                        <span className={`text-[10px] font-mono font-extrabold px-1.5 py-0.2 rounded-none ${
                                                            Number(customRate) === val ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'
                                                        }`}>
                                                            {key}
                                                        </span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                                            <span>Fixed Amount to Deduct (PHP)</span>
                                            {showFKeys && (
                                                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 bg-blue-50 text-[#1B3B6A] border border-blue-200">
                                                    Alt+P
                                                </span>
                                            )}
                                        </label>
                                    </div>
                                    <div className="relative w-52">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-gray-400">₱</span>
                                        <input
                                            ref={customValueInputRef}
                                            type="number"
                                            min="1"
                                            max={subtotal / 100}
                                            step="1"
                                            value={customAmountPHP}
                                            onChange={(e) => setCustomAmountPHP(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full pl-7 pr-3 py-2 text-sm font-black font-mono border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] bg-white"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Reason for Audit (Clean buttons, No dropdown) */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <label className="block text-xs font-bold text-gray-700">
                                        Reason for Custom Discount <span className="text-rose-600">*</span>
                                    </label>
                                    {showFKeys && (
                                        <span className="text-[10px] font-mono text-gray-500 font-bold">
                                            Press <kbd className="px-1 py-0.2 bg-gray-100 border border-gray-300 font-black text-gray-800">Alt+1</kbd> to <kbd className="px-1 py-0.2 bg-gray-100 border border-gray-300 font-black text-gray-800">Alt+7</kbd>
                                        </span>
                                    )}
                                </div>

                                {/* Quick Reason Buttons */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                    {CUSTOM_REASONS.map((r, idx) => {
                                        const isSelected = customReason === r;
                                        return (
                                            <button
                                                key={r}
                                                type="button"
                                                onClick={() => { setCustomReason(r); setErrorMsg(''); }}
                                                className={`px-3 py-2 text-left text-xs font-bold rounded-none border transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                                                    isSelected
                                                        ? 'bg-[#EFF4F9] text-[#1B3B6A] border-[#1B3B6A] ring-1 ring-[#1B3B6A]'
                                                        : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span className="truncate">{r}</span>
                                                {showFKeys && (
                                                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-none shrink-0 ${
                                                        isSelected ? 'bg-[#1B3B6A] text-white' : 'bg-gray-100 text-gray-600 border border-gray-200'
                                                    }`}>
                                                        Alt+{idx + 1}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}

                                    {/* Other Reason Option */}
                                    <button
                                        type="button"
                                        onClick={() => { setCustomReason('Other'); setErrorMsg(''); }}
                                        className={`px-3 py-2 text-left text-xs font-bold rounded-none border transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                                            customReason === 'Other'
                                                ? 'bg-[#EFF4F9] text-[#1B3B6A] border-[#1B3B6A] ring-1 ring-[#1B3B6A]'
                                                : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                                        }`}
                                    >
                                        <span>Other (Type custom reason)</span>
                                        {showFKeys && (
                                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-none shrink-0 ${
                                                customReason === 'Other' ? 'bg-[#1B3B6A] text-white' : 'bg-gray-100 text-gray-600 border border-gray-200'
                                            }`}>
                                                Alt+7
                                            </span>
                                        )}
                                    </button>
                                </div>

                                {customReason === 'Other' && (
                                    <input
                                        type="text"
                                        value={customReasonOther}
                                        onChange={(e) => setCustomReasonOther(e.target.value)}
                                        placeholder="Explain reason for discount..."
                                        autoFocus
                                        className="w-full px-3 py-2 text-xs font-bold border border-gray-300 rounded-none focus:outline-none focus:ring-2 focus:ring-[#1B3B6A] bg-white"
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {/* LIVE CALCULATION PREVIEW BOX */}
                    <div className="bg-[#EFF4F9] border border-[#CBD7E6] p-3.5 rounded-none font-sans space-y-1.5 shadow-2xs">
                        <div className="flex justify-between text-xs text-gray-600 font-semibold">
                            <span>Order Subtotal:</span>
                            <span className="font-mono font-bold text-gray-900">{formatCurrency(subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-xs text-emerald-700 font-bold">
                            <span>
                                Estimated Discount {selectedTab === 'presets' ? `(${activePreset.badge})` : ''}:
                            </span>
                            <span className="font-mono">-{formatCurrency(previewDiscountAmount)}</span>
                        </div>
                        <div className="h-px bg-[#CBD7E6] my-1"></div>
                        <div className="flex justify-between items-center text-sm font-black text-[#1B3B6A]">
                            <span className="uppercase tracking-wider text-xs">New Total Payable:</span>
                            <span className="font-mono text-lg">{formatCurrency(previewPayable)}</span>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="bg-gray-50 px-5 py-3.5 border-t border-gray-200 flex items-center justify-between gap-2 shrink-0">
                    <div>
                        {discount?.type && (
                            <button
                                type="button"
                                onClick={handleRemove}
                                className="px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-none transition-colors cursor-pointer flex items-center gap-1"
                            >
                                <span>Remove Discount</span>
                                {showFKeys && <span className="text-[10px] font-mono font-black px-1 bg-rose-100 text-rose-800 rounded-none">F8</span>}
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-bold text-gray-700 bg-white border border-gray-300 hover:bg-gray-100 rounded-none transition-all cursor-pointer shadow-2xs flex items-center gap-1"
                        >
                            <span>Cancel</span>
                            {showFKeys && <span className="text-[10px] font-mono font-black px-1 bg-gray-100 text-gray-600 rounded-none">Esc</span>}
                        </button>
                        <button
                            type="button"
                            onClick={handleApply}
                            className="px-5 py-2 text-xs font-black text-white bg-[#1B3B6A] hover:bg-[#142E54] rounded-none transition-all active:scale-95 cursor-pointer shadow-2xs flex items-center gap-1.5"
                        >
                            <span>Apply Discount</span>
                            {showFKeys && <span className="text-[10px] font-mono font-black px-1 bg-white/20 text-white rounded-none">Enter</span>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
