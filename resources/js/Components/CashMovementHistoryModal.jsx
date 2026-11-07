import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * CashMovementHistoryModal
 *
 * Read-only global history of ALL cash movements (every shift, closed shifts,
 * open shift, and no-shift / general movements). This is deliberately NOT
 * CashMovementModal — this component cannot create a movement.
 */
export default function CashMovementHistoryModal({ isOpen, onClose, cashMovements = [] }) {
    const [page, setPage] = useState(1);
    const itemsPerPage = 10;

    useEffect(() => {
        if (isOpen) setPage(1);
    }, [isOpen]);

    if (!isOpen || typeof document === 'undefined') return null;

    const formatCurrency = (val) =>
        (parseFloat(val) || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
        });

    const formatDateTime = (dateString) => {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const sorted = [...cashMovements].sort((a, b) => b.id - a.id);
    const totalPages = Math.max(1, Math.ceil(sorted.length / itemsPerPage));
    const pageRows = sorted.slice((page - 1) * itemsPerPage, page * itemsPerPage);

    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity animate-in fade-in duration-200 select-none"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose?.();
            }}
        >
            <div
                className="relative bg-white w-full sm:max-w-3xl rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh] z-10 border border-gray-200/90 animate-slide-up sm:animate-fade-in"
                onClick={(e) => e.stopPropagation()}
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
                            <h2 className="text-base sm:text-lg font-black text-white tracking-tight">Cash Movement History</h2>
                            <p className="text-xs text-blue-200 font-medium">All cash movements</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                        title="Close"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-5 space-y-2.5">
                    {pageRows.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 font-medium">
                            No cash movements recorded yet.
                        </div>
                    ) : pageRows.map((movement) => {
                        const isOut = movement.type.includes('out') || movement.type === 'owner_draw' || movement.type === 'safe_drop' || movement.type === 'expense';
                        return (
                            <div key={movement.id} className="border border-gray-200 bg-white hover:bg-gray-50/60 transition-colors p-3.5 sm:p-4">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-black text-gray-900">
                                            {movement.type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-0.5 truncate" title={movement.reason || ''}>
                                            {movement.reason || '—'}
                                        </p>
                                    </div>
                                    <p className={`text-sm sm:text-base font-black whitespace-nowrap ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                                        {isOut ? '-' : '+'}₱{formatCurrency(movement.amount)}
                                    </p>
                                </div>
                                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-gray-500">
                                    <span>{formatDateTime(movement.created_at)}</span>
                                    <span className="text-gray-300">•</span>
                                    <span className="font-semibold text-gray-600">{movement.user?.name || 'Staff'}</span>
                                    <span className="text-gray-300">•</span>
                                    <span className="font-semibold text-gray-600">
                                        {movement.shift_id ? `Shift #${movement.shift_id}` : 'General / No Shift'}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Pagination */}
                {sorted.length > itemsPerPage && (
                    <div className="px-5 sm:px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500 shrink-0">
                        <span>Page <span className="font-bold text-gray-900">{page}</span> of {totalPages} · {sorted.length} movement(s)</span>
                        <div className="flex gap-1.5">
                                            <button
                                                disabled={page === 1}
                                                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                                                className="px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap flex items-center active:scale-95 shadow-2xs cursor-pointer"
                                            >
                                                &laquo; Prev
                                            </button>
                                            <button
                                                disabled={page >= totalPages}
                                                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                                                className="px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap flex items-center active:scale-95 shadow-2xs cursor-pointer"
                                            >
                                                Next &raquo;
                                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body
    );
}
