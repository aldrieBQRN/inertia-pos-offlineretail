import React, { useState, useEffect, useRef } from 'react';
import Swal from 'sweetalert2';

/**
 * PaymentModal Component
 * Grouped UI: Main category (Cash, E-Wallet, Card) -> Sub-method
 */
export default function PaymentModal({ total, onClose, onConfirm, isProcessing, showFKeys = true, enableShortcuts = true }) {
    // Top-level category: 'cash', 'ewallet', 'card'
    const [category, setCategory] = useState('cash');

    // The exact method sent to DB
    const [method, setMethod] = useState('cash');

    const [cashGiven, setCashGiven] = useState(() => total ? total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');
    const [reference, setReference] = useState('');
    const [change, setChange] = useState(0);

    const modalRef = useRef(null);
    const cashInputRef = useRef(null);
    const referenceInputRef = useRef(null);

    /**
     * Handle category switching and reset sub-methods safely
     */
    const handleCategorySelect = (newCategory) => {
        setCategory(newCategory);
        if (newCategory === 'cash') {
            setMethod('cash');
            setTimeout(() => {
                cashInputRef.current?.focus();
                cashInputRef.current?.select();
            }, 50);
        } else if (newCategory === 'ewallet') {
            setMethod('gcash');
            setTimeout(() => {
                referenceInputRef.current?.focus();
                referenceInputRef.current?.select();
            }, 50);
        } else if (newCategory === 'card') {
            setMethod('credit_card');
            setTimeout(() => {
                referenceInputRef.current?.focus();
                referenceInputRef.current?.select();
            }, 50);
        }
    };

    /**
     * Auto calculate change
     */
    useEffect(() => {
        if (category === 'cash') {
            const cleanGiven = parseFloat(String(cashGiven).replace(/,/g, '')) || 0;
            setChange(cleanGiven - total);
        }
    }, [cashGiven, total, category]);

    // Initial mount: blur background and focus active input
    useEffect(() => {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            document.activeElement.blur();
        }
        const timer = setTimeout(() => {
            if (category === 'cash') {
                cashInputRef.current?.focus();
                cashInputRef.current?.select();
            } else {
                referenceInputRef.current?.focus();
                referenceInputRef.current?.select();
            }
        }, 60);
        return () => clearTimeout(timer);
    }, []);

    // Global KeyDown listener active only when PaymentModal is mounted (open)
    useEffect(() => {
        const handleModalKeyDown = (e) => {
            const isFKey = e.key?.match(/^F[1-9]$|^F1[0-2]$/);

            // If F-keys shortcuts are disabled, do not intercept or execute them
            const shortcutsEnabled = enableShortcuts && localStorage.getItem('pos_enable_shortcuts') !== 'false';
            if (isFKey && !shortcutsEnabled) {
                return;
            }

            if (e.key === 'F1') {
                e.preventDefault();
                e.stopPropagation();
                handleCategorySelect('cash');
                return;
            } else if (e.key === 'F2') {
                e.preventDefault();
                e.stopPropagation();
                handleCategorySelect('ewallet');
                return;
            } else if (e.key === 'F7') {
                e.preventDefault();
                e.stopPropagation();
                handleCategorySelect('card');
                return;
            } else if (e.key === 'F3' && category === 'ewallet') {
                e.preventDefault();
                e.stopPropagation();
                setMethod('gcash');
                referenceInputRef.current?.focus();
                return;
            } else if (e.key === 'F4' && category === 'ewallet') {
                e.preventDefault();
                e.stopPropagation();
                setMethod('maya');
                referenceInputRef.current?.focus();
                return;
            } else if (e.key === 'F8' && category === 'card') {
                e.preventDefault();
                e.stopPropagation();
                setMethod('credit_card');
                referenceInputRef.current?.focus();
                return;
            } else if (e.key === 'F9' && category === 'card') {
                e.preventDefault();
                e.stopPropagation();
                setMethod('debit_card');
                referenceInputRef.current?.focus();
                return;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                handleManualSubmit();
                return;
            }

            // Tab focus trapping
            if (e.key === 'Tab' && modalRef.current) {
                const focusable = modalRef.current.querySelectorAll(
                    'input:not([disabled]), textarea:not([disabled]), button:not([disabled])'
                );
                if (focusable.length > 0) {
                    const first = focusable[0];
                    const last = focusable[focusable.length - 1];

                    if (e.shiftKey) {
                        if (document.activeElement === first || !modalRef.current.contains(document.activeElement)) {
                            e.preventDefault();
                            last.focus();
                        }
                    } else {
                        if (document.activeElement === last || !modalRef.current.contains(document.activeElement)) {
                            e.preventDefault();
                            first.focus();
                        }
                    }
                }
            }
        };

        window.addEventListener('keydown', handleModalKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleModalKeyDown, true);
        };
    }, [category, method, cashGiven, reference, total, onClose, onConfirm, enableShortcuts]);

    const handleCashChange = (e) => {
        let inputVal = e.target.value;
        // Strip everything except digits and a single decimal point
        let cleanVal = inputVal.replace(/[^0-9.]/g, '');
        const parts = cleanVal.split('.');
        if (parts.length > 2) {
            cleanVal = parts[0] + '.' + parts.slice(1).join('');
        }

        let formattedVal = '';
        if (cleanVal !== '') {
            const integerPart = parts[0];
            const decimalPart = parts[1];
            const formattedInteger = integerPart ? Number(integerPart).toLocaleString('en-US') : '0';
            formattedVal = formattedInteger + (cleanVal.includes('.') ? '.' + (decimalPart || '') : '');
        }

        setCashGiven(formattedVal);
    };

    const cleanCashGiven = parseFloat(String(cashGiven).replace(/,/g, '')) || 0;
    const hasCashGiven = String(cashGiven).trim() !== '' && !isNaN(cleanCashGiven);
    const isCashValid = category === 'cash' && hasCashGiven && cleanCashGiven >= total;
    const isRefValid = (category === 'ewallet' || category === 'card') && reference.trim().length > 0;
    const isFormValid = category === 'cash' ? isCashValid : isRefValid;
    const isSubmitDisabled = isProcessing || !isFormValid;

    /**
     * Validates input details based on the selected payment method
     */
    const handleManualSubmit = () => {
        if (!isFormValid || isProcessing) return;

        onConfirm({
            method: method,
            cashGiven: category === 'cash' ? parseFloat(String(cashGiven).replace(/,/g, '')) : null,
            reference: category !== 'cash' ? reference : null
        });
    };

    // Prevent non-interactive background clicks inside the modal from stealing input focus
    const handleModalMouseDown = (e) => {
        const isInteractive = e.target.closest('input, textarea, button, a, [role="button"]');
        if (!isInteractive) {
            e.preventDefault();
            if (category === 'cash') {
                if (document.activeElement !== cashInputRef.current) {
                    cashInputRef.current?.focus();
                }
            } else {
                if (document.activeElement !== referenceInputRef.current) {
                    referenceInputRef.current?.focus();
                }
            }
        }
    };

    // Helper to format the placeholder text nicely
    const getReferencePlaceholder = () => {
        if (method === 'credit_card') return 'Credit Card Approval Code...';
        if (method === 'debit_card') return 'Debit/BancNet Terminal Ref...';
        return `${method.toUpperCase()} Reference No...`;
    };

    return (
        <div 
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity select-none"
            onClick={(e) => {
                e.stopPropagation();
                // Do not close on backdrop click, keep focus on input
                if (category === 'cash') {
                    cashInputRef.current?.focus();
                } else {
                    referenceInputRef.current?.focus();
                }
            }}
            onMouseDown={(e) => {
                e.preventDefault();
                if (category === 'cash') {
                    cashInputRef.current?.focus();
                } else {
                    referenceInputRef.current?.focus();
                }
            }}
        >
            <div 
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={handleModalMouseDown}
                className="bg-white w-full max-w-sm h-auto max-h-[85vh] sm:max-h-[90vh] rounded-none shadow-2xl border border-gray-200/90 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in"
            >

                {/* Modal Header */}
                <div className="bg-[#1B3B6A] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center text-amber-300 shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                Checkout Payment
                                {showFKeys && <span className="text-[10px] font-mono px-1.5 py-0.2 bg-white/20 text-white rounded-none font-extrabold">F12</span>}
                            </h2>
                            <p className="text-xs text-blue-200 font-medium">Select payment channel & finalize order</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                        title="Close (Esc)"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                {/* Scrollable Content Area */}
                <div className="flex-1 overflow-y-auto p-5 custom-scrollbar flex flex-col bg-white">

                    {/* Grand Total Display */}
                    <div className="text-center mb-5 p-4 rounded-none bg-[#EFF4F9] border border-[#CBD7E6] shrink-0">
                        <div className="text-[10px] text-[#1B3B6A] uppercase tracking-widest font-black mb-0.5">Total Amount Due</div>
                        <div className="text-3xl sm:text-4xl font-black text-[#1B3B6A] tracking-tight font-mono">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>

                    {/* PRIMARY CATEGORY BUTTONS */}
                    <div className="grid grid-cols-3 gap-2 sm:gap-2.5 mb-4 shrink-0">

                        {/* Cash Button */}
                        <button
                            type="button"
                            onClick={() => handleCategorySelect('cash')}
                            className={`flex flex-col items-center justify-center py-3 rounded-none border transition-all gap-1.5 shadow-2xs cursor-pointer active:scale-95
                                ${category === 'cash' ? 'border-[#CBD7E6] bg-[#EFF4F9] text-[#1B3B6A] font-extrabold ring-1 ring-[#1B3B6A]' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-bold text-xs uppercase tracking-wider">{showFKeys ? "Cash (F1)" : "Cash"}</span>
                        </button>

                        {/* E-Wallet Button */}
                        <button
                            type="button"
                            onClick={() => handleCategorySelect('ewallet')}
                            className={`flex flex-col items-center justify-center py-3 rounded-none border transition-all gap-1.5 shadow-2xs cursor-pointer active:scale-95
                                ${category === 'ewallet' ? 'border-[#CBD7E6] bg-[#EFF4F9] text-[#1B3B6A] font-extrabold ring-1 ring-[#1B3B6A]' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                            </svg>
                            <span className="font-bold text-xs uppercase tracking-wider">{showFKeys ? "E-Wallet (F2)" : "E-Wallet"}</span>
                        </button>

                        {/* Card Button */}
                        <button
                            type="button"
                            onClick={() => handleCategorySelect('card')}
                            className={`flex flex-col items-center justify-center py-3 rounded-none border transition-all gap-1.5 shadow-2xs cursor-pointer active:scale-95
                                ${category === 'card' ? 'border-[#CBD7E6] bg-[#EFF4F9] text-[#1B3B6A] font-extrabold ring-1 ring-[#1B3B6A]' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
                            </svg>
                            <span className="font-bold text-xs uppercase tracking-wider">{showFKeys ? "Card (F7)" : "Card"}</span>
                        </button>
                    </div>

                    {/* E-WALLET SUB-MENU */}
                    {category === 'ewallet' && (
                        <div className="grid grid-cols-2 gap-2.5 mb-4 animate-in slide-in-from-top-2 duration-200">
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('gcash');
                                    referenceInputRef.current?.focus();
                                }}
                                className={`flex flex-col items-center justify-center py-2.5 rounded-none border transition-all gap-1 shadow-2xs cursor-pointer active:scale-95
                                    ${method === 'gcash' ? 'border-blue-300 bg-blue-50 text-blue-700 font-extrabold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                            >
                                <span className="text-xs uppercase tracking-wider">{showFKeys ? "GCash (F3)" : "GCash"}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('maya');
                                    referenceInputRef.current?.focus();
                                }}
                                className={`flex flex-col items-center justify-center py-2.5 rounded-none border transition-all gap-1 shadow-2xs cursor-pointer active:scale-95
                                    ${method === 'maya' ? 'border-teal-300 bg-teal-50 text-teal-800 font-extrabold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                            >
                                <span className="text-xs uppercase tracking-wider">{showFKeys ? "Maya (F4)" : "Maya"}</span>
                            </button>
                        </div>
                    )}

                    {/* CARD SUB-MENU */}
                    {category === 'card' && (
                        <div className="grid grid-cols-2 gap-2.5 mb-4 animate-in slide-in-from-top-2 duration-200">
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('credit_card');
                                    referenceInputRef.current?.focus();
                                }}
                                className={`flex flex-col items-center justify-center py-2.5 rounded-none border transition-all gap-1 shadow-2xs cursor-pointer active:scale-95
                                    ${method === 'credit_card' ? 'border-purple-300 bg-purple-50 text-purple-700 font-extrabold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                            >
                                <span className="text-xs uppercase tracking-wider">{showFKeys ? "Credit (F8)" : "Credit Card"}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setMethod('debit_card');
                                    referenceInputRef.current?.focus();
                                }}
                                className={`flex flex-col items-center justify-center py-2.5 rounded-none border transition-all gap-1 shadow-2xs cursor-pointer active:scale-95
                                    ${method === 'debit_card' ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-extrabold' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 font-bold'}`}
                            >
                                <span className="text-xs uppercase tracking-wider">{showFKeys ? "Debit (F9)" : "Debit Card"}</span>
                            </button>
                        </div>
                    )}

                    {/* Method-Specific Input Fields */}
                    <div className="space-y-3 shrink-0">
                        {category === 'cash' ? (
                            <div className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs">
                                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Cash Received</label>
                                <div className="relative flex items-center">
                                    <input
                                        ref={cashInputRef}
                                        type="text"
                                        inputMode="decimal"
                                        autoFocus
                                        onFocus={(e) => e.target.select()}
                                        className="w-full px-4 py-2.5 text-xl font-black text-gray-900 border border-gray-200 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/20 focus:border-[#1B3B6A] shadow-2xs font-mono transition-all outline-none"
                                        value={cashGiven}
                                        onChange={handleCashChange}
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className={`mt-3 p-3 rounded-none flex justify-between items-center shadow-2xs border ${change >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                                    <span className="font-black text-[10px] uppercase tracking-wider">{change >= 0 ? 'Change Due' : 'Shortage'}</span>
                                    <span className="text-xl font-black font-mono">{change >= 0 ? change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.abs(change).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs animate-in fade-in duration-300">
                                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
                                    {category === 'card' ? 'Terminal Reference / Auth Code' : 'Payment Reference Number'}
                                </label>
                                <input
                                    ref={referenceInputRef}
                                    type="text"
                                    inputMode="numeric"
                                    autoFocus
                                    onFocus={(e) => e.target.select()}
                                    className="w-full px-4 py-2.5 text-sm font-black text-gray-900 font-mono tracking-wider border border-gray-200 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/20 focus:border-[#1B3B6A] shadow-2xs transition-all outline-none"
                                    value={reference}
                                    onChange={(e) => setReference(e.target.value)}
                                    placeholder={getReferencePlaceholder()}
                                />
                            </div>
                        )}
                    </div>

                    {/* ACTION BUTTONS */}
                    <div className="flex flex-col gap-2 mt-5 pb-1 shrink-0">
                        <button
                            type="button"
                            onClick={handleManualSubmit}
                            disabled={isSubmitDisabled}
                            className={`w-full py-3.5 text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md flex items-center justify-center gap-2 transition-all ${
                                isSubmitDisabled 
                                    ? 'bg-gray-300 text-gray-400 cursor-not-allowed shadow-none' 
                                    : 'bg-[#1B3B6A] hover:bg-[#142E54] active:scale-95 cursor-pointer'
                            }`}
                        >
                            {isProcessing ? <>Processing Payment...</> : <>Confirm Settlement<span className="hidden sm:inline"> (Enter)</span></>}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isProcessing}
                            className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none hover:bg-gray-50 transition-all active:scale-95 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer text-center"
                        >
                            Cancel<span className="hidden sm:inline"> (Esc)</span>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    );
}