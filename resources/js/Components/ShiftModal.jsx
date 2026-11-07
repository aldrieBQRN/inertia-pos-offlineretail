import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { router } from '@inertiajs/react';
import axios from 'axios';
import Swal from 'sweetalert2';
import usePrinterStore from '@/Stores/usePrinterStore';

export default function ShiftModal({ isOpen, settings, onClose, onShiftCompleted, showFKeys = true }) {
    const [amount, setAmount] = useState('');
    const [expenses, setExpenses] = useState('');
    const [closingNotes, setClosingNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [summary, setSummary] = useState(null);

    const modalRef = useRef(null);
    const amountInputRef = useRef(null);
    const expensesInputRef = useRef(null);
    const notesRef = useRef(null);

    const printZRead = usePrinterStore((state) => state.printZRead);

    useEffect(() => {
        if (isOpen) {
            // Blur any active background element
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }

            setAmount('');
            setExpenses('');
            setClosingNotes('');
            setSummary(null);
            setIsLoggingOut(false);

            const timer = setTimeout(() => {
                if (amountInputRef.current) {
                    amountInputRef.current.focus();
                    amountInputRef.current.select();
                }
            }, 60);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Keyboard Shortcuts & Focus Trap (F1, F2, F3, Esc, Enter, Tab)
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (summary) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFinalDone();
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    printZRead(summary, settings);
                    return;
                }
            } else {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                    return;
                }

                if (e.key === 'F1') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (amountInputRef.current) {
                        amountInputRef.current.focus();
                        amountInputRef.current.select();
                    }
                    return;
                }

                if (e.key === 'F2') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (expensesInputRef.current) {
                        expensesInputRef.current.focus();
                        expensesInputRef.current.select();
                    }
                    return;
                }

                if (e.key === 'F3') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (notesRef.current) {
                        notesRef.current.focus();
                    }
                    return;
                }

                if (e.key === 'Enter') {
                    if (document.activeElement === notesRef.current && e.shiftKey) {
                        return;
                    }
                    if (document.activeElement === notesRef.current && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSubmit(e);
                        return;
                    }
                }
            }

            // Focus Trap inside modal for Tab navigation
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

        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, summary, amount, expenses, closingNotes, loading]);

    if (!isOpen || typeof document === 'undefined') return null;

    const formatCurrency = (val) => Number(val || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    const handleFinalDone = () => {
        setIsLoggingOut(true);
        router.post('/logout', {}, {
            onSuccess: () => {
                if (onShiftCompleted) onShiftCompleted(null);
                onClose();
            },
            onError: () => {
                setIsLoggingOut(false);
                Swal.fire('Error', 'Failed to log out cleanly.', 'error');
            }
        });
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (loading) return;

        const enteredActual = parseFloat(amount);
        if (isNaN(enteredActual) || enteredActual < 0) {
            Swal.fire('Invalid Count', 'Please enter a valid actual cash count.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const payload = {
                actual_cash: enteredActual,
                expenses: parseFloat(expenses || 0),
                closing_notes: closingNotes.trim()
            };

            const res = await axios.post('/api/shift/close', payload);
            setSummary(res.data);
            if (onShiftCompleted) {
                onShiftCompleted(res.data);
            }
            window.dispatchEvent(new CustomEvent('shift-refresh'));
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || 'Something went wrong while closing shift.', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Prevent non-interactive background clicks inside the modal from stealing input focus
    const handleModalMouseDown = (e) => {
        const isInteractive = e.target.closest('input, textarea, button, a, [role="button"]');
        if (!isInteractive) {
            e.preventDefault();
            if (!summary) {
                if (
                    document.activeElement !== amountInputRef.current &&
                    document.activeElement !== expensesInputRef.current &&
                    document.activeElement !== notesRef.current
                ) {
                    amountInputRef.current?.focus();
                }
            }
        }
    };

    return createPortal(
        <div 
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity select-none"
            onClick={(e) => {
                e.stopPropagation();
                // Do not close when clicking outside / backdrop
                if (!summary) {
                    amountInputRef.current?.focus();
                }
            }}
            onMouseDown={(e) => {
                e.preventDefault();
                if (!summary) {
                    amountInputRef.current?.focus();
                }
            }}
        >
            {/* Modal Container */}
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
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                {summary ? 'Z-Read Audit Summary' : 'Close Work Shift'}
                            </h2>
                            <p className="text-xs text-blue-200 font-medium">{summary ? `Shift #${summary.id} Closed & Reconciled` : 'Reconcile drawer cash before logout'}</p>
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

                <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar bg-white">
                    {summary ? (
                        <div className="space-y-4 pb-4 sm:pb-0">
                            {/* DRAWER RECONCILIATION */}
                            <div className="bg-gray-50 p-5 rounded-none space-y-2.5 border border-gray-100 text-xs sm:text-sm shadow-inner">
                                <div className="text-[10px] uppercase font-black text-gray-400 tracking-widest pb-1 border-b border-gray-200/60">
                                    Cash Drawer Reconciliation
                                </div>

                                <div className="flex justify-between items-center text-gray-600">
                                    <span className="font-medium">Starting Cash Float</span>
                                    <span className="font-bold text-gray-800 font-mono">{formatCurrency(summary.starting_cash)}</span>
                                </div>

                                <div className="flex justify-between items-center text-emerald-600">
                                    <span className="font-medium">+ Cash Sales Collected</span>
                                    <span className="font-black font-mono">+{formatCurrency(summary.cash_sales)}</span>
                                </div>

                                {Number(summary.cash_in || 0) > 0 && (
                                    <div className="flex justify-between items-center text-emerald-600">
                                        <span className="font-medium">+ Cash In / Float Top-up</span>
                                        <span className="font-black font-mono">+{formatCurrency(summary.cash_in)}</span>
                                    </div>
                                )}

                                {Number(summary.cash_out || 0) > 0 && (
                                    <div className="flex justify-between items-center text-rose-500">
                                        <span className="font-medium">- Cash Out / Owner Draw</span>
                                        <span className="font-black font-mono">-{formatCurrency(summary.cash_out)}</span>
                                    </div>
                                )}

                                {Number(summary.expenses || 0) > 0 && (
                                    <div className="flex justify-between items-center text-rose-500">
                                        <span className="font-medium">- Store Expenses / Payouts</span>
                                        <span className="font-black font-mono">-{formatCurrency(summary.expenses)}</span>
                                    </div>
                                )}

                                <div className="border-t border-dashed border-gray-300 my-1"></div>

                                <div className="flex justify-between items-center font-bold text-gray-800">
                                    <span>Expected in Drawer</span>
                                    <span className="font-black text-gray-900 font-mono">{formatCurrency(summary.expected_cash)}</span>
                                </div>

                                <div className="flex justify-between items-center font-black text-[#1B3B6A]">
                                    <span>Actual Count Turnover</span>
                                    <span className="font-black text-base font-mono">{formatCurrency(summary.actual_cash)}</span>
                                </div>
                            </div>

                            {/* DISCREPANCY HERO BOX */}
                            <div className={`p-4 rounded-none text-center border shadow-xs ${
                                Math.abs(Number(summary.difference || 0)) < 0.01 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                    : Number(summary.difference || 0) > 0 
                                        ? 'bg-[#EFF4F9] text-[#1B3B6A] border-[#CBD7E6]' 
                                        : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}>
                                <div className="text-[10px] font-black uppercase tracking-widest opacity-75 mb-1">
                                    {Math.abs(Number(summary.difference || 0)) < 0.01 
                                        ? 'Cash Drawer Status' 
                                        : (Number(summary.difference || 0) > 0 ? 'Cash Drawer Overage' : 'Cash Drawer Shortage')}
                                </div>
                                <div className="text-2xl sm:text-3xl font-black tracking-tight font-mono">
                                    {Math.abs(Number(summary.difference || 0)) < 0.01 
                                        ? 'BALANCED (0.00)' 
                                        : `${Number(summary.difference || 0) > 0 ? '+' : '-'}${formatCurrency(Math.abs(Number(summary.difference || 0)))}`}
                                </div>
                            </div>

                            {/* GROSS SALES BREAKDOWN */}
                            <div className="bg-gray-50 p-4 sm:p-5 rounded-none space-y-2.5 border border-gray-200/80 text-xs sm:text-sm shadow-inner">
                                <div className="flex justify-between items-center pb-1 border-b border-gray-200/60">
                                    <span className="text-[10px] uppercase font-black text-gray-400 tracking-widest">Gross Sales by Channel</span>
                                    <span className="text-[10px] font-bold text-gray-500">{summary.transactions_count || 0} Checkouts</span>
                                </div>
                                <div className="space-y-1.5 pt-1">
                                    <div className="flex justify-between items-center text-gray-700">
                                        <span>Cash Sales</span>
                                        <span className="font-bold font-mono">{formatCurrency(summary.cash_sales)}</span>
                                    </div>
                                    {Number(summary.gcash_sales || 0) > 0 && (
                                        <div className="flex justify-between items-center text-blue-600">
                                            <span>GCash</span>
                                            <span className="font-bold font-mono">+{formatCurrency(summary.gcash_sales)}</span>
                                        </div>
                                    )}
                                    {Number(summary.maya_sales || 0) > 0 && (
                                        <div className="flex justify-between items-center text-emerald-700">
                                            <span>Maya</span>
                                            <span className="font-bold font-mono">+{formatCurrency(summary.maya_sales)}</span>
                                        </div>
                                    )}
                                    {Number(summary.credit_card_sales || 0) > 0 && (
                                        <div className="flex justify-between items-center text-purple-600">
                                            <span>Credit Card</span>
                                            <span className="font-bold font-mono">+{formatCurrency(summary.credit_card_sales)}</span>
                                        </div>
                                    )}
                                    {Number(summary.debit_card_sales || 0) > 0 && (
                                        <div className="flex justify-between items-center text-indigo-600">
                                            <span>Debit / BancNet</span>
                                            <span className="font-bold font-mono">+{formatCurrency(summary.debit_card_sales)}</span>
                                        </div>
                                    )}
                                </div>
                                <div className="border-t border-dashed border-gray-300 my-1 pt-1.5 flex justify-between items-center font-black text-sm text-gray-900">
                                    <span>Total Gross Sales</span>
                                    <span className="font-mono">{formatCurrency(summary.total_sales || (
                                        Number(summary.cash_sales || 0) +
                                        Number(summary.gcash_sales || 0) +
                                        Number(summary.maya_sales || 0) +
                                        Number(summary.credit_card_sales || 0) +
                                        Number(summary.debit_card_sales || 0)
                                    ))}</span>
                                </div>
                            </div>

                            {/* ACTIONS */}
                            <div className="flex flex-col gap-2 pt-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => printZRead(summary, settings)}
                                    className="w-full py-3.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md transition-all active:scale-95 cursor-pointer"
                                >
                                    Print Thermal Z-Read<span className="hidden sm:inline"> (Enter)</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={handleFinalDone}
                                    disabled={isLoggingOut}
                                    className="w-full py-2.5 bg-white text-[#1B3B6A] border border-[#CBD7E6] font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none hover:bg-[#EFF4F9] transition-all active:scale-95 shadow-2xs cursor-pointer disabled:opacity-50 text-center"
                                >
                                    {isLoggingOut ? 'Logging out...' : (
                                        <>
                                            Finish & Logout<span className="hidden sm:inline"> (Esc)</span>
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                        Step 1: Counted Physical Cash <span className="text-rose-500">*</span>
                                    </label>
                                    <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                        F1
                                    </span>
                                </div>
                                <div className="relative">
                                    <input
                                        ref={amountInputRef}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        required
                                        autoFocus
                                        className="w-full px-4 py-3 text-2xl font-black border-2 border-gray-200 rounded-none text-center text-gray-900 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/20 transition-all bg-gray-50 focus:bg-white outline-none font-mono"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                        Step 2: Total Unlogged Expenses <span className="text-gray-400 font-normal">(Optional)</span>
                                    </label>
                                    <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                        F2
                                    </span>
                                </div>
                                <div className="relative">
                                    <input
                                        ref={expensesInputRef}
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="w-full px-4 py-2.5 text-lg font-black border-2 border-gray-200 rounded-none text-center text-gray-900 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all bg-gray-50 focus:bg-white outline-none font-mono"
                                        placeholder="0.00"
                                        value={expenses}
                                        onChange={(e) => setExpenses(e.target.value)}
                                        onFocus={(e) => e.target.select()}
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-1.5">
                                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                        Step 3: Closing Notes / Handover Comments
                                    </label>
                                    <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                        F3
                                    </span>
                                </div>
                                <textarea
                                    ref={notesRef}
                                    rows={2}
                                    value={closingNotes}
                                    onChange={(e) => setClosingNotes(e.target.value)}
                                    placeholder="Optional end-of-shift notes..."
                                    className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-[#1B3B6A] rounded-none text-xs text-gray-800 transition-all outline-none resize-none"
                                />
                            </div>

                            {/* Submit & Cancel Buttons */}
                            <div className="flex flex-col gap-2 pt-2 shrink-0">
                                <button
                                    type="submit"
                                    disabled={loading || !amount}
                                    className={`w-full py-3.5 text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50 ${
                                        loading || !amount ? 'bg-gray-300 cursor-not-allowed shadow-none' : 'bg-[#1B3B6A] hover:bg-[#142E54]'
                                    }`}
                                >
                                    {loading ? (
                                        <div className="flex items-center justify-center gap-2">
                                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                            <span>Reconciling & Closing Shift...</span>
                                        </div>
                                    ) : (
                                        <>
                                            Finalize & Close Shift<span className="hidden sm:inline"> (Enter)</span>
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
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}