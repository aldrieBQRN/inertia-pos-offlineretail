import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import useCartStore from '@/Stores/useCartStore';
import usePrinterStore from '@/Stores/usePrinterStore';
import PaymentModal from './PaymentModal';
import DiscountModal from './DiscountModal';
import Swal from 'sweetalert2';

/**
 * CartSidebar Component
 * Manages the active shopping cart UI, including quantity adjustments,
 * order saving, and the final checkout orchestration.
 */
export default function CartSidebar({
    settings,
    shiftData,
    onOpenShift,
    onCloseShift,
    showPaymentModal,
    setShowPaymentModal,
    showDiscountModal: externalShowDiscountModal,
    setShowDiscountModal: externalSetShowDiscountModal,
    onClose,
    onPrintReceipt,
    onRecallClick,
    onEditItemQty,
    onCheckoutSuccess,
    heldOrdersCount = 0,
    disabled = false,
    showFKeys = true,
    enableShortcuts = true
}) {
    // --- STORE SELECTORS ---
    const cart = useCartStore((state) => state.cart);
    const addToCart = useCartStore((state) => state.addToCart);
    const removeFromCart = useCartStore((state) => state.removeFromCart);
    const setCart = useCartStore((state) => state.setCart); // Used for full item removal
    const clearCart = useCartStore((state) => state.clearCart);
    const toggleSenior = useCartStore((state) => state.toggleSenior);
    const isSenior = useCartStore((state) => state.isSenior);
    const storeDiscount = useCartStore((state) => state.discount);
    const getComputations = useCartStore((state) => state.getComputations);

    // --- PRINTER STORE ---
    const openCashDrawer = usePrinterStore((state) => state.openCashDrawer);

    const [isProcessing, setIsProcessing] = useState(false);
    const [localShowDiscountModal, setLocalShowDiscountModal] = useState(false);
    const showDiscountModal = externalShowDiscountModal !== undefined ? externalShowDiscountModal : localShowDiscountModal;
    const setShowDiscountModal = externalSetShowDiscountModal !== undefined ? externalSetShowDiscountModal : setLocalShowDiscountModal;

    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [lastTransactionId, setLastTransactionId] = useState(null);
    const [hoveredItemId, setHoveredItemId] = useState(null);
    const [focusedIndex, setFocusedIndex] = useState(-1);
    const [successDetails, setSuccessDetails] = useState(null);
    const cartBottomRef = useRef(null);
    const sidebarRef = useRef(null);
    const scrollContainerRef = useRef(null);
    const prevCartLengthRef = useRef(cart.length);

    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        // Only scroll to bottom when a NEW item is added (length increases),
        // not when quantity of an existing item changes.
        if (cart.length > prevCartLengthRef.current && cartBottomRef.current) {
            cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
        prevCartLengthRef.current = cart.length;
    }, [cart]);

    useEffect(() => {
        if (focusedIndex !== -1 && scrollContainerRef.current) {
            const items = scrollContainerRef.current.querySelectorAll('.cart-item-row');
            const desktopRow = items[focusedIndex * 2];
            const mobileRow = items[focusedIndex * 2 + 1];
            const activeRow = (desktopRow && (desktopRow.offsetWidth > 0 || desktopRow.offsetHeight > 0)) ? desktopRow : mobileRow;

            if (activeRow) {
                activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }, [focusedIndex]);

    useEffect(() => {
        const handleDocClick = (e) => {
            if (showPaymentModal || showSuccessModal) return;
            if (!e.target.closest('.cart-item-row')) {
                setFocusedIndex(-1);
            }
        };
        document.addEventListener('click', handleDocClick);
        return () => {
            document.removeEventListener('click', handleDocClick);
        };
    }, [showPaymentModal, showSuccessModal]);

    useEffect(() => {
        const handleResetNav = () => {
            setFocusedIndex(-1);
        };
        window.addEventListener('reset-cart-nav', handleResetNav);
        return () => window.removeEventListener('reset-cart-nav', handleResetNav);
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            const isFKey = e.key?.match(/^F[1-9]$|^F1[0-2]$/);

            // If F-keys shortcuts are disabled, do not intercept or execute them
            const shortcutsEnabled = enableShortcuts && localStorage.getItem('pos_enable_shortcuts') !== 'false';
            if (isFKey && !shortcutsEnabled) {
                return;
            }

            if (showSuccessModal) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    onPrintReceipt(lastTransactionId);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    handleNewOrder();
                }
                return;
            }

            // Ignore keypresses if disabled or modal is open
            if (disabled || showPaymentModal) return;

            // Ignore if typing in input/textarea (except F-keys)
            if (isFKey) {
                e.preventDefault();
            }

            if (!isFKey && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }

            // 1. Toggling/Activating Cart Navigation with F7 (Current Order)
            if (e.key === 'F7') {
                e.preventDefault();
                e.stopPropagation();
                if (e.repeat) return;
                if (cart.length > 0) {
                    setFocusedIndex(prev => {
                        if (prev >= 0) {
                            return -1;
                        }
                        // Close category dropdown & catalog nav
                        window.dispatchEvent(new CustomEvent('close-category-dropdown'));
                        window.dispatchEvent(new CustomEvent('reset-catalog-nav'));
                        // Blur search input if focused to free arrow keys
                        if (document.activeElement && typeof document.activeElement.blur === 'function') {
                            document.activeElement.blur();
                        }
                        return cart.length - 1;
                    });
                }
                return;
            }

            // 2. If Cart Navigation is active
            if (focusedIndex !== -1) {
                const selectedItem = cart[focusedIndex];

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setFocusedIndex(prev => Math.min(prev + 1, cart.length - 1));
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setFocusedIndex(prev => Math.max(prev - 1, 0));
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setFocusedIndex(-1);
                    return;
                }

                if (selectedItem) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        return;
                    }
                    if (e.key === '+' || e.key === 'Add' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') {
                        e.preventDefault();
                        if (isCustomItem(selectedItem)) {
                            return;
                        }
                        handleIncreaseQty(selectedItem);
                        return;
                    }
                    if (e.key === '-' || e.key === 'Subtract' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
                        e.preventDefault();
                        if (isCustomItem(selectedItem)) {
                            return;
                        }
                        removeFromCart(selectedItem.id);
                        if (selectedItem.quantity === 1) {
                            if (cart.length <= 1) {
                                setFocusedIndex(-1);
                            } else if (focusedIndex >= cart.length - 1) {
                                setFocusedIndex(cart.length - 2);
                            }
                        }
                        return;
                    }
                    if (e.key === 'Backspace' || e.key === 'Delete' || e.code === 'Backspace' || e.code === 'Delete') {
                        e.preventDefault();
                        handleRemoveEntireItem(selectedItem);
                        return;
                    }
                }
            }

            // 3. Fallback: Hover shortcuts (only if cart navigation is NOT active)
            if (focusedIndex === -1 && hoveredItemId) {
                const hoveredItem = cart.find(item => item.id === hoveredItemId);
                if (!hoveredItem) return;

                if (e.key === '+' || e.key === 'Add' || e.key === '=' || e.code === 'NumpadAdd' || e.code === 'Equal') {
                    e.preventDefault();
                    if (isCustomItem(hoveredItem)) {
                        return;
                    }
                    handleIncreaseQty(hoveredItem);
                } else if (e.key === '-' || e.key === 'Subtract' || e.code === 'NumpadSubtract' || e.code === 'Minus') {
                    e.preventDefault();
                    if (isCustomItem(hoveredItem)) {
                        return;
                    }
                    removeFromCart(hoveredItem.id);
                } else if (e.key === 'Backspace' || e.key === 'Delete' || e.code === 'Backspace' || e.code === 'Delete') {
                    e.preventDefault();
                    handleRemoveEntireItem(hoveredItem);
                    setHoveredItemId(null);
                }
            }

            if (e.key === 'F9') {
                if (cart.length > 0) {
                    handleClearCart();
                }
            } else if (e.key === 'F10') {
                setShowDiscountModal(true);
            } else if (e.key === 'F11') {
                if (cart.length > 0) {
                    handleSaveOrder();
                }
            } else if (e.key === 'F12') {
                if (cart.length > 0) {
                    setShowPaymentModal(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, hoveredItemId, cart, showPaymentModal, showSuccessModal, showDiscountModal, onEditItemQty, disabled, enableShortcuts]);

    // Format currency for display
    const formatPrice = (cents) => `${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    // Safely execute computations
    const { subtotal, discount, total } = getComputations ? getComputations() : { subtotal: 0, discount: 0, total: 0 };

    // Calculate TOTAL quantity of all items in the cart
    const totalItemsCount = cart.reduce((total, item) => total + item.quantity, 0);

    const isCustomItem = (item) => item?.is_custom === true;

    /**
     * Increments item quantity after validating against available stock.
     */
    const handleIncreaseQty = (item) => {
        if (isCustomItem(item)) {
            return;
        }

        if (item.quantity >= item.stock_quantity) {
            Swal.fire({
                icon: 'error',
                title: 'Limit Reached',
                text: `Only ${item.stock_quantity} stocks remaining!`,
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 2000,
                background: '#FEF2F2',
                color: '#991B1B'
            });
            return;
        }
        addToCart(item);
    };

    const handleRemoveEntireItem = (itemToRemove) => {
        const isMatch = (item) => {
            if (item.is_custom && itemToRemove.is_custom) {
                return item.custom_key === itemToRemove.custom_key;
            }
            return item.id === itemToRemove.id;
        };
        const indexToRemove = cart.findIndex(isMatch);
        const updatedCart = cart.filter(item => !isMatch(item));
        setCart(updatedCart);

        // Keep highlight active if navigation mode is active
        if (focusedIndex !== -1) {
            if (updatedCart.length === 0) {
                setFocusedIndex(-1);
            } else if (focusedIndex === indexToRemove) {
                if (indexToRemove >= updatedCart.length) {
                    setFocusedIndex(updatedCart.length - 1);
                }
            } else if (indexToRemove < focusedIndex) {
                setFocusedIndex(prev => prev - 1);
            }
        }
    };

    /**
     * Clears all items from the current cart with a user confirmation.
     */
    const handleClearCart = async () => {
        if (cart.length === 0) {
            Swal.fire({
                icon: 'info',
                title: 'Cart is already empty!',
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 2000,
                background: '#EFF6FF',
                color: '#1E3A8A'
            });
            return;
        }

        const result = await Swal.fire({
            title: 'Clear Cart?',
            text: "Remove all items from the current order?",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#ef4444',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, clear it!'
        });

        if (result.isConfirmed) {
            clearCart();
        }
    };

    /**
     * Parks the current order into the 'Held Orders' table for later retrieval.
     */
    const handleSaveOrder = async () => {
        if (cart.length === 0) return;

        const { value: note } = await Swal.fire({
            title: 'Save Order',
            input: 'text',
            inputLabel: 'Reference Note (Optional)',
            inputPlaceholder: 'e.g. Table 5 or Customer Name',
            showCancelButton: true,
            confirmButtonText: 'Save Order',
            confirmButtonColor: '#f59e0b'
        });

        if (note !== undefined) {
            try {
                await axios.post('/api/held-orders', {
                    cart: cart,
                    total: total,
                    note: note || `Order #${Math.floor(Math.random() * 1000)}`
                });

                clearCart();
                window.dispatchEvent(new CustomEvent('held-orders-updated'));
                Swal.fire({
                    icon: 'success',
                    title: 'Order Saved',
                    toast: true,
                    position: 'top-end',
                    showConfirmButton: false,
                    timer: 1500
                });

                if (onClose) onClose();
            } catch (error) {
                Swal.fire('Error', 'Failed to save order', 'error');
            }
        }
    };

    /**
     * Finalizes the transaction by sending cart and payment data to the backend.
     */
    const handleFinalizePayment = async (paymentDetails) => {
        setIsProcessing(true);
        try {
            const totalInUnits = total / 100;
            const cashGiven = paymentDetails.cashGiven ? parseFloat(paymentDetails.cashGiven) : 0;
            const change = paymentDetails.method === 'cash' ? (cashGiven - totalInUnits) : 0;

            const computations = getComputations ? getComputations() : {};

            const response = await axios.post('/api/checkout', {
                cart: cart.map(item => {
                    const isCustom = item.is_custom === true || (typeof item.id === 'string' && item.id.startsWith('custom-'));
                    return {
                        id: isCustom ? null : item.id,
                        quantity: Number(item.quantity),
                        name: isCustom ? item.name : undefined,
                        price: item.price / 100
                    };
                }),
                payment_method: paymentDetails.method,
                reference: paymentDetails.reference,
                is_senior: isSenior,
                discount_type: computations.discountType || null,
                discount_rate: computations.discountRate || null,
                discount_amount: computations.discount || 0,
                customer_name: computations.customerName || null,
                customer_id_number: computations.customerIdNumber || null,
                discount_reason: computations.discountReason || null,
                cash_given: cashGiven,
                change: change,
                terminal_id: localStorage.getItem('pos_terminal_id') || null
            });

            if (response.data.success) {
                setSuccessDetails({
                    total: totalInUnits,
                    cashGiven: cashGiven,
                    change: change,
                    paymentMethod: paymentDetails.method,
                    reference: paymentDetails.reference
                });
                setLastTransactionId(response.data.sale_id);
                setShowPaymentModal(false);
                clearCart();
                setShowSuccessModal(true);

                if (onCheckoutSuccess) {
                    onCheckoutSuccess();
                }
                window.dispatchEvent(new CustomEvent('shift-refresh'));
            }
        } catch (error) {
            Swal.fire('Error', error.response?.data?.message || "Transaction failed", 'error');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleNewOrder = () => {
        setShowSuccessModal(false);
        setLastTransactionId(null);
        setSuccessDetails(null);
        window.dispatchEvent(new CustomEvent('transaction-completed'));
        if (onClose) onClose();
    };

    return (
        <>
            <div ref={sidebarRef} className="flex flex-col h-full relative bg-white">
                {/* HEADER */}
                <div className="px-4 py-3 flex justify-between items-center border-b border-gray-200 bg-white shrink-0">
                    <div className="flex items-center gap-2">
                        {onClose && (
                            <button onClick={onClose} className="md:hidden p-1.5 -ml-1 text-gray-500 hover:bg-gray-100 rounded-none transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                        )}
                        <div>
                            <h2 className="text-base font-black text-gray-900 tracking-tight">
                                {showFKeys ? "Current Order (F7)" : "Current Order"}
                            </h2>
                            <p className="text-xs font-medium text-gray-400 mt-0.5">
                                {totalItemsCount} {totalItemsCount === 1 ? 'item' : 'items'}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2">
                        {/* Recall Button (F8) */}
                        <button
                            onClick={onRecallClick}
                            disabled={disabled}
                            className="relative px-2.5 xl:px-3.5 h-[38px] bg-white text-gray-700 hover:bg-gray-50 rounded-none transition-all border border-gray-200 flex items-center gap-1.5 text-xs sm:text-sm font-bold shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={showFKeys ? "Recall (F8)" : "Recall"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-gray-500 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {showFKeys ? (
                                <span className="hidden lg:inline-flex items-center gap-1">
                                    <span className="hidden xl:inline">Recall</span>
                                    <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-gray-100 text-gray-600">F8</span>
                                </span>
                            ) : (
                                <span className="hidden xl:inline">Recall</span>
                            )}
                            {heldOrdersCount > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-amber-500 text-white text-[10px] font-black font-mono rounded-none flex items-center justify-center shadow-xs border-2 border-white pointer-events-none transition-transform scale-100 animate-in zoom-in-50 duration-150">
                                    {heldOrdersCount > 99 ? '99+' : heldOrdersCount}
                                </span>
                            )}
                        </button>

                        {/* Clear Cart Button (F9) */}
                        <button
                            onClick={handleClearCart}
                            disabled={disabled}
                            className="px-2.5 xl:px-3.5 h-[38px] bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-none transition-all border border-rose-200 flex items-center gap-1.5 text-xs sm:text-sm font-bold shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            title={showFKeys ? "Clear Cart (F9)" : "Clear Cart"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-rose-600 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                            {showFKeys ? (
                                <span className="hidden lg:inline-flex items-center gap-1">
                                    <span className="hidden xl:inline">Clear</span>
                                    <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-rose-100 text-rose-700">F9</span>
                                </span>
                            ) : (
                                <span className="hidden xl:inline">Clear</span>
                            )}
                        </button>

                        {/* Discount Button (F10) */}
                        <button
                            onClick={() => setShowDiscountModal(true)}
                            disabled={disabled}
                            className={`px-2.5 xl:px-3.5 h-[38px] rounded-none transition-all border flex items-center gap-1.5 text-xs sm:text-sm font-bold shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
                                (isSenior || storeDiscount?.type)
                                    ? 'bg-amber-100 hover:bg-amber-200/80 text-amber-900 border-amber-300 font-extrabold shadow-2xs' 
                                    : 'bg-amber-50 hover:bg-amber-100 text-amber-700 border-amber-200'
                            }`}
                            title={showFKeys ? "Discount (F10)" : "Discount"}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={`w-4 h-4 shrink-0 ${(isSenior || storeDiscount?.type) ? 'text-amber-800' : 'text-amber-600'}`}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                            </svg>
                            {showFKeys ? (
                                <span className="hidden lg:inline-flex items-center gap-1">
                                    <span className="hidden xl:inline">
                                        {storeDiscount?.type ? (storeDiscount.rate ? `${storeDiscount.rate}%` : 'Discount') : 'Discount'}
                                    </span>
                                    <span className={`text-[10px] font-black font-mono px-1 py-0.2 rounded-none ${(isSenior || storeDiscount?.type) ? 'bg-amber-200/90 text-amber-900' : 'bg-amber-100 text-amber-700'}`}>F10</span>
                                </span>
                            ) : (
                                <span className="hidden xl:inline">
                                    {storeDiscount?.type ? (storeDiscount.rate ? `${storeDiscount.rate}%` : 'Discount') : 'Discount'}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                {/* SUB-HEADER: COLUMN HEADERS — desktop only */}
                <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-200/80 shrink-0 hidden lg:block">
                    {/* COLUMNS HEADERS */}
                    <div className="grid grid-cols-[85px_1fr_95px_100px] gap-2 text-gray-500 uppercase text-[10px] font-black tracking-wider whitespace-nowrap">
                        <div className="text-center">Qty</div>
                        <div className="pl-3">Description</div>
                        <div className="text-right">Price</div>
                        <div className="text-right">Amount</div>
                    </div>
                </div>

                {/* CART ITEMS LIST */}
                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                    {cart.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-300 pb-10 space-y-2">
                            <div className="w-12 h-12 rounded-none bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
                            </div>
                            <p className="text-xs font-bold text-gray-400">Order is currently empty</p>
                            <p className="text-[11px] text-gray-400 font-medium">Scan or click products on the catalog</p>
                        </div>
                    ) : (
                        <div className="flex flex-col p-2 lg:p-0 gap-2 lg:gap-0 bg-white divide-y divide-gray-100/80">
                            {cart.map((item, index) => (
                                <React.Fragment key={item.id}>
                                    {/* Desktop Row */}
                                    <div
                                        onMouseEnter={() => setHoveredItemId(item.id)}
                                        onMouseLeave={() => setHoveredItemId(prev => prev === item.id ? null : prev)}
                                        onClick={() => {
                                            if (disabled) return;
                                            window.dispatchEvent(new CustomEvent('close-category-dropdown'));
                                            window.dispatchEvent(new CustomEvent('reset-catalog-nav'));
                                            setFocusedIndex(index);
                                        }}
                                        className={`w-full cart-item-row hidden lg:grid grid-cols-[85px_1fr_95px_100px] gap-2 px-4 py-2.5 items-center hover:bg-gray-50/80 transition-colors text-xs font-bold group cursor-pointer ${focusedIndex === index ? 'bg-[#EFF4F9]/70 ring-1 ring-inset ring-[#1B3B6A]/40' : ''}`}
                                    >
                                        {/* QTY Column with Hover Controls */}
                                        <div className="flex items-center justify-between h-7 select-none relative w-full bg-gray-50 rounded-none p-0.5 border border-gray-200">
                                            {!item.is_custom ? (
                                                <>
                                                    <button
                                                        onClick={(e) => {
                                                             e.stopPropagation();
                                                             removeFromCart(item.id);
                                                        }}
                                                        disabled={disabled}
                                                        className="w-5 h-5 bg-white hover:bg-[#1B3A69] hover:text-white rounded-none text-gray-700 flex items-center justify-center transition-all shrink-0 font-mono text-xs font-black shadow-2xs cursor-pointer disabled:cursor-not-allowed"
                                                        title="Decrease"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="flex-1 text-center font-black text-gray-900 font-mono text-xs">
                                                        {item.quantity}
                                                    </span>
                                                    <button
                                                        onClick={(e) => {
                                                             e.stopPropagation();
                                                             handleIncreaseQty(item);
                                                        }}
                                                        disabled={disabled}
                                                        className="w-5 h-5 bg-white hover:bg-[#1B3A69] hover:text-white rounded-none text-gray-700 flex items-center justify-center transition-all shrink-0 font-mono text-xs font-black shadow-2xs cursor-pointer disabled:cursor-not-allowed"
                                                        title="Increase"
                                                    >
                                                        +
                                                    </button>
                                                </>
                                            ) : (
                                                <span className="flex-1 text-center font-black text-gray-900 font-mono text-xs">
                                                    {item.quantity}
                                                </span>
                                            )}
                                        </div>

                                        {/* DESCRIPTION Column */}
                                        <div className="min-w-0 pl-3 pr-1 flex items-center justify-between">
                                            <span className="font-bold text-gray-900 text-xs truncate leading-tight block select-none" title={item.name}>
                                                {item.name}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRemoveEntireItem(item);
                                                }}
                                                disabled={disabled}
                                                className={`text-gray-400 hover:text-rose-600 p-1 rounded-none hover:bg-rose-50 transition-all shrink-0 ml-1 disabled:cursor-not-allowed ${disabled ? 'opacity-0 pointer-events-none' : (focusedIndex === index ? 'md:opacity-100' : 'md:opacity-0 md:group-hover:opacity-100')}`}
                                                title="Delete"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>

                                        {/* PRICE Column */}
                                        <div className="text-right text-gray-500 font-mono font-medium text-xs">
                                            {formatPrice(item.price)}
                                        </div>

                                        {/* AMOUNT Column */}
                                        <div className="text-right text-gray-900 font-mono font-black text-xs sm:text-sm">
                                            {formatPrice(item.price * item.quantity)}
                                        </div>
                                    </div>

                                    {/* Mobile Card — shown on mobile AND tablet */}
                                    <div
                                        onClick={() => {
                                            if (disabled) return;
                                            window.dispatchEvent(new CustomEvent('close-category-dropdown'));
                                            window.dispatchEvent(new CustomEvent('reset-catalog-nav'));
                                            setFocusedIndex(index);
                                        }}
                                        className={`w-full cart-item-row flex lg:hidden flex-col p-3.5 border rounded-none bg-white transition-all relative cursor-pointer shadow-2xs ${focusedIndex === index ? 'border-[#1B3B6A]/60 bg-[#EFF4F9]/40 shadow-xs' : 'border-gray-200/80 hover:bg-gray-50'}`}
                                    >
                                        {/* Top section: Name and Delete button */}
                                        <div className="flex justify-between items-start gap-2">
                                            <span className="font-bold text-gray-900 text-xs sm:text-sm line-clamp-2 select-none leading-tight" title={item.name}>
                                                {item.name}
                                            </span>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleRemoveEntireItem(item);
                                                }}
                                                disabled={disabled}
                                                className="text-gray-400 hover:text-rose-600 p-1.5 rounded-none hover:bg-rose-50 transition-all shrink-0 -mt-1 cursor-pointer"
                                                title="Delete"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                            </button>
                                        </div>

                                        {/* Price & Stock info: price and amount */}
                                        <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-gray-100">
                                            {/* Left: Qty Selector */}
                                            {!item.is_custom ? (
                                                <div className="flex items-center h-8 select-none relative bg-gray-50 border border-gray-200 rounded-none p-0.5">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            removeFromCart(item.id);
                                                        }}
                                                        disabled={disabled}
                                                        className="w-6 h-6 bg-white border border-gray-200 hover:bg-[#1B3A69] hover:text-white rounded-none text-gray-700 flex items-center justify-center transition-all shrink-0 font-mono text-xs font-black shadow-2xs disabled:cursor-not-allowed cursor-pointer"
                                                        title="Decrease"
                                                    >
                                                        -
                                                    </button>
                                                    <span className="w-8 text-center font-black text-gray-900 font-mono text-xs">
                                                        {item.quantity}
                                                    </span>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleIncreaseQty(item);
                                                        }}
                                                        disabled={disabled}
                                                        className="w-6 h-6 bg-white border border-gray-200 hover:bg-[#1B3A69] hover:text-white rounded-none text-gray-700 flex items-center justify-center transition-all shrink-0 font-mono text-xs font-black shadow-2xs disabled:cursor-not-allowed cursor-pointer"
                                                        title="Increase"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center h-8 select-none relative px-2.5 text-xs font-black text-gray-500 bg-gray-100 border border-gray-200 rounded-none font-mono">
                                                    QTY: <span className="text-gray-900 ml-1">{item.quantity}</span>
                                                </div>
                                            )}

                                            {/* Right: Price details */}
                                            <div className="text-right">
                                                <div className="text-[10px] font-bold text-gray-400 font-mono">
                                                    {formatPrice(item.price)} × {item.quantity}
                                                </div>
                                                <div className="text-xs sm:text-sm font-black text-[#1B3B6A] font-mono mt-0.5">
                                                    {formatPrice(item.price * item.quantity)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </React.Fragment>
                            ))}
                            {/* Auto-scroll anchor */}
                            <div ref={cartBottomRef} />
                        </div>
                    )}
                </div>

                {/* FOOTER TOTALS & ACTIONS */}
                <div className="border-t p-4 bg-white border-gray-200 shadow-2xs space-y-3 shrink-0">
                    <div className="space-y-1.5">
                        <div className="flex justify-between text-xs sm:text-sm text-gray-500 font-semibold">
                            <span>Gross Subtotal</span>
                            <span className="font-mono text-gray-900 font-bold">{formatPrice(subtotal)}</span>
                        </div>
                        {discount > 0 && (() => {
                            const computations = getComputations ? getComputations() : {};
                            return (
                                <div className="flex justify-between text-xs sm:text-sm text-emerald-700 font-bold">
                                    <span className="truncate pr-2">
                                        Less: {computations.discountLabel || 'Discount'}
                                        {computations.customerName ? ` (${computations.customerName})` : ''}
                                    </span>
                                    <span className="font-mono shrink-0">-{formatPrice(discount)}</span>
                                </div>
                            );
                        })()}
                    </div>

                    <div className="pt-2.5 border-t border-gray-100 flex justify-between items-end">
                        <span className="text-xs uppercase font-black text-gray-500 tracking-wider">Total Payable</span>
                        <span className="text-2xl sm:text-3xl font-black text-[#1B3B6A] tracking-tight font-mono">{formatPrice(total)}</span>
                    </div>

                    {/* ACTIONS */}
                    <div className="grid grid-cols-2 gap-2 sm:gap-2.5 pt-1">
                        <button
                            onClick={() => handleSaveOrder()}
                            disabled={disabled || cart.length === 0}
                            className="w-full py-3 rounded-none bg-[#EFF4F9] text-[#1B3B6A] font-bold text-xs sm:text-sm border border-[#CBD7E6] hover:bg-[#E2ECF6] disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer shadow-2xs"
                        >
                            {showFKeys ? "Save Order (F11)" : "Save Order"}
                        </button>
                        <button
                            onClick={() => {
                                if (shiftData && !shiftData.has_active_shift) {
                                    Swal.fire({
                                        title: 'No Active Work Shift',
                                        text: 'Please open a work shift and record your starting float before checking out.',
                                        icon: 'warning',
                                        confirmButtonColor: '#1B3A69',
                                        confirmButtonText: 'Open Shift Now',
                                        showCancelButton: true,
                                        cancelButtonText: 'Cancel'
                                    }).then((res) => {
                                        if (res.isConfirmed && onOpenShift) {
                                            onOpenShift();
                                        }
                                    });
                                    return;
                                }
                                setShowPaymentModal(true);
                            }}
                            disabled={disabled || cart.length === 0}
                            className="w-full py-3 rounded-none bg-[#1B3B6A] hover:bg-[#142E54] text-white font-bold text-xs sm:text-sm shadow-2xs disabled:bg-gray-300 disabled:cursor-not-allowed transition-all active:scale-95 cursor-pointer"
                        >
                            {showFKeys ? "Checkout (F12)" : "Checkout"}
                        </button>
                    </div>
                </div>
            </div>

            {/* DISCOUNT MODAL */}
            {showDiscountModal && (
                <DiscountModal
                    onClose={() => setShowDiscountModal(false)}
                    showFKeys={showFKeys}
                    enableShortcuts={enableShortcuts}
                />
            )}

            {/* PAYMENT MODAL */}
            {showPaymentModal && (
                <PaymentModal
                    total={total / 100}
                    onClose={() => setShowPaymentModal(false)}
                    onConfirm={handleFinalizePayment}
                    isProcessing={isProcessing}
                    showFKeys={showFKeys}
                    enableShortcuts={enableShortcuts}
                />
            )}

            {/* SUCCESS MODAL */}
            {showSuccessModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white rounded-none shadow-2xl border border-gray-200/90 w-full max-w-sm overflow-hidden text-center p-6 flex flex-col items-center">
                        <div className="w-14 h-14 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-none flex items-center justify-center mb-3.5 shadow-2xs">
                            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"></path></svg>
                        </div>

                        <h2 className="text-xl font-black text-gray-900 tracking-tight">Payment Successful</h2>
                        <p className="text-xs text-gray-400 font-semibold mt-0.5">Transaction completed and recorded</p>

                        {/* Transaction Summary (Total, Cash, Change) */}
                        {successDetails && (
                            <div className="w-full bg-[#EFF4F9] border border-[#CBD7E6] rounded-none p-4 my-4 text-left font-sans text-xs space-y-2 shadow-2xs">
                                <div className="flex justify-between items-center text-gray-600">
                                    <span className="font-bold text-[10px] uppercase tracking-wider text-gray-400">Total Settled</span>
                                    <span className="font-black text-gray-900 text-sm font-mono">₱{successDetails.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                                {successDetails.paymentMethod === 'cash' ? (
                                    <>
                                        <div className="flex justify-between items-center text-gray-600">
                                            <span className="font-bold text-[10px] uppercase tracking-wider text-gray-400">Cash Tendered</span>
                                            <span className="font-black text-gray-900 text-sm font-mono">₱{successDetails.cashGiven.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                        <div className="h-px bg-[#CBD7E6]/70 my-1"></div>
                                        <div className="flex justify-between items-center text-[#1B3B6A] font-extrabold">
                                            <span className="text-[10px] uppercase tracking-wider">Change Given</span>
                                            <span className="text-lg font-black font-mono">₱{successDetails.change.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex justify-between items-center text-gray-600">
                                            <span className="font-bold text-[10px] uppercase tracking-wider text-gray-400">Channel</span>
                                            <span className="font-black text-[#1B3B6A] uppercase text-xs tracking-wider">{successDetails.paymentMethod}</span>
                                        </div>
                                        {successDetails.reference && (
                                            <div className="flex justify-between items-center text-gray-600">
                                                <span className="font-bold text-[10px] uppercase tracking-wider text-gray-400">Ref Code</span>
                                                <span className="font-mono text-xs font-bold text-gray-800 bg-white border border-gray-200 px-2 py-0.5 rounded-none shadow-2xs select-all">{successDetails.reference}</span>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        )}

                        <div className="w-full space-y-2 mt-1">
                            <button
                                onClick={() => onPrintReceipt(lastTransactionId)}
                                className="w-full py-3 bg-[#1B3B6A] text-white font-bold rounded-none shadow-md hover:bg-[#142E54] active:scale-95 transition-all flex items-center justify-center gap-2 text-xs cursor-pointer"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                {showFKeys ? <>Print Receipt<span className="hidden md:inline"> (Enter)</span></> : "Print Receipt"}
                            </button>

                            <button
                                onClick={handleNewOrder}
                                className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 font-bold rounded-none hover:bg-gray-50 active:scale-95 transition-all text-xs cursor-pointer shadow-2xs"
                            >
                                New Order<span className="hidden md:inline"> (Esc)</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}