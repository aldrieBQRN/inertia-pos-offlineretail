import React, { useState, useEffect, useMemo, useRef } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, usePage } from '@inertiajs/react';
import axios from 'axios';
import useCartStore from '@/Stores/useCartStore';
import usePrinterStore from '@/Stores/usePrinterStore';
import CartSidebar from '@/Components/CartSidebar';
import OpenShiftModal from '@/Components/OpenShiftModal';
import ShiftModal from '@/Components/ShiftModal';
import CashMovementModal from '@/Components/CashMovementModal';
import Swal from 'sweetalert2';

/**
 * PosTerminal Component
 */
export default function PosTerminal({ auth, store_settings, settings, initial_shift_data, initial_terminals, initial_categories, initial_products, initial_held_orders }) {
    const { props } = usePage();

    // Combine all possible settings sources
    const activeSettings = {
        ...(auth?.user?.store || {}),
        ...(props.store_settings || {}),
        ...(props.settings || {}),
        ...(store_settings || {}),
        ...(settings || {})
    };

    const shortcutsEnabled = localStorage.getItem('pos_enable_shortcuts') !== 'false';

    const [products, setProducts] = useState(() => initial_products || props.initial_products || []);
    const [categories, setCategories] = useState(() => initial_categories || props.initial_categories || []);
    const [isLoading, setIsLoading] = useState(() => {
        const prods = initial_products || props.initial_products;
        return !prods || prods.length === 0;
    });

    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
    const [categoryNavIndex, setCategoryNavIndex] = useState(-1);
    const [isMobileCartOpen, setIsMobileCartOpen] = useState(false);
    const [showHeldOrdersModal, setShowHeldOrdersModal] = useState(false);
    const [heldOrders, setHeldOrders] = useState(() => initial_held_orders || props.initial_held_orders || []);
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [showDiscountModal, setShowDiscountModal] = useState(false);
    const [isMobile, setIsMobile] = useState(false);

    // Shift Lifecycle & Cash Movement States
    const [shiftData, setShiftData] = useState(() => initial_shift_data || props.initial_shift_data || null);
    const [showOpenShiftModal, setShowOpenShiftModal] = useState(false);
    const [showCloseShiftModal, setShowCloseShiftModal] = useState(false);
    const [showCashMovementModal, setShowCashMovementModal] = useState(false);

    // Cash register on this device (the standalone POS has a single register)
    const [terminals, setTerminals] = useState(() => initial_terminals || props.initial_terminals || []);
    const [currentTerminal, setCurrentTerminal] = useState(() => {
        const termList = initial_terminals || props.initial_terminals || [];
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('pos_terminal_id') : null;
        if (savedId && termList.length > 0) {
            const found = termList.find(t => String(t.id) === String(savedId));
            if (found) return found;
        }
        return termList.length > 0 ? termList[0] : null;
    });

    // Client revision state variables
    const [isWholesaleActive, setIsWholesaleActive] = useState(false);
    const [showResultsOnly, setShowResultsOnly] = useState(() => {
        return localStorage.getItem('pos_show_results_only') === 'true';
    });
    const [showQtyModal, setShowQtyModal] = useState(false);
    const [qtyModalProduct, setQtyModalProduct] = useState(null);
    const [qtyModalInput, setQtyModalInput] = useState('1');
    const [isQtyEditMode, setIsQtyEditMode] = useState(false);
    const [productNavIndex, setProductNavIndex] = useState(-1);
    const [heldOrdersNavIndex, setHeldOrdersNavIndex] = useState(-1);
    const [showFKeys, setShowFKeys] = useState(true);
    const [productView, setProductView] = useState(() => localStorage.getItem('pos_product_view') || 'list');

    const qtyInputRef = useRef(null);
    const qtyModalRef = useRef(null);

    useEffect(() => {
        if (showQtyModal) {
            const timer = setTimeout(() => {
                if (qtyInputRef.current) {
                    qtyInputRef.current.focus();
                    qtyInputRef.current.select();
                }
            }, 60);
            return () => clearTimeout(timer);
        }
    }, [showQtyModal]);

    const fetchTerminalsAndShift = async (targetTerminalId = null) => {
        try {
            const termRes = await axios.get('/api/terminals');
            const termList = termRes.data || [];
            setTerminals(termList);

            let selectedTerm = null;
            if (targetTerminalId) {
                selectedTerm = termList.find(t => String(t.id) === String(targetTerminalId));
            } else {
                const savedId = localStorage.getItem('pos_terminal_id');
                selectedTerm = termList.find(t => String(t.id) === String(savedId));
                if (!selectedTerm && termList.length > 0) {
                    selectedTerm = termList[0];
                }
            }

            if (selectedTerm) {
                localStorage.setItem('pos_terminal_id', selectedTerm.id);
                setCurrentTerminal(selectedTerm);
            }

            const shiftRes = await axios.get('/api/shift/current', {
                params: { terminal_id: selectedTerm?.id }
            });
            setShiftData(shiftRes.data);
        } catch (e) {
            console.error("Failed to fetch terminals and shift status:", e);
        }
    };

    const fetchCurrentShift = async () => {
        if (!currentTerminal) {
            fetchTerminalsAndShift();
            return;
        }
        try {
            const res = await axios.get('/api/shift/current', {
                params: { terminal_id: currentTerminal?.id }
            });
            setShiftData(res.data);
        } catch (e) {
            console.error("Failed to fetch shift status:", e);
        }
    };

    // Bumped on every list request and every local removal, so an older response can never
    // overwrite newer held-order state (e.g. resurrect an order that was just discarded/recalled).
    const heldOrdersVersionRef = useRef(0);

    // Resolves with the held orders list, or null if the response is stale.
    const requestHeldOrders = async () => {
        const version = ++heldOrdersVersionRef.current;
        const res = await axios.get('/api/held-orders');
        return version === heldOrdersVersionRef.current ? (res.data || []) : null;
    };

    const loadHeldOrders = async () => {
        try {
            const data = await requestHeldOrders();
            if (data) setHeldOrders(data);
        } catch (e) {
            console.error("Failed to load held orders:", e);
        }
    };

    useEffect(() => {
        fetchTerminalsAndShift();
        loadHeldOrders();

        const handleShiftRefresh = () => {
            fetchCurrentShift();
        };
        const handleHeldOrdersUpdated = () => {
            loadHeldOrders();
        };
        window.addEventListener('shift-refresh', handleShiftRefresh);
        window.addEventListener('held-orders-updated', handleHeldOrdersUpdated);
        return () => {
            window.removeEventListener('shift-refresh', handleShiftRefresh);
            window.removeEventListener('held-orders-updated', handleHeldOrdersUpdated);
        };
    }, []);

    useEffect(() => {
        localStorage.setItem('pos_show_results_only', showResultsOnly);
    }, [showResultsOnly]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
            setShowFKeys(shortcutsEnabled && window.innerWidth >= 1024);
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [shortcutsEnabled]);


    const isPolling = useRef(false);
    const lastSearchInputTime = useRef(0);
    const searchInputRef = useRef(null);
    const catalogContainerRef = useRef(null);

    useEffect(() => {
        // Automatically focus search input after a completed checkout on laptop/desktop
        const handleTransactionCompleted = () => {
            if (searchInputRef.current && window.innerWidth >= 1024) {
                setTimeout(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                }, 100);
            }
        };
        window.addEventListener('transaction-completed', handleTransactionCompleted);
        return () => window.removeEventListener('transaction-completed', handleTransactionCompleted);
    }, []);

    useEffect(() => {
        setProductNavIndex(-1);
    }, [searchQuery]);

    useEffect(() => {
        if (productNavIndex === -1) {
            if (catalogContainerRef.current) {
                catalogContainerRef.current.scrollTo({
                    top: 0,
                    behavior: 'smooth'
                });
            }
        } else {
            const element = document.querySelector(`[data-catalog-item-index="${productNavIndex}"]`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [productNavIndex]);

    useEffect(() => {
        if (showHeldOrdersModal && heldOrdersNavIndex !== -1) {
            const element = document.querySelector(`[data-held-order-index="${heldOrdersNavIndex}"]`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [heldOrdersNavIndex, showHeldOrdersModal]);

    useEffect(() => {
        const handleCloseDropdown = () => {
            setShowCategoryDropdown(false);
            setCategoryNavIndex(-1);
        };
        const handleResetCatalog = () => {
            setProductNavIndex(-1);
        };
        const handleDocClick = (e) => {
            if (showPaymentModal || showQtyModal || showHeldOrdersModal) return;
            if (!e.target.closest('[data-catalog-item-index]') && !e.target.closest('input')) {
                setProductNavIndex(-1);
            }
        };
        window.addEventListener('close-category-dropdown', handleCloseDropdown);
        window.addEventListener('reset-catalog-nav', handleResetCatalog);
        document.addEventListener('click', handleDocClick);
        return () => {
            window.removeEventListener('close-category-dropdown', handleCloseDropdown);
            window.removeEventListener('reset-catalog-nav', handleResetCatalog);
            document.removeEventListener('click', handleDocClick);
        };
    }, [showPaymentModal, showQtyModal, showHeldOrdersModal]);

    // Global key listener for main POS screen
    useEffect(() => {
        const handlePOSKeys = (e) => {
            if (showQtyModal) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closeQtyModal();
                }
                return;
            }

            // Suspend POS shortcuts if ANY modal is open
            if (showPaymentModal || showDiscountModal || showOpenShiftModal || showCloseShiftModal || showCashMovementModal) {
                return;
            }

            const isFKey = e.key?.match(/^F[1-9]$|^F1[0-2]$/);

            // If F-keys shortcuts are disabled, do not intercept or execute them
            if (isFKey && !shortcutsEnabled) {
                return;
            }

            // Intercept and prevent browser native defaults for POS F-keys
            if (isFKey) {
                e.preventDefault();
            }

            const isControlKey = e.key === 'Escape' || e.key === 'Enter';
            const isNavKey = (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
                (showCategoryDropdown || showHeldOrdersModal);

            // Ignore if standard typing in input/textarea (unless it's an F-key, control key, or active nav key)
            if (!isFKey && !isControlKey && !isNavKey && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
                return;
            }

            if (isFKey) {
                if (['F1', 'F2', 'F4', 'F5'].includes(e.key)) {
                    window.dispatchEvent(new CustomEvent('reset-cart-nav'));
                }
                setTimeout(() => {
                    setProductNavIndex(-1);
                }, 0);
            }

            // If Category Dropdown is open, handle navigation keys
            if (showCategoryDropdown) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setCategoryNavIndex(prev => Math.min(prev + 1, categories.length));
                    return;
                }
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setCategoryNavIndex(prev => Math.max(prev - 1, 0));
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowCategoryDropdown(false);
                    setCategoryNavIndex(-1);
                    return;
                }
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (categoryNavIndex === 0) {
                        setSelectedCategory('all');
                        setShowCategoryDropdown(false);
                        setCategoryNavIndex(-1);
                    } else if (categoryNavIndex > 0 && categoryNavIndex <= categories.length) {
                        setSelectedCategory(categories[categoryNavIndex - 1].id);
                        setShowCategoryDropdown(false);
                        setCategoryNavIndex(-1);
                    }
                    return;
                }
            }

            // Handle held orders key navigation when that modal is open
            if (showHeldOrdersModal) {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (heldOrders.length > 0) {
                        setHeldOrdersNavIndex(prev => Math.min(prev + 1, heldOrders.length - 1));
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (heldOrders.length > 0) {
                        setHeldOrdersNavIndex(prev => Math.max(prev - 1, 0));
                    }
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowHeldOrdersModal(false);
                    setHeldOrdersNavIndex(-1);
                } else if (e.key === 'Enter' || e.key === 'F8') {
                    e.preventDefault();
                    if (heldOrdersNavIndex !== -1 && heldOrdersNavIndex < heldOrders.length) {
                        handleRecallOrder(heldOrders[heldOrdersNavIndex]);
                    }
                } else if (e.key === 'Backspace' || e.key === 'Delete' || e.code === 'Backspace' || e.code === 'Delete') {
                    e.preventDefault();
                    if (heldOrdersNavIndex !== -1 && heldOrdersNavIndex < heldOrders.length) {
                        handleDiscardHeldOrder(heldOrders[heldOrdersNavIndex]);
                    }
                }
                return;
            }

            // Suspend POS shortcuts if checkout modal is open
            if (showPaymentModal) {
                return;
            }

            if (e.key === 'F1') {
                // Blur search input to prevent input character pollution and free arrow keys
                if (searchInputRef.current) {
                    searchInputRef.current.blur();
                }
                // Reset cart navigation selection
                window.dispatchEvent(new CustomEvent('reset-cart-nav'));

                setShowCategoryDropdown(prev => {
                    const next = !prev;
                    setCategoryNavIndex(-1);
                    return next;
                });
            } else if (e.key === 'F2') {
                // Close category dropdown
                setShowCategoryDropdown(false);
                setCategoryNavIndex(-1);
                // Reset cart navigation selection
                window.dispatchEvent(new CustomEvent('reset-cart-nav'));
                // Toggle focus search input
                if (searchInputRef.current) {
                    if (document.activeElement === searchInputRef.current) {
                        searchInputRef.current.blur();
                    } else {
                        searchInputRef.current.focus();
                        searchInputRef.current.select();
                    }
                }
            } else if (e.key === 'F3') {
                setIsWholesaleActive(prev => !prev);
            } else if (e.key === 'F4') {
                // Open the shared Cash In / Cash Out modal (existing implementation)
                setShowCashMovementModal(true);
            } else if (e.key === 'F5') {
                if (shiftData?.has_active_shift) {
                    setShowCloseShiftModal(true);
                } else {
                    setShowOpenShiftModal(true);
                }
            } else if (e.key === 'F6') {
                setProductView(prev => {
                    const next = prev === 'list' ? 'card' : 'list';
                    localStorage.setItem('pos_product_view', next);
                    return next;
                });
            } else if (e.key === 'F8') {
                fetchHeldOrders();
            }
        };

        window.addEventListener('keydown', handlePOSKeys);
        return () => window.removeEventListener('keydown', handlePOSKeys);
    }, [showPaymentModal, showQtyModal, showHeldOrdersModal, showOpenShiftModal, showCloseShiftModal, showCashMovementModal, showCategoryDropdown, categoryNavIndex, categories, heldOrders, heldOrdersNavIndex, shortcutsEnabled, shiftData]);

    const cart = useCartStore((state) => state.cart);
    const addToCart = useCartStore((state) => state.addToCart);
    const setCart = useCartStore((state) => state.setCart);
    const getComputations = useCartStore((state) => state.getComputations);
    const printReceipt = usePrinterStore((state) => state.printReceipt);

    const { total } = getComputations ? getComputations() : { total: 0 };

    const loadProductsAndCategories = async (showLoading = false) => {
        if (showLoading && products.length === 0) setIsLoading(true);
        try {
            const [prodRes, catRes] = await Promise.all([
                axios.get('/api/products?all=true&active=true'),
                axios.get('/api/categories')
            ]);
            setProducts(prodRes.data);
            setCategories(catRes.data);
        } catch (error) {
            console.error("Error loading products/categories:", error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadProductsAndCategories(false);

        const interval = setInterval(async () => {
            if (isPolling.current) return;
            isPolling.current = true;
            try {
                const res = await axios.get('/api/products?all=true&active=true');
                setProducts(res.data || []);
            } catch (e) { console.warn("Sync failed."); }
            finally { isPolling.current = false; }
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    const filteredProducts = useMemo(() => {
        if (showResultsOnly && !searchQuery.trim()) {
            return [];
        }
        let result = [...products];
        if (selectedCategory !== 'all') {
            result = result.filter(p => p.category_id === selectedCategory);
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter(p => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q));
        }

        // Deterministic, consistent sorting:
        // Group alphabetically by category, then sort alphabetically by product name, tie-break by ID
        result.sort((a, b) => {
            if (selectedCategory === 'all' && !searchQuery) {
                const catA = a.category?.name || 'zz';
                const catB = b.category?.name || 'zz';
                const catComp = catA.localeCompare(catB);
                if (catComp !== 0) return catComp;
            }
            const nameA = a.name || '';
            const nameB = b.name || '';
            const nameComp = nameA.localeCompare(nameB);
            if (nameComp !== 0) return nameComp;
            return (a.id || 0) - (b.id || 0);
        });

        return result;
    }, [products, selectedCategory, searchQuery, showResultsOnly]);

    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filteredProducts.length > 0) {
                setProductNavIndex(prev => Math.min(prev + 1, filteredProducts.length - 1));
            }
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filteredProducts.length > 0) {
                setProductNavIndex(prev => Math.max(prev - 1, -1));
            }
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();

            // If an item in the search results is highlighted via arrow keys, select it
            if (productNavIndex !== -1 && productNavIndex < filteredProducts.length) {
                const selectedProd = filteredProducts[productNavIndex];
                const inCart = cart.find(item => item.id === selectedProd.id);
                const remainingStock = selectedProd.stock_quantity - (inCart ? inCart.quantity : 0);
                if (remainingStock > 0) {
                    new Audio('/beep.mp3').play().catch(() => {});
                    triggerQtyModal(selectedProd);
                    setProductNavIndex(-1);
                } else {
                    Swal.fire({ icon: 'error', title: 'Out of Stock', text: 'Catalog stock limit reached.', toast: true, position: 'top', showConfirmButton: false, timer: 1500 });
                }
                return;
            }

            // Default SKU search enter key behavior
            const timeDiff = Date.now() - lastSearchInputTime.current;
            // Ignore automatic trailing Enter sent by barcode scanners (usually <120ms of typing).
            if (timeDiff < 120) {
                return;
            }
            let p = products.find(prod => prod.sku === searchQuery.trim());
            if (!p && filteredProducts.length === 1) {
                p = filteredProducts[0];
            }
            if (p) {
                new Audio('/beep.mp3').play().catch(() => {});
                triggerQtyModal(p);
            }
        } else {
            lastSearchInputTime.current = Date.now();
        }
    };

    const triggerQtyModal = (product, isEdit = false) => {
        if (!isEdit) {
            window.dispatchEvent(new CustomEvent('reset-cart-nav'));
        }
        const inCart = cart.find(item => item.id === product.id);
        const currentQty = inCart ? inCart.quantity : 0;
        if (!isEdit && currentQty >= product.stock_quantity) {
            Swal.fire({ icon: 'error', title: 'Out of Stock', text: 'Catalog stock limit reached.', toast: true, position: 'top', showConfirmButton: false, timer: 1500 });
            return;
        }
        setQtyModalProduct(product);
        setQtyModalInput(isEdit ? String(product.quantity) : '1');
        setIsQtyEditMode(isEdit);
        setShowQtyModal(true);
        if (searchInputRef.current) searchInputRef.current.blur();
    };

    const closeQtyModal = () => {
        setShowQtyModal(false);
        setQtyModalProduct(null);
        setIsQtyEditMode(false);
        setTimeout(() => {
            if (searchInputRef.current && window.innerWidth >= 1024) {
                searchInputRef.current.focus();
                searchInputRef.current.select();
            }
        }, 50);
    };

    const handleConfirmQty = (e) => {
        if (e) e.preventDefault();
        const qty = parseInt(qtyModalInput, 10);
        if (isNaN(qty) || qty <= 0) {
            Swal.fire({ icon: 'error', title: 'Invalid Quantity', text: 'Please enter a valid positive number.', toast: true, position: 'top', showConfirmButton: false, timer: 1500 });
            return;
        }

        if (qty > qtyModalProduct.stock_quantity) {
            Swal.fire({
                icon: 'error',
                title: 'Limit Reached',
                text: `Only ${qtyModalProduct.stock_quantity} items available in stock.`,
                toast: true,
                position: 'top',
                showConfirmButton: false,
                timer: 2000
            });
            return;
        }

        const appliedPrice = (isWholesaleActive && qtyModalProduct.wholesale_price !== null && qtyModalProduct.wholesale_price !== undefined)
            ? qtyModalProduct.wholesale_price
            : qtyModalProduct.price;

        if (isQtyEditMode) {
            const updatedCart = cart.map(item => item.id === qtyModalProduct.id ? { ...item, quantity: qty } : item);
            setCart(updatedCart);
        } else {
            addToCart(qtyModalProduct, qty, appliedPrice);
        }

        setShowQtyModal(false);
        setQtyModalProduct(null);
        setIsQtyEditMode(false);
        setSearchQuery('');

        setTimeout(() => {
            const searchInput = document.querySelector('input[placeholder*="Search"]');
            if (searchInput && window.innerWidth >= 1024) searchInput.focus();
        }, 100);
    };



    const handlePrintReceipt = async (trxId) => {
        try {
            const res = await axios.get(`/api/transactions/${trxId}`);
            await printReceipt(res.data, activeSettings);
        } catch (err) { console.error("Receipt Print Error:", err); }
    };

    const fetchHeldOrders = () => {
        setShowHeldOrdersModal(true);
        setHeldOrdersNavIndex(heldOrders.length > 0 ? 0 : -1);
        if (searchInputRef.current) searchInputRef.current.blur();

        requestHeldOrders()
            .then(data => {
                if (!data) return;
                setHeldOrders(data);
                setHeldOrdersNavIndex(prev => {
                    if (data.length === 0) return -1;
                    return prev >= 0 && prev < data.length ? prev : 0;
                });
            })
            .catch(err => {
                console.error("Failed to refresh held orders:", err);
            });
    };

    const handleRecallOrder = async (order) => {
        const result = await Swal.fire({
            title: 'Recall Order?',
            text: `Replace current cart with "${order.reference_note || 'Untitled'}"?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Yes, recall',
            cancelButtonText: 'Cancel'
        });

        if (!result.isConfirmed) return;

        // Fetch fresh product catalog to check live stock levels
        let currentProducts = products;
        try {
            const res = await axios.get('/api/products', { params: { all: true } });
            if (Array.isArray(res.data)) {
                currentProducts = res.data;
                setProducts(res.data);
            } else if (res.data?.data && Array.isArray(res.data.data)) {
                currentProducts = res.data.data;
                setProducts(res.data.data);
            }
        } catch (e) {
            console.warn("Could not fetch latest products for recall, using local state:", e);
        }

        const validCart = [];
        const soldOutItems = [];
        const adjustedItems = [];

        (order.cart_data || []).forEach(item => {
            // Custom items (by weight / manual) have no catalog stock constraint
            if (!item.id || item.is_custom) {
                validCart.push(item);
                return;
            }

            const liveProduct = currentProducts.find(p => p.id === item.id);

            // If product was deleted or currently has 0 stock
            if (!liveProduct || (liveProduct.stock_quantity ?? 0) <= 0) {
                soldOutItems.push(item.name || 'Unknown Product');
                return;
            }

            // If available stock is less than saved quantity, adjust quantity to max available
            if (liveProduct.stock_quantity < item.quantity) {
                adjustedItems.push(`${item.name || 'Product'} (reduced from ${item.quantity} to ${liveProduct.stock_quantity})`);
                validCart.push({
                    ...item,
                    stock_quantity: liveProduct.stock_quantity,
                    quantity: liveProduct.stock_quantity,
                    price: liveProduct.price ?? item.price
                });
            } else {
                // Fully in stock
                validCart.push({
                    ...item,
                    stock_quantity: liveProduct.stock_quantity,
                    price: liveProduct.price ?? item.price
                });
            }
        });

        // If all items in the saved order are now sold out
        if (validCart.length === 0) {
            await Swal.fire({
                icon: 'error',
                title: 'Order Items Sold Out',
                html: `All items in this saved order are currently out of stock:<br><br><div class="text-left bg-red-50 p-3 rounded-none border border-red-200 text-xs text-red-700 font-semibold space-y-1">${soldOutItems.map(name => `• ${name} (Sold Out)`).join('<br>')}</div><br>The order cannot be restored to the cart.`,
                confirmButtonColor: '#EF4444',
                confirmButtonText: 'Understood'
            });
            return;
        }

        // Apply available items to cart
        setCart(validCart);
        heldOrdersVersionRef.current++;
        setHeldOrders(prev => prev.filter(o => o.id !== order.id));
        setShowHeldOrdersModal(false);
        setHeldOrdersNavIndex(-1);
        if (window.innerWidth < 768) setIsMobileCartOpen(true);

        // Delete from held orders in DB
        try {
            await axios.delete(`/api/held-orders/${order.id}`);
        } catch (err) {
            console.error("Failed to delete held order after recall:", err);
            loadHeldOrders();
        }

        // Alert user if some items were sold out or adjusted
        if (soldOutItems.length > 0 || adjustedItems.length > 0) {
            let alertHtml = '';
            if (soldOutItems.length > 0) {
                alertHtml += `<div class="text-left bg-red-50 p-2.5 rounded-none border border-red-200 text-xs text-red-700 font-medium space-y-1 mb-2"><strong>Sold out items removed from cart:</strong><br>${soldOutItems.map(n => `• ${n}`).join('<br>')}</div>`;
            }
            if (adjustedItems.length > 0) {
                alertHtml += `<div class="text-left bg-amber-50 p-2.5 rounded-none border border-amber-200 text-xs text-amber-800 font-medium space-y-1"><strong>Quantities adjusted to available stock:</strong><br>${adjustedItems.map(n => `• ${n}`).join('<br>')}</div>`;
            }

            Swal.fire({
                icon: 'warning',
                title: 'Some Items Are Sold Out',
                html: alertHtml,
                confirmButtonColor: '#1B3A69',
                confirmButtonText: 'Continue with Available Items'
            });
        } else {
            Swal.fire({
                icon: 'success',
                title: 'Order Recalled',
                text: `"${order.reference_note || 'Saved Order'}" restored to cart.`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000
            });
        }
    };

    const handleDiscardHeldOrder = async (order) => {
        const result = await Swal.fire({
            title: 'Discard Order?',
            text: `Are you sure you want to delete "${order.reference_note || 'Untitled'}"?`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#EF4444',
            confirmButtonText: 'Yes, discard it',
            cancelButtonText: 'Cancel'
        });
        if (result.isConfirmed) {
            heldOrdersVersionRef.current++;
            setHeldOrders(prev => {
                const next = prev.filter(o => o.id !== order.id);
                setHeldOrdersNavIndex(curr => (next.length === 0 ? -1 : Math.min(curr, next.length - 1)));
                return next;
            });
            try {
                await axios.delete(`/api/held-orders/${order.id}`);
            } catch (error) {
                console.error("Failed to discard held order:", error);
                loadHeldOrders();
            }
        }
    };

    const isAnyModalOpen = Boolean(
        showPaymentModal || 
        showDiscountModal ||
        showQtyModal || 
        showHeldOrdersModal || 
        showOpenShiftModal || 
        showCloseShiftModal ||
        showCashMovementModal
    );
    const activeCat = categories.find(c => c.id === selectedCategory);
    const themeColor = activeCat?.color || '#3B82F6';

    return (
        <AuthenticatedLayout user={auth.user}>
            <Head title="POS Terminal" />

            <div className="pos-terminal flex h-full bg-white overflow-hidden relative">

                {/* LEFT: CART SIDEBAR (50/50 splits) */}
                <div className={`flex-1 md:w-1/2 flex-col min-w-0 h-full bg-white ${isMobileCartOpen ? 'flex fixed inset-0 z-50 bg-white' : 'hidden md:flex'}`}>
                    <CartSidebar
                        settings={activeSettings}
                        shiftData={shiftData}
                        onOpenShift={() => setShowOpenShiftModal(true)}
                        onCloseShift={() => setShowCloseShiftModal(true)}
                        showPaymentModal={showPaymentModal}
                        setShowPaymentModal={setShowPaymentModal}
                        showDiscountModal={showDiscountModal}
                        setShowDiscountModal={setShowDiscountModal}
                        onPrintReceipt={handlePrintReceipt}
                        onRecallClick={fetchHeldOrders}
                        heldOrdersCount={heldOrders.length}
                        onEditItemQty={(item) => triggerQtyModal(item, true)}
                        onCheckoutSuccess={() => fetchCurrentShift()}
                        onClose={isMobile ? () => setIsMobileCartOpen(false) : undefined}
                        disabled={isAnyModalOpen}
                        showFKeys={showFKeys}
                        enableShortcuts={shortcutsEnabled}
                    />
                </div>

                {/* RIGHT PANEL: PRODUCT LISTING (50/50 splits) */}
                <div className={`w-full md:w-1/2 md:flex-1 min-w-0 bg-white border-l border-gray-200 flex-col h-full ${isMobileCartOpen ? 'hidden md:flex' : 'flex'}`}>

                    {/* COMPACT TOOLBAR */}
                    <div className="p-3 bg-white border-b border-gray-200 flex flex-col gap-2.5 shadow-2xs z-30 shrink-0 relative">
                        {/* Shift & Terminal Status Bar */}
                        <div className="flex items-center justify-between px-1 py-0.5 text-xs overflow-x-auto no-scrollbar scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] whitespace-nowrap shrink-0">
                                <span className="font-extrabold text-slate-700 uppercase tracking-wider font-mono flex items-center gap-1 shrink-0">
                                    <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0H3" /></svg>
                                    {currentTerminal?.name || 'Main Register'}
                                </span>

                                <span className="text-slate-300">·</span>

                                {shiftData?.has_active_shift ? (
                                    <div className="flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0">
                                        <span className="font-semibold text-slate-700">Shift #{shiftData.shift.id} Active</span>
                                        <span className="text-slate-300">·</span>
                                        <span className="text-slate-600 font-mono">Float: {Number(shiftData.starting_cash || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        <span className="text-slate-300">·</span>
                                        <span className="text-[#1B3B6A] font-bold font-mono">Drawer: {Number(shiftData.running_expected_cash || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                ) : (
                                    <span className="text-slate-500 font-medium whitespace-nowrap">No Active Shift · Selling Blocked</span>
                                )}
                            </div>
                        </div>

                        {/* Row 1: Category & Search */}
                        <div className="flex gap-2 items-center w-full">
                            <div className="relative z-40">
                                <button
                                    onClick={() => {
                                        if (isAnyModalOpen) return;
                                        if (searchInputRef.current) {
                                            searchInputRef.current.blur();
                                        }
                                        window.dispatchEvent(new CustomEvent('reset-cart-nav'));
                                        setShowCategoryDropdown(!showCategoryDropdown);
                                        setCategoryNavIndex(-1);
                                    }}
                                    disabled={isAnyModalOpen}
                                    className={`px-2.5 sm:px-3.5 h-[38px] rounded-none border transition-all flex items-center gap-1.5 text-xs sm:text-sm font-bold shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed outline-none focus:outline-none ${selectedCategory === 'all' ? 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50' : 'bg-[#EFF4F9] text-[#1B3B6A] border-[#CBD7E6] font-extrabold'}`}
                                    title={showFKeys ? "Category Filter (F1)" : "Category Filter"}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
                                    {showFKeys ? (
                                        <span className="flex items-center gap-1">
                                            <span className="hidden sm:inline">Category</span>
                                            <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-gray-100 text-gray-600">F1</span>
                                        </span>
                                    ) : (
                                        <span className="hidden sm:inline">Category</span>
                                    )}
                                </button>
                                {showCategoryDropdown && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => { setShowCategoryDropdown(false); setCategoryNavIndex(-1); }}></div>
                                        <div className="absolute top-full left-0 mt-1.5 w-64 bg-white rounded-none shadow-xl border border-gray-200/90 z-50 py-1.5 animate-fade-in-up max-h-[60vh] overflow-y-auto custom-scrollbar">
                                            <button
                                                onClick={() => {setSelectedCategory('all'); setShowCategoryDropdown(false); setCategoryNavIndex(-1); window.dispatchEvent(new CustomEvent('reset-cart-nav'));}}
                                                className={`w-full text-left px-4 py-2 text-xs font-bold transition-colors flex items-center justify-between outline-none focus:outline-none ${
                                                    categoryNavIndex === 0 || selectedCategory === 'all'
                                                        ? 'bg-[#EFF4F9] text-[#1B3B6A]'
                                                        : 'text-gray-700 hover:bg-gray-50'
                                                }`}
                                            >
                                                <span>{showFKeys ? "All Categories (F1)" : "All Categories"}</span>
                                                {selectedCategory === 'all' && (
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#1B3B6A]"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                                                )}
                                            </button>
                                            {categories.map((c, idx) => {
                                                const isHighlighted = categoryNavIndex === (idx + 1);
                                                const isSelected = selectedCategory === c.id;
                                                const isActive = isHighlighted || isSelected;
                                                return (
                                                    <button
                                                        key={c.id}
                                                        onClick={() => {setSelectedCategory(c.id); setShowCategoryDropdown(false); setCategoryNavIndex(-1); window.dispatchEvent(new CustomEvent('reset-cart-nav'));}}
                                                        className={`w-full text-left px-4 py-2 text-xs font-bold flex items-center justify-between transition-colors outline-none focus:outline-none ${
                                                            isActive
                                                                ? 'bg-[#EFF4F9] text-[#1B3B6A]'
                                                                : 'text-gray-700 hover:bg-gray-50'
                                                        }`}
                                                    >
                                                        <span className={`truncate ${isActive ? 'text-[#1B3B6A] font-extrabold' : 'text-gray-700'}`}>{c.name}</span>
                                                        {isSelected && (
                                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-[#1B3B6A] shrink-0"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className="relative flex-1 group">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <svg className="w-4 h-4 text-slate-400 group-focus-within:text-[#1B3B6A] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                </div>
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder="Search product or scan barcode..."
                                    className="w-full pl-9 pr-12 h-[38px] rounded-none bg-white border border-slate-300 hover:border-slate-400 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/15 transition-all outline-none text-xs sm:text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal shadow-2xs disabled:bg-gray-50 disabled:cursor-not-allowed"
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); window.dispatchEvent(new CustomEvent('reset-cart-nav')); }}
                                    onKeyDown={handleSearchKeyDown}
                                    onFocus={() => { window.dispatchEvent(new CustomEvent('reset-cart-nav')); }}
                                    onBlur={() => { setProductNavIndex(-1); }}
                                    disabled={isAnyModalOpen}
                                />
                                <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center gap-1">
                                    {searchQuery ? (
                                        <button
                                            type="button"
                                            onClick={() => { setSearchQuery(''); searchInputRef.current?.focus(); }}
                                            className="p-1 text-slate-400 hover:text-slate-600 rounded-none hover:bg-slate-100 transition-colors cursor-pointer"
                                            title="Clear search"
                                        >
                                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                        </button>
                                    ) : showFKeys ? (
                                        <kbd className="hidden sm:inline-flex items-center text-[10px] font-black font-mono px-1.5 py-0.5 rounded-none bg-slate-100 text-slate-500 border border-slate-200 select-none shadow-2xs">
                                            F2
                                        </kbd>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        {/* Row 2: Wholesale Toggle & Action/View Controls */}
                        <div className="flex items-center justify-between w-full gap-2 flex-nowrap overflow-x-auto custom-scrollbar-none">
                            <label className="flex items-center cursor-pointer select-none shrink-0 py-0.5">
                                <div className="relative shrink-0 flex items-center">
                                    <input
                                        type="checkbox"
                                        checked={isWholesaleActive}
                                        onChange={() => !isAnyModalOpen && setIsWholesaleActive(!isWholesaleActive)}
                                        disabled={isAnyModalOpen}
                                        className="sr-only"
                                    />
                                    <div className={`rounded-none transition-colors ${isWholesaleActive ? 'bg-[#1B3B6A]' : 'bg-gray-300'} w-[32px] h-[18px] sm:w-[36px] sm:h-[20px]`}></div>
                                    <div className={`absolute left-[2px] top-[2px] bg-white w-[14px] h-[14px] sm:w-[16px] sm:h-[16px] rounded-none transition-transform shadow-2xs ${isWholesaleActive ? 'transform translate-x-[14px] sm:translate-x-[16px]' : ''}`}></div>
                                </div>
                                <span className="ml-1.5 sm:ml-2 text-xs font-bold text-gray-700 whitespace-nowrap">
                                    {showFKeys ? (
                                        <span className="flex items-center gap-1">
                                            <span className="hidden lg:inline">Wholesale</span>
                                            <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-gray-100 text-gray-600">F3</span>
                                        </span>
                                    ) : (
                                        <span>Wholesale</span>
                                    )}
                                </span>
                            </label>

                            {/* Spaced Action Buttons & View Switch */}
                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-nowrap">
                                {/* Cash In / Cash Out (F4) */}
                                <button
                                    type="button"
                                    onClick={() => setShowCashMovementModal(true)}
                                    disabled={isAnyModalOpen}
                                    className="flex items-center gap-1.5 px-2.5 xl:px-3.5 h-[38px] rounded-none border border-[#CBD7E6] bg-[#EFF4F9] hover:bg-[#E2ECF6] text-[#1B3B6A] font-bold text-xs sm:text-sm transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                                    title={showFKeys ? "Cash In / Cash Out (F4)" : "Cash In / Cash Out"}
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>
                                    <span className="hidden lg:inline-flex items-center gap-1">
                                        <span>Cash In / Out</span>
                                        {showFKeys && <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-[#CBD7E6]/60 text-[#1B3B6A]">F4</span>}
                                    </span>
                                </button>

                                {/* Close / Open Shift (F5) */}
                                {shiftData?.has_active_shift ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowCloseShiftModal(true)}
                                        disabled={isAnyModalOpen}
                                        className="flex items-center gap-1.5 px-2.5 xl:px-3.5 h-[38px] rounded-none border border-[#CBD7E6] bg-[#EFF4F9] hover:bg-[#E2ECF6] text-[#1B3B6A] font-bold text-xs sm:text-sm transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                                        title={showFKeys ? "Close Shift & Z-Read (F5)" : "Close Shift"}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                        <span className="hidden lg:inline-flex items-center gap-1">
                                            <span>Close<span className="hidden xl:inline"> Shift</span></span>
                                            {showFKeys && <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-[#CBD7E6]/60 text-[#1B3B6A]">F5</span>}
                                        </span>
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setShowOpenShiftModal(true)}
                                        disabled={isAnyModalOpen}
                                        className="flex items-center gap-1.5 px-2.5 xl:px-3.5 h-[38px] rounded-none border border-[#CBD7E6] bg-[#EFF4F9] hover:bg-[#E2ECF6] text-[#1B3B6A] font-bold text-xs sm:text-sm transition-all shadow-2xs cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
                                        title={showFKeys ? "Open Shift (F5)" : "Open Shift"}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A] shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                                        <span className="hidden lg:inline-flex items-center gap-1">
                                            <span>Open<span className="hidden xl:inline"> Shift</span></span>
                                            {showFKeys && <span className="text-[10px] font-black font-mono px-1 py-0.2 rounded-none bg-[#CBD7E6]/60 text-[#1B3B6A]">F5</span>}
                                        </span>
                                    </button>
                                )}

                                {/* List / Card View Toggle Group (F6) */}
                                <div className="h-[38px] flex items-center rounded-none border border-gray-200 overflow-hidden shadow-2xs bg-gray-100 p-1 shrink-0">
                                    <button
                                        onClick={() => { setProductView('list'); localStorage.setItem('pos_product_view', 'list'); }}
                                        disabled={isAnyModalOpen}
                                        className={`h-full flex items-center gap-1.5 px-2.5 xl:px-3 rounded-none text-xs sm:text-sm font-bold transition-all disabled:cursor-not-allowed cursor-pointer shrink-0 whitespace-nowrap ${
                                            productView === 'list' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'
                                        }`}
                                        title={showFKeys ? "List View (F6)" : "List View"}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" /></svg>
                                        {showFKeys ? (
                                            <span className="hidden lg:inline-flex items-center gap-1">
                                                <span className="hidden xl:inline">List</span>
                                                <span className={`text-[10px] font-black font-mono px-1 py-0.2 rounded-none ${productView === 'list' ? 'bg-gray-100 text-gray-800' : 'bg-gray-200/80 text-gray-600'}`}>F6</span>
                                            </span>
                                        ) : (
                                            <span className="hidden xl:inline">List</span>
                                        )}
                                    </button>

                                    <button
                                        onClick={() => { setProductView('card'); localStorage.setItem('pos_product_view', 'card'); }}
                                        disabled={isAnyModalOpen}
                                        className={`h-full flex items-center gap-1.5 px-2.5 xl:px-3 rounded-none text-xs sm:text-sm font-bold transition-all disabled:cursor-not-allowed cursor-pointer shrink-0 whitespace-nowrap ${
                                            productView === 'card' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'
                                        }`}
                                        title="Card View"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>
                                        <span className="hidden xl:inline">Card</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* PRODUCT LIST COLUMN HEADERS — desktop only, list view only */}
                    {productView === 'list' && (
                        <div className="px-4 py-2.5 bg-gray-50/80 border-b border-gray-200/80 shrink-0 hidden lg:block">
                            <div className="grid grid-cols-[130px_1fr_90px_100px] gap-2 text-gray-500 uppercase text-[10px] font-black tracking-wider whitespace-nowrap">
                                <div>Barcode</div>
                                <div>Product Name / Category</div>
                                <div className="text-right">Stock</div>
                                <div className="text-right">Price</div>
                            </div>
                        </div>
                    )}

                    {/* PRODUCT CATALOG */}
                    <div
                        ref={catalogContainerRef}
                        className={`flex-1 overflow-y-auto custom-scrollbar bg-white ${
                            productView === 'list' ? 'divide-y divide-gray-100/80' : 'p-3.5'
                        }`}
                    >
                        {isLoading ? (
                            <div className={productView === 'card' ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-3' : 'p-3 space-y-2'}>
                                {Array.from({ length: productView === 'card' ? 8 : 6 }).map((_, i) => (
                                    productView === 'card' ? (
                                        <div key={i} className="bg-white rounded-none border border-gray-200/80 p-3.5 animate-pulse shadow-2xs">
                                            <div className="h-24 bg-gray-100 rounded-none mb-2.5"></div>
                                            <div className="h-3.5 bg-gray-200 rounded-none w-3/4 mb-2"></div>
                                            <div className="h-2.5 bg-gray-100 rounded-none w-1/2"></div>
                                        </div>
                                    ) : (
                                        <div key={i} className="bg-white p-3.5 rounded-none border border-gray-200/80 animate-pulse flex justify-between items-center shadow-2xs">
                                            <div className="space-y-2 w-2/3">
                                                <div className="h-3.5 bg-gray-200 rounded-none w-3/4"></div>
                                                <div className="h-2.5 bg-gray-100 rounded-none w-1/2"></div>
                                            </div>
                                            <div className="h-5 bg-gray-200 rounded-none w-16 text-right"></div>
                                        </div>
                                    )
                                ))}
                            </div>
                        ) : filteredProducts.length === 0 ? (
                            <div className="flex flex-col justify-center items-center h-full text-gray-300 py-12 space-y-2">
                                <div className="w-12 h-12 rounded-none bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" /></svg>
                                </div>
                                <p className="text-xs font-bold text-gray-500">
                                    {showResultsOnly && !searchQuery.trim()
                                        ? "Scan barcode or search to display products"
                                        : "No products matched your search"}
                                </p>
                            </div>
                        ) : productView === 'card' ? (
                            /* ── CARD VIEW ── */
                            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3 pb-20">
                                {filteredProducts.map((p, index) => {
                                    const inCart = cart.find(item => item.id === p.id);
                                    const remainingStock = p.stock_quantity - (inCart ? inCart.quantity : 0);
                                    const isSoldOut = remainingStock <= 0;
                                    const isLowStock = !isSoldOut && remainingStock < 10;
                                    const appliedPrice = (isWholesaleActive && p.wholesale_price !== null) ? p.wholesale_price : p.price;
                                    const isHighlighted = productNavIndex === index;

                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => !isSoldOut && triggerQtyModal(p)}
                                            data-catalog-item-index={index}
                                            className={`bg-white rounded-none border transition-all p-2.5 flex flex-col justify-between group relative overflow-hidden shadow-2xs hover:shadow-md ${
                                                isSoldOut
                                                    ? 'opacity-50 cursor-not-allowed border-gray-200 bg-gray-50/50'
                                                    : isHighlighted
                                                        ? 'border-[#1B3B6A]/70 bg-[#EFF4F9]/30 shadow-xs cursor-pointer'
                                                        : 'border-gray-200/80 cursor-pointer hover:border-[#1B3B6A]/40'
                                            }`}
                                        >
                                            {/* Image / Placeholder */}
                                            <div className="h-24 sm:h-26 bg-gray-50/80 rounded-none flex items-center justify-center overflow-hidden relative border border-gray-100 mb-2 shrink-0">
                                                {p.image_path ? (
                                                    <img src={p.image_path} alt={p.name} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                                                ) : (
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-gray-300">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                                    </svg>
                                                )}
                                                {/* Top Badges (SKU & Stock) perfectly aligned */}
                                                <div className="absolute top-1.5 inset-x-1.5 flex items-center justify-between gap-1 pointer-events-none">
                                                    {p.sku ? (
                                                        <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold font-mono bg-white text-slate-700 border border-slate-200 shadow-2xs truncate max-w-[55%] leading-tight pointer-events-auto">
                                                            {p.sku}
                                                        </span>
                                                    ) : (
                                                        <span />
                                                    )}
                                                    <span className={`px-1.5 py-0.5 rounded-none text-[9px] font-bold font-mono shadow-2xs border shrink-0 leading-tight ${
                                                        isSoldOut
                                                            ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                            : isLowStock
                                                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                    }`}>
                                                        {isSoldOut ? 'Sold Out' : `${remainingStock}`}
                                                    </span>
                                                </div>
                                            </div>

                                            {/* Card Body */}
                                            <div className="flex flex-col flex-1 justify-between min-w-0">
                                                <div>
                                                    <div className="h-8 sm:h-9 flex items-start">
                                                        <h3 className="font-bold text-gray-900 text-xs leading-tight line-clamp-2" title={p.name}>
                                                            {p.name}
                                                        </h3>
                                                    </div>
                                                    <div className="h-4 mt-1 flex items-center">
                                                        {p.category ? (
                                                            <span className="inline-flex items-center px-1.5 py-0.2 rounded-none text-[9px] font-bold bg-blue-50 text-blue-700 border border-blue-200/50 truncate max-w-full">
                                                                {p.category.name}
                                                            </span>
                                                        ) : (
                                                            <span className="text-[9px] text-gray-400 font-medium">General</span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="mt-2 pt-1.5 border-t border-gray-100 flex justify-between items-center shrink-0">
                                                    <span className="font-bold font-mono text-[#1B3B6A] text-xs sm:text-sm">
                                                        {(appliedPrice / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                    {!isSoldOut && (
                                                        <div className="w-6 h-6 bg-[#EFF4F9] text-[#1B3B6A] rounded-none flex items-center justify-center text-xs font-black group-hover:bg-[#1B3B6A] group-hover:text-white transition-all shadow-2xs">
                                                            +
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            /* ── LIST VIEW ── */
                            <div className="flex flex-col divide-y divide-gray-100/80">
                                {filteredProducts.map((p, index) => {
                                    const inCart = cart.find(item => item.id === p.id);
                                    const remainingStock = p.stock_quantity - (inCart ? inCart.quantity : 0);
                                    const isSoldOut = remainingStock <= 0;
                                    const appliedPrice = (isWholesaleActive && p.wholesale_price !== null) ? p.wholesale_price : p.price;
                                    const isHighlighted = productNavIndex === index;

                                    return (
                                        <div
                                            key={p.id}
                                            onClick={() => !isSoldOut && triggerQtyModal(p)}
                                            data-catalog-item-index={index}
                                            className={`px-4 py-3 grid grid-cols-[1fr_90px] lg:grid-cols-[130px_1fr_90px_100px] gap-2 items-center cursor-pointer transition-colors hover:bg-gray-50/80 ${isHighlighted ? 'bg-[#EFF4F9]/70 ring-1 ring-inset ring-[#1B3B6A]/40' : ''} ${isSoldOut ? 'opacity-50 cursor-not-allowed bg-gray-50/50' : ''}`}
                                        >
                                            {/* Barcode Column */}
                                            <div className="min-w-0 font-mono text-xs font-bold text-gray-400 select-all hidden lg:block truncate">
                                                {p.sku || '—'}
                                            </div>

                                            {/* Name Column */}
                                            <div className="min-w-0">
                                                <div className="font-bold text-gray-900 text-xs sm:text-sm truncate">{p.name}</div>
                                                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                    {p.sku && (
                                                        <span className="lg:hidden font-mono text-xs font-bold text-gray-400">{p.sku}</span>
                                                    )}
                                                    {p.category && (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-none text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">
                                                            {p.category.name}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Stock Column */}
                                            <div className="text-right hidden lg:block">
                                                <span className={`text-xs sm:text-sm font-bold ${isSoldOut ? 'text-rose-700 font-black' : remainingStock < 10 ? 'text-amber-700' : 'text-gray-700'}`}>
                                                    {isSoldOut ? 'Sold Out' : `${remainingStock}`}
                                                </span>
                                            </div>

                                            {/* Price Column */}
                                            <div className="text-right">
                                                <div className="font-bold text-[#1B3B6A] text-xs sm:text-sm font-mono">
                                                    {(appliedPrice / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </div>
                                                <div className={`lg:hidden text-[10px] font-bold mt-0.5 ${isSoldOut ? 'text-rose-700 font-black' : remainingStock < 10 ? 'text-amber-700' : 'text-gray-500'}`}>
                                                    {isSoldOut ? 'Sold Out' : `${remainingStock} left`}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* MOBILE VIEW ACTIONS */}
                {!isMobileCartOpen && (
                    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 z-40 flex justify-between items-center shadow-2xl">
                        <div className="flex flex-col"><span className="text-[10px] text-gray-500 font-bold uppercase">{cart.length} Items</span><span className="text-lg font-black text-[#1B3B6A] font-mono">{(total/100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                        <button onClick={() => setIsMobileCartOpen(true)} className="bg-[#1B3B6A] text-white px-6 py-2.5 rounded-none font-bold active:scale-95 transition-all shadow-md text-xs cursor-pointer">View Current Order</button>
                    </div>
                )}
            </div>

            {/* HELD ORDERS MODAL */}
            {showHeldOrdersModal && (
                <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4 backdrop-blur-sm transition-opacity">
                    <div className="bg-white w-full max-w-md h-auto max-h-[85vh] sm:max-h-[90vh] rounded-none shadow-2xl border border-gray-200/90 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in">
                        {/* Header */}
                        <div className="bg-[#1B3B6A] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center text-amber-300 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight flex items-center gap-2">
                                        Recall Saved Orders
                                        {showFKeys && <span className="text-[10px] font-mono px-1.5 py-0.2 bg-white/20 text-white rounded-none font-extrabold">F8</span>}
                                    </h2>
                                    <p className="text-xs text-blue-200 font-medium">Select a held transaction to resume checkout</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setShowHeldOrdersModal(false); setHeldOrdersNavIndex(-1); }}
                                className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                                title="Close (Esc)"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        {/* Scrollable list */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 custom-scrollbar bg-white flex flex-col gap-2.5">
                            {heldOrders.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-gray-400 space-y-2">
                                    <div className="w-12 h-12 rounded-none bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                    </div>
                                    <p className="font-bold text-xs text-gray-500">No saved orders found</p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2.5">
                                    {heldOrders.map((order, index) => {
                                        const isSelected = heldOrdersNavIndex === index;
                                        const itemCount = order.cart_data.reduce((acc, item) => acc + item.quantity, 0);
                                        const orderTotal = order.cart_data.reduce((acc, item) => acc + (item.price * item.quantity), 0);
                                        return (
                                            <div
                                                key={order.id}
                                                data-held-order-index={index}
                                                onClick={() => setHeldOrdersNavIndex(index)}
                                                className={`bg-white rounded-none border transition-all p-3.5 flex flex-col gap-2.5 cursor-pointer group shadow-2xs hover:bg-gray-50
                                                    ${isSelected ? 'border-[#1B3B6A]/70 bg-[#EFF4F9]/30 shadow-xs' : 'border-gray-200/80'}`}
                                            >
                                                {/* Top Row: Note & Price */}
                                                <div className="flex justify-between items-start gap-3">
                                                    <span className="font-bold text-gray-900 text-xs sm:text-sm tracking-tight truncate flex-1">
                                                        {order.reference_note || 'Untitled Saved Order'}
                                                    </span>
                                                    <span className="font-mono font-black text-[#1B3B6A] text-xs sm:text-sm shrink-0">
                                                        {(orderTotal / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </span>
                                                </div>

                                                {/* Bottom Row: Info & Actions */}
                                                <div className="flex justify-between items-center gap-2 pt-1 border-t border-gray-100">
                                                    {/* Info */}
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-gray-400 shrink-0"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
                                                        <span>{new Date(order.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                        <span>•</span>
                                                        <span>{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="flex items-center gap-1.5 shrink-0 select-none">
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleDiscardHeldOrder(order); }}
                                                            className="p-2 text-gray-400 hover:text-rose-600 rounded-none hover:bg-rose-50 transition-colors cursor-pointer"
                                                            title="Discard (Backspace)"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleRecallOrder(order); }}
                                                            className="px-3.5 py-1.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-bold rounded-none text-xs sm:text-sm transition-all shadow-2xs active:scale-95 flex items-center gap-1 cursor-pointer"
                                                            title="Recall (Enter)"
                                                        >
                                                            Recall
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        {/* Footer Action */}
                        <div className="p-4 border-t border-gray-100 bg-white shrink-0">
                            <button
                                type="button"
                                onClick={() => { setShowHeldOrdersModal(false); setHeldOrdersNavIndex(-1); }}
                                className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none hover:bg-gray-50 transition-all active:scale-95 shadow-2xs cursor-pointer"
                            >
                                Cancel<span className="hidden md:inline"> (Esc)</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* QUANTITY INPUT MODAL */}
            {showQtyModal && qtyModalProduct && (
                <div 
                    className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 transition-opacity animate-in fade-in duration-200 select-none"
                    onClick={(e) => {
                        e.stopPropagation();
                        qtyInputRef.current?.focus();
                    }}
                    onMouseDown={(e) => {
                        if (e.target === e.currentTarget) {
                            e.preventDefault();
                            e.stopPropagation();
                            qtyInputRef.current?.focus();
                        }
                    }}
                >
                    <div 
                        ref={qtyModalRef}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => {
                            const isInteractive = e.target.closest('input, button, a, [role="button"], label');
                            if (!isInteractive) {
                                e.preventDefault();
                                qtyInputRef.current?.focus();
                            }
                            e.stopPropagation();
                        }}
                        className="bg-white w-full max-w-sm h-auto max-h-[85vh] sm:max-h-[90vh] rounded-none shadow-2xl border border-gray-200/90 flex flex-col overflow-hidden animate-slide-up sm:animate-fade-in"
                    >
                        <div className="bg-[#1B3B6A] px-5 py-3.5 flex justify-between items-center text-white shrink-0 shadow-md">
                            <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-none bg-white/10 flex items-center justify-center text-amber-300 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                </div>
                                <div>
                                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight">Enter Item Quantity</h2>
                                    <p className="text-xs text-blue-200 font-medium">Set units to add to cart</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={closeQtyModal}
                                className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-none transition-colors cursor-pointer"
                                title="Close (Esc)"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                        <form onSubmit={handleConfirmQty} className="flex-1 overflow-y-auto p-5 custom-scrollbar flex flex-col">
                            {/* Product Info Summary */}
                            <div className="text-center mb-4 p-3.5 rounded-none bg-[#EFF4F9] border border-[#CBD7E6] shrink-0">
                                <div className="text-[10px] text-gray-400 uppercase tracking-widest font-black mb-0.5">Item Selected</div>
                                <div className="text-sm sm:text-base font-black text-gray-900 tracking-tight leading-snug break-words px-2">{qtyModalProduct.name}</div>
                                <div className="text-xl font-black text-[#1B3B6A] tracking-tight mt-1 font-mono">
                                    {(((isWholesaleActive && qtyModalProduct.wholesale_price !== null) ? qtyModalProduct.wholesale_price : qtyModalProduct.price) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </div>
                            </div>

                            {/* Quantity Input Wrapper */}
                            <div className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs flex-1 flex flex-col justify-center">
                                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5 text-left">Quantity Count</label>
                                <input
                                    ref={qtyInputRef}
                                    type="number"
                                    required
                                    min="1"
                                    max={qtyModalProduct.stock_quantity}
                                    value={qtyModalInput}
                                    onChange={(e) => setQtyModalInput(e.target.value)}
                                    className="w-full px-4 py-2.5 text-center text-3xl font-black text-gray-900 border border-gray-200 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/20 focus:border-[#1B3B6A] shadow-2xs font-mono transition-all outline-none"
                                    placeholder="0"
                                    autoFocus
                                    onFocus={(e) => e.target.select()}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            closeQtyModal();
                                        }
                                    }}
                                />
                                {qtyModalProduct.stock_quantity < 99999 && (
                                    <div className="mt-2.5 text-center text-xs font-bold text-gray-400">
                                        Available in stock: <span className="text-gray-700 font-black">{qtyModalProduct.stock_quantity}</span>
                                    </div>
                                )}
                            </div>

                            {/* Submit & Cancel Buttons */}
                            <div className="flex flex-col gap-2 mt-5 pb-1 shrink-0">
                                <button
                                    type="submit"
                                    className="w-full py-3.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none shadow-md transition-all active:scale-95 cursor-pointer"
                                >
                                    Add to Cart<span className="hidden md:inline"> (Enter)</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={closeQtyModal}
                                    className="w-full py-2.5 bg-white text-gray-700 border border-gray-200 font-bold text-xs sm:text-sm uppercase tracking-wider rounded-none hover:bg-gray-50 transition-all active:scale-95 shadow-2xs cursor-pointer"
                                >
                                    Cancel<span className="hidden md:inline"> (Esc)</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* OPEN SHIFT MODAL */}
            <OpenShiftModal
                isOpen={showOpenShiftModal}
                shiftInfo={shiftData}
                terminal={currentTerminal}
                onClose={() => setShowOpenShiftModal(false)}
                onShiftOpened={(newShift) => {
                    setShowOpenShiftModal(false);
                    fetchCurrentShift();
                }}
            />

            {/* CLOSE SHIFT & Z-READ MODAL */}
            <ShiftModal
                isOpen={showCloseShiftModal}
                settings={activeSettings}
                onClose={() => setShowCloseShiftModal(false)}
                onShiftCompleted={() => {
                    fetchCurrentShift();
                }}
            />

            {/* CASH IN / CASH OUT MODAL (shared implementation, also used in Shift History) */}
            <CashMovementModal
                isOpen={showCashMovementModal}
                settings={activeSettings}
                user={auth.user}
                initialTerminals={initial_terminals}
                onClose={() => setShowCashMovementModal(false)}
                onMovementRecorded={() => {
                    fetchCurrentShift();
                }}
            />

        </AuthenticatedLayout>
    );
}