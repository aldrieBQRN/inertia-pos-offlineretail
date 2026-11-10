import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Swal from 'sweetalert2';
import usePrinterStore from '@/Stores/usePrinterStore';

export default function CashMovementModal({ 
    isOpen, 
    onClose, 
    onMovementRecorded, 
    settings, 
    user, 
    initialActiveShifts = [],
    initialTerminals = [],
    showFKeys = true
}) {
    const [movementType, setMovementType] = useState('cash_out');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [activeField, setActiveField] = useState('type'); // 'type' | 'amount' | 'reason'
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [activeShifts, setActiveShifts] = useState(() => initialActiveShifts || []);
    const [terminals, setTerminals] = useState(() => initialTerminals || []);
    const [loading, setLoading] = useState(false);
    const { printCashMovementSlip } = usePrinterStore();

    const modalRef = useRef(null);
    const firstTypeBtnRef = useRef(null);
    const amountInputRef = useRef(null);
    const reasonInputRef = useRef(null);
    const reasonContainerRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const highlightedItemRef = useRef(null);

    useEffect(() => {
        if (initialActiveShifts?.length > 0) setActiveShifts(initialActiveShifts);
        if (initialTerminals?.length > 0) setTerminals(initialTerminals);
    }, [initialActiveShifts, initialTerminals]);

    useEffect(() => {
        if (highlightedIndex >= 0 && highlightedItemRef.current) {
            highlightedItemRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest'
            });
        }
    }, [highlightedIndex]);

    useEffect(() => {
        if (isOpen) {
            // Blur any active background elements
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }

            setAmount('');
            setReason('');
            setActiveField('type');
            setShowSuggestions(false);
            setHighlightedIndex(-1);

            const timer = setTimeout(() => {
                if (firstTypeBtnRef.current) {
                    firstTypeBtnRef.current.focus();
                }
            }, 60);

            // Refresh the drawer balance: the open shift, or the register drawer between shifts
            Promise.all([
                axios.get('/api/shifts/active'),
                axios.get('/api/terminals')
            ])
                .then(([shiftRes, termRes]) => {
                    setActiveShifts(shiftRes.data || []);
                    setTerminals(termRes.data || []);
                })
                .catch((err) => {
                    console.error("Failed to load the cash drawer balance:", err);
                });

            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    const formatCurrency = (val) => {
        return Number(val || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    const enteredAmount = parseFloat(amount) || 0;

    // Standalone POS: a single cash drawer (the open shift, or the register drawer between shifts)
    const openShift = activeShifts[0] || null;
    const availableDrawerBalance = openShift
        ? parseFloat(openShift.current_drawer_cash ?? openShift.starting_cash ?? 0)
        : parseFloat(terminals[0]?.current_drawer_cash ?? 0);
    const targetLabel = openShift ? `The cash drawer (Shift #${openShift.id})` : 'The cash drawer';

    const isDeduction = ['cash_out', 'owner_draw', 'safe_drop', 'expense'].includes(movementType);
    const isOverLimit = isDeduction && enteredAmount > availableDrawerBalance;
    const isFormValid = enteredAmount > 0 && reason.trim().length > 0 && !isOverLimit;
    const isSubmitDisabled = loading || !isFormValid;

    const typeOptions = [
        { id: 'cash_out', label: 'Cash Out / Expense', desc: 'Cash taken out of the drawer (expenses, owner withdrawals, safe drops)' },
        { id: 'cash_in', label: 'Cash In / Deposit', desc: 'Cash added to the drawer (deposits, change fund, coins & small bills)' },
    ];

    const quickReasons = {
        cash_out: [
            'Store Cleaning & Sanitation Supplies',
            'Petty Cash Operational Payout',
            'Staff Meal Allowance / Lunch Payout',
            'Courier / Delivery Service Fee',
            'Electricity & Utility Bill Payment',
            'Drinking Water & Dispenser Refill',
            'Office Supplies, Receipts & Paper Rolls',
            'Emergency Maintenance & Store Repairs',
            'Garbage & Waste Collection Fee',
            'Transportation / Fuel Allowance',
            'Store Packaging & Plastic Bags Purchase',
            'Security & Equipment Maintenance',
            'Owner Personal Cash Withdrawal',
            'Supplier Direct Cash Payment',
            'Inventory Restock Purchase',
            'Mid-day Excess Cash Drop to Safe',
            'End-of-Day Register Sweep to Safe'
        ],
        cash_in: [
            'Change Fund Morning Deposit',
            'External Capital Cash Injection',
            'Returned Unused Petty Cash',
            'Customer Refund Reversal Return',
            'Supplier Cash Refund / Rebate',
            'Returned Delivery Cash Advance',
            'Added 1, 5, 10, 20 Coin Rolls',
            'Added 20, 50, 100 Small Bills',
            'Register Cash Replenishment'
        ],
    };

    const currentSuggestions = quickReasons[movementType] || [];
    const filteredSuggestions = currentSuggestions.filter(s =>
        !reason.trim() || s.toLowerCase().includes(reason.toLowerCase().trim())
    );

    const handleReasonKeyDown = (e) => {
        if (!showSuggestions || filteredSuggestions.length === 0) {
            if (e.key === 'ArrowDown') {
                setShowSuggestions(true);
                setHighlightedIndex(0);
                e.preventDefault();
            }
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightedIndex((prev) =>
                prev < filteredSuggestions.length - 1 ? prev + 1 : 0
            );
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightedIndex((prev) =>
                prev > 0 ? prev - 1 : filteredSuggestions.length - 1
            );
        } else if (e.key === 'Enter') {
            if (highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
                e.preventDefault();
                setReason(filteredSuggestions[highlightedIndex]);
                setShowSuggestions(false);
                setHighlightedIndex(-1);
            }
        } else if (e.key === 'Escape') {
            setShowSuggestions(false);
            setHighlightedIndex(-1);
            e.preventDefault();
        }
    };

    // Keyboard Shortcuts & Focus Trap (Esc, Enter, Tab, and F1-F3 for cashier only)
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                if (showSuggestions) {
                    setShowSuggestions(false);
                    setHighlightedIndex(-1);
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
            }

            // Only cashiers use POS F-key shortcuts; Admins use standard mouse/form navigation
            if (!user?.is_admin) {
                if (e.key === 'F1') {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveField('type');
                    if (document.activeElement && typeof document.activeElement.blur === 'function') {
                        document.activeElement.blur();
                    }
                    // Cycle movement types on F1
                    setMovementType(prev => {
                        const currentIndex = typeOptions.findIndex(t => t.id === prev);
                        const nextIndex = (currentIndex + 1) % typeOptions.length;
                        return typeOptions[nextIndex].id;
                    });
                    setReason('');
                    setTimeout(() => {
                        firstTypeBtnRef.current?.focus();
                    }, 30);
                    return;
                }

                if (e.key === 'F2') {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveField('amount');
                    if (amountInputRef.current) {
                        amountInputRef.current.focus();
                        amountInputRef.current.select();
                    }
                    return;
                }

                if (e.key === 'F3') {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveField('reason');
                    if (reasonInputRef.current) {
                        reasonInputRef.current.focus();
                        reasonInputRef.current.select();
                    }
                    setTimeout(() => {
                        if (scrollContainerRef.current) {
                            scrollContainerRef.current.scrollTo({
                                top: scrollContainerRef.current.scrollHeight,
                                behavior: 'smooth'
                            });
                        }
                    }, 100);
                    return;
                }
            }

            if (e.key === 'Enter') {
                if (showSuggestions && highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
                    // Handled inside handleReasonKeyDown
                    return;
                }
                if (isFormValid && !loading) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit(e);
                }
            }

            // Tab focus trapping
            if (e.key === 'Tab' && modalRef.current) {
                const focusable = modalRef.current.querySelectorAll(
                    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
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

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, showSuggestions, highlightedIndex, filteredSuggestions, isFormValid, loading, movementType, amount, reason, isOverLimit, activeField]);

    if (!isOpen || typeof document === 'undefined') return null;

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (!isFormValid || loading) return;

        if (enteredAmount <= 0) {
            Swal.fire('Invalid Amount', 'Please enter an amount greater than 0.', 'warning');
            return;
        }

        if (isOverLimit) {
            Swal.fire({
                icon: 'error',
                title: 'Insufficient Drawer Funds',
                text: `Cannot deduct ${formatCurrency(enteredAmount)}. Only ${formatCurrency(availableDrawerBalance)} is currently in ${targetLabel.charAt(0).toLowerCase() + targetLabel.slice(1)}.`,
            });
            return;
        }

        if (!reason.trim()) {
            Swal.fire('Missing Reason', 'Please specify a reason or purpose for this movement.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                type: movementType,
                amount: enteredAmount,
                reason: reason.trim(),
            };

            const response = await axios.post('/api/shift/cash-movement', payload);
            const savedMovement = response.data.movement;

            Swal.fire({
                icon: 'success',
                title: 'Cash Movement Logged',
                text: `${typeOptions.find(t => t.id === movementType)?.label} of ${formatCurrency(enteredAmount)} recorded.`,
                showCancelButton: true,
                confirmButtonText: 'Print Slip',
                cancelButtonText: 'Done',
                timer: 4000
            }).then((res) => {
                if (res.isConfirmed) {
                    printCashMovementSlip(savedMovement, settings, user);
                }
            });

            if (onMovementRecorded) {
                onMovementRecorded(savedMovement);
            }
            window.dispatchEvent(new CustomEvent('shift-refresh'));
            onClose();
        } catch (error) {
            console.error('Failed to log cash movement:', error);
            const msg = error.response?.data?.message || 'Failed to record cash movement.';
            Swal.fire('Error', msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    const refocusActiveField = () => {
        if (activeField === 'amount') {
            amountInputRef.current?.focus();
        } else if (activeField === 'reason') {
            reasonInputRef.current?.focus();
        } else {
            firstTypeBtnRef.current?.focus();
        }
    };

    // Prevent non-interactive background clicks inside the modal from stealing input focus
    const handleModalMouseDown = (e) => {
        const isInteractive = e.target.closest('input, select, textarea, button, a, [role="button"]');
        if (!isInteractive) {
            e.preventDefault();
            refocusActiveField();
        }
        e.stopPropagation();
    };

    return createPortal(
        <div 
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity animate-in fade-in duration-200 select-none"
            onClick={(e) => {
                if (e.target === e.currentTarget) {
                    e.stopPropagation();
                    refocusActiveField();
                }
            }}
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                    e.preventDefault();
                    e.stopPropagation();
                    refocusActiveField();
                }
            }}
        >
            <div 
                ref={modalRef}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={handleModalMouseDown}
                className="relative bg-white w-full sm:max-w-md rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh] z-10 border border-gray-200/90 animate-slide-up sm:animate-fade-in"
            >

                {/* Header */}
                <div className="bg-[#1B3B6A] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center text-amber-300 shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                Cash In / Cash Out
                                {showFKeys && <span className="text-[10px] font-mono px-1.5 py-0.2 bg-white/20 text-white rounded-none font-extrabold">F4</span>}
                            </h2>
                            <p className="text-xs text-blue-200 font-medium">Record non-sales drawer adjustments & drops</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                        title="Close (Esc)"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Form with Fixed Sticky Footer */}
                <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    
                    {/* Scrollable Form Body */}
                    <div 
                        ref={scrollContainerRef}
                        className="flex-1 p-5 sm:p-6 overflow-y-auto custom-scrollbar space-y-4 pb-44"
                    >
                        
                        {/* Movement Type Selector */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                    Movement Type
                                </label>
                                {!user?.is_admin && (
                                    <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                        F1
                                    </span>
                                )}
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                                {typeOptions.map((t) => (
                                    <button
                                        key={t.id}
                                        ref={t.id === movementType ? firstTypeBtnRef : null}
                                        type="button"
                                        onFocus={() => setActiveField('type')}
                                        onClick={(e) => {
                                            setActiveField('type');
                                            setMovementType(t.id);
                                            setReason('');
                                            e.currentTarget.focus();
                                        }}
                                        className={`p-3 rounded-none border text-left transition-all cursor-pointer flex items-center justify-between outline-none focus:ring-2 focus:ring-[#1B3B6A]/30 ${
                                            movementType === t.id
                                                ? 'border-[#1B3B6A] bg-[#EFF4F9] shadow-xs ring-1 ring-[#1B3B6A]/30'
                                                : 'border-gray-200 bg-white hover:bg-gray-50'
                                        }`}
                                    >
                                        <div>
                                            <span className={`font-black text-xs block ${movementType === t.id ? 'text-[#1B3B6A]' : 'text-gray-800'}`}>
                                                {t.label}
                                            </span>
                                            <span className="text-[11px] text-gray-500 block leading-tight">
                                                {t.desc}
                                            </span>
                                        </div>
                                        <div className={`w-4 h-4 rounded-none border flex items-center justify-center shrink-0 ${
                                            movementType === t.id ? 'border-[#1B3B6A] bg-[#1B3B6A]' : 'border-gray-300'
                                        }`}>
                                            {movementType === t.id && <div className="w-1.5 h-1.5 rounded-none bg-white"></div>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Amount Input with Drawer Balance Check */}
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                        Amount <span className="text-rose-500">*</span>
                                    </label>
                                    {!user?.is_admin && (
                                        <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                            F2
                                        </span>
                                    )}
                                </div>
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-none border font-mono ${
                                    isOverLimit 
                                        ? 'bg-rose-50 border-rose-200 text-rose-700' 
                                        : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                }`}>
                                    Available in Drawer: {formatCurrency(availableDrawerBalance)}
                                </span>
                            </div>
                            <div className="relative">
                                <input
                                    ref={amountInputRef}
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    required
                                    onFocus={(e) => {
                                        setActiveField('amount');
                                        e.target.select();
                                    }}
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="0.00"
                                    className={`w-full px-4 py-3 bg-white border-2 rounded-none font-black text-lg transition-all outline-none font-mono ${
                                        isOverLimit
                                            ? 'border-rose-400 text-rose-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-200'
                                            : 'border-gray-200 text-gray-900 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/20'
                                    }`}
                                />
                            </div>

                            {/* Insufficient Funds Warning Banner */}
                            {isOverLimit && (
                                <div className="p-3 bg-rose-50 border border-rose-200 rounded-none flex items-start gap-2.5 text-rose-800 text-xs animate-in fade-in duration-150">
                                    <svg className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    <div>
                                        <span className="font-bold block">Insufficient Drawer Funds</span>
                                        <span className="text-[11px] text-rose-700 leading-tight block mt-0.5">
                                            Cannot deduct {formatCurrency(enteredAmount)}. {targetLabel} has only {formatCurrency(availableDrawerBalance)} available.
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Reason Input with Interactive Autocomplete Suggestions */}
                        <div className="space-y-1.5 relative">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                        Reason / Description <span className="text-rose-500">*</span>
                                    </label>
                                    {!user?.is_admin && (
                                        <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                            F3
                                        </span>
                                    )}
                                </div>
                                {showSuggestions && filteredSuggestions.length > 0 && (
                                    <span className="hidden lg:inline text-[10px] text-slate-400 font-medium">
                                        Use <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded-none text-[9px] font-mono">↑</kbd> <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded-none text-[9px] font-mono">↓</kbd> + <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded-none text-[9px] font-mono">Enter</kbd>
                                    </span>
                                )}
                            </div>
                            
                            <div className="relative">
                                <input
                                    ref={reasonInputRef}
                                    type="text"
                                    required
                                    value={reason}
                                    onFocus={() => {
                                        setActiveField('reason');
                                        setShowSuggestions(true);
                                        setTimeout(() => {
                                            if (scrollContainerRef.current) {
                                                scrollContainerRef.current.scrollTo({
                                                    top: scrollContainerRef.current.scrollHeight,
                                                    behavior: 'smooth'
                                                });
                                            }
                                        }, 60);
                                    }}
                                    onBlur={() => setTimeout(() => setShowSuggestions(false), 250)}
                                    onKeyDown={handleReasonKeyDown}
                                    onChange={(e) => {
                                        setReason(e.target.value);
                                        setShowSuggestions(true);
                                        setHighlightedIndex(0);
                                    }}
                                    placeholder="Type reason or press down arrow for suggestions..."
                                    className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-[#1B3B6A] focus:bg-white rounded-none text-xs text-gray-800 transition-all outline-none"
                                    autoComplete="off"
                                />

                                {/* Floating Suggestions Dropdown */}
                                {showSuggestions && filteredSuggestions.length > 0 && (
                                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-none shadow-xl z-30 max-h-48 overflow-y-auto custom-scrollbar divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150">
                                        <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                                            <span>Suggestions ({filteredSuggestions.length})</span>
                                            <span className="hidden lg:inline text-[9px] font-normal text-slate-400">Arrow keys to select</span>
                                        </div>
                                        {filteredSuggestions.map((item, idx) => {
                                            const isHighlighted = highlightedIndex === idx;
                                            return (
                                                <button
                                                    key={idx}
                                                    ref={isHighlighted ? highlightedItemRef : null}
                                                    type="button"
                                                    onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setReason(item);
                                                        setShowSuggestions(false);
                                                        setHighlightedIndex(-1);
                                                    }}
                                                    onMouseEnter={() => setHighlightedIndex(idx)}
                                                    className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                                                        isHighlighted
                                                            ? 'bg-[#EFF4F9] text-[#1B3B6A] font-bold border-l-4 border-[#1B3B6A] pl-2.5'
                                                            : 'text-slate-700 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <span>{item}</span>
                                                    <span className={`hidden lg:inline text-[10px] ${isHighlighted ? 'text-[#1B3B6A] font-bold' : 'text-slate-400 group-hover:text-slate-600'} font-medium`}>
                                                        {isHighlighted ? 'Press Enter' : 'Select'}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Fixed Sticky Bottom Action Footer */}
                    <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200/80 flex flex-col gap-2 shrink-0 shadow-2xs">
                        <button
                            type="submit"
                            disabled={isSubmitDisabled}
                            className={`w-full py-3.5 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md transition-all flex items-center justify-center gap-2 ${
                                isSubmitDisabled
                                    ? 'bg-gray-300 text-gray-400 cursor-not-allowed shadow-none'
                                    : 'bg-[#1B3B6A] hover:bg-[#142E54] active:scale-95 text-white cursor-pointer'
                            }`}
                        >
                            {loading ? (
                                <div className="flex items-center justify-center gap-2">
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                    <span>Recording Movement...</span>
                                </div>
                            ) : isOverLimit ? (
                                <span>Insufficient Drawer Balance</span>
                            ) : (
                                <>
                                    Record<span className="hidden sm:inline"> (Enter)</span>
                                </>
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none hover:bg-gray-50 transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50 text-center"
                        >
                            Cancel<span className="hidden sm:inline"> (Esc)</span>
                        </button>
                    </div>

                </form>
            </div>
        </div>,
        document.body
    );
}
