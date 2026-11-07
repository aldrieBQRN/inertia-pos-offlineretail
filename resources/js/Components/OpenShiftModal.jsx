import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import Swal from 'sweetalert2';

export default function OpenShiftModal({ isOpen, onClose, onShiftOpened, shiftInfo, terminal, showFKeys = true }) {
    const [startingCash, setStartingCash] = useState('');
    const [openingNotes, setOpeningNotes] = useState('');
    const [loading, setLoading] = useState(false);
    const modalRef = useRef(null);
    const inputRef = useRef(null);
    const notesRef = useRef(null);

    const expectedCash = shiftInfo?.expected_opening_cash ?? 0;
    const recentMovements = shiftInfo?.recent_movements || [];
    const lastShift = shiftInfo?.last_shift;

    useEffect(() => {
        if (isOpen) {
            // Blur any active element in background POS
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }

            // Pre-fill starting cash with the calculated expected opening cash
            setStartingCash(expectedCash.toFixed(2));
            setOpeningNotes('');
            const timer = setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
            }, 60);
            return () => clearTimeout(timer);
        }
    }, [isOpen, expectedCash]);

    // Keyboard Shortcuts & Focus Trap (F1, F2, Esc, Enter, Tab)
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                return;
            }

            if (e.key === 'F1') {
                e.preventDefault();
                e.stopPropagation();
                if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.select();
                }
                return;
            }

            if (e.key === 'F2') {
                e.preventDefault();
                e.stopPropagation();
                if (notesRef.current) {
                    notesRef.current.focus();
                }
                return;
            }

            if (e.key === 'Enter') {
                if (document.activeElement === notesRef.current && e.shiftKey) {
                    // Allow Shift+Enter in textarea for newline
                    return;
                }
                if (document.activeElement === notesRef.current && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSubmit(e);
                    return;
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
    }, [isOpen, startingCash, openingNotes, expectedCash, loading]);

    if (!isOpen || typeof document === 'undefined') return null;

    const enteredAmount = parseFloat(startingCash) || 0;
    const discrepancy = enteredAmount - expectedCash;
    const hasDiscrepancy = Math.abs(discrepancy) > 0.01;

    const formatCurrency = (val) => {
        return Number(val || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    const handleQuickPreset = (amount) => {
        setStartingCash(Number(amount).toFixed(2));
        if (inputRef.current) {
            inputRef.current.focus();
        }
    };

    const handleSubmit = async (e) => {
        if (e) e.preventDefault();
        if (loading) return;

        if (enteredAmount < 0) {
            Swal.fire('Invalid Amount', 'Starting float cannot be negative.', 'warning');
            return;
        }

        setLoading(true);
        try {
            const response = await axios.post('/api/shift/open', {
                starting_cash: enteredAmount,
                opening_notes: openingNotes,
                terminal_id: terminal?.id || null
            });

            Swal.fire({
                icon: 'success',
                title: 'Shift Opened',
                text: `Starting float of ${formatCurrency(enteredAmount)} recorded for ${terminal?.name || 'Register'}.`,
                timer: 1800,
                showConfirmButton: false
            });

            if (onShiftOpened) {
                onShiftOpened(response.data.shift);
            }
            window.dispatchEvent(new CustomEvent('shift-refresh'));
            if (onClose) {
                onClose();
            }
        } catch (error) {
            console.error('Failed to open shift:', error);
            const msg = error.response?.data?.message || 'Failed to open shift. Please try again.';
            Swal.fire('Error', msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Prevent non-interactive background clicks inside the modal from stealing input focus
    const handleModalMouseDown = (e) => {
        const isInteractive = e.target.closest('input, textarea, button, a, [role="button"]');
        if (!isInteractive) {
            e.preventDefault();
            // If neither input nor textarea currently has focus, refocus the starting cash input
            if (document.activeElement !== inputRef.current && document.activeElement !== notesRef.current) {
                inputRef.current?.focus();
            }
        }
    };

    return createPortal(
        <div 
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity animate-in fade-in duration-200 select-none"
            onClick={(e) => { 
                e.stopPropagation(); 
                // Do not close when clicking outside / backdrop; keep focus on starting cash input
                inputRef.current?.focus(); 
            }}
            onMouseDown={(e) => {
                e.preventDefault();
                inputRef.current?.focus();
            }}
        >
            {/* Modal Box */}
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
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                            </svg>
                        </div>
                        <div>
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                Open Work Shift
                            </h2>
                            <p className="text-xs text-blue-200 font-medium">Verify drawer float before selling</p>
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

                {/* Form Body */}
                <form onSubmit={handleSubmit} className="p-5 sm:p-6 overflow-y-auto custom-scrollbar space-y-4 bg-white">
                    
                    {/* Expected Float & Recent Movement Card */}
                    <div className="bg-gray-50 p-3.5 sm:p-4 rounded-none border border-gray-200/80 space-y-2.5">
                        {terminal && (
                            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1.5 pb-2.5 border-b border-gray-200/60">
                                <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">Register / Lane</span>
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-xs font-black bg-[#1B3B6A]/10 text-[#1B3B6A] self-start sm:self-auto max-w-full truncate">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 shrink-0 text-[#1B3B6A]">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                                    </svg>
                                    <span className="truncate">{terminal.name} {terminal.code ? `(${terminal.code})` : ''}</span>
                                </span>
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 text-xs">
                            <span className="text-gray-500 font-bold uppercase tracking-wider text-[10px]">Calculated Drawer Balance</span>
                            <span className="font-black text-[#1B3B6A] text-sm sm:text-base font-mono">{formatCurrency(expectedCash)}</span>
                        </div>

                        {lastShift && (
                            <div className="text-[11px] flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 sm:gap-2 border-t border-gray-200/60 pt-2">
                                <span className="text-gray-500 shrink-0 font-medium">Previous Shift Close:</span>
                                <div className="text-left sm:text-right font-semibold text-gray-700 break-words leading-tight">
                                    <span className="font-bold text-gray-900 font-mono">{formatCurrency(lastShift.actual_cash)}</span>
                                    <span className="text-gray-500 text-[10.5px] block sm:inline sm:ml-1">
                                        ({lastShift.cashier || 'Staff'}{lastShift.terminal ? ` · ${lastShift.terminal}` : ''})
                                    </span>
                                </div>
                            </div>
                        )}

                        {recentMovements.length > 0 && (
                            <div className="bg-amber-50/80 p-2.5 rounded-none border border-amber-200/80 space-y-1.5">
                                <div className="text-[10px] font-black text-amber-800 uppercase tracking-wider flex items-center gap-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
                                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                                    </svg>
                                    Intermediate Cash Movements Detected
                                </div>
                                <div className="space-y-1 text-[11px] text-amber-900">
                                    {recentMovements.map((m, idx) => (
                                        <div key={idx} className="flex justify-between items-center gap-2">
                                            <span className="truncate">• {m.reason || (m.type === 'owner_draw' ? 'Owner Withdrawal' : m.type)}:</span>
                                            <span className="font-bold font-mono shrink-0">{m.type.includes('out') || m.type === 'owner_draw' || m.type === 'safe_drop' ? '-' : '+'}{formatCurrency(m.amount)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Starting Cash Input */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                                Counted Physical Starting Cash <span className="text-rose-500">*</span>
                            </label>
                            <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                F1
                            </span>
                        </div>
                        <div className="relative">
                            <input
                                ref={inputRef}
                                type="number"
                                step="0.01"
                                min="0"
                                required
                                autoFocus
                                value={startingCash}
                                onChange={(e) => setStartingCash(e.target.value)}
                                onFocus={(e) => e.target.select()}
                                placeholder="0.00"
                                className="w-full px-4 py-3 bg-white border-2 border-gray-200 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/20 rounded-none font-black text-lg text-gray-900 transition-all outline-none"
                            />
                        </div>

                        {/* Quick Float Presets — Tablet & Mobile horizontal slider, hidden on Laptop/Desktop */}
                        <div className="flex lg:hidden items-center gap-1.5 pt-1 overflow-x-auto custom-scrollbar-none pb-0.5 select-none">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider shrink-0 mr-0.5">Presets:</span>
                            {[500, 1000, 2000, 3000, 5000].map((amt) => (
                                <button
                                    key={amt}
                                    type="button"
                                    onClick={() => handleQuickPreset(amt)}
                                    className="px-3 py-1.5 rounded-none text-xs font-bold bg-gray-100 hover:bg-gray-200 text-gray-700 transition-all shrink-0 active:scale-95 cursor-pointer shadow-2xs font-mono"
                                >
                                    {amt}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Handover Discrepancy Alert */}
                    {hasDiscrepancy && (
                        <div className={`p-3.5 rounded-none border text-xs space-y-1.5 ${
                            discrepancy < 0 ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-indigo-50 border-indigo-200 text-indigo-800'
                        }`}>
                            <div className="flex justify-between items-center font-bold">
                                <span>Opening Handover Variance:</span>
                                <span className="font-black text-sm font-mono">{discrepancy > 0 ? '+' : ''}{formatCurrency(discrepancy)}</span>
                            </div>
                            <p className="text-[11px] opacity-90 leading-relaxed">
                                {discrepancy < 0 
                                    ? "Physical count is less than expected. This difference will be recorded as an Opening Handover Discrepancy and will NOT be deducted from your sales accountability."
                                    : "Physical count is higher than expected. This excess float is recorded as an Opening Overage."}
                            </p>
                        </div>
                    )}

                    {/* Opening Notes (Required if discrepancy exists) */}
                    <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                            <label className="block text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                                Opening Notes {hasDiscrepancy && <span className="text-rose-500 font-normal">(Explain reason for variance)</span>}
                            </label>
                            <span className="hidden sm:inline-flex text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-gray-100 text-gray-600 border border-gray-200">
                                F2
                            </span>
                        </div>
                        <textarea
                            ref={notesRef}
                            rows={2}
                            value={openingNotes}
                            onChange={(e) => setOpeningNotes(e.target.value)}
                            placeholder={hasDiscrepancy ? "e.g., Missing 500 from previous shift handover..." : "Optional shift handover notes..."}
                            className="w-full p-3 bg-gray-50 border border-gray-200 focus:border-[#1B3B6A] rounded-none text-xs text-gray-800 transition-all outline-none resize-none"
                        />
                    </div>

                    {/* Submit & Cancel Buttons */}
                    <div className="flex flex-col gap-2 pt-2 shrink-0">
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                            {loading ? (
                                <div className="flex items-center justify-center gap-2">
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                    <span>Opening Shift...</span>
                                </div>
                            ) : (
                                <>
                                    Start Work Shift<span className="hidden sm:inline"> (Enter)</span>
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
