import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Head, usePage, router } from '@inertiajs/react';
import { createPortal } from 'react-dom';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import Swal from 'sweetalert2';

// Human-friendly Log ID Formatter (e.g. LOG-00039)
const formatLogId = (id) => {
    if (!id) return 'LOG-00001';
    return `LOG-${String(id).padStart(5, '0')}`;
};

// Human-friendly Target Entity Formatter (SystemSetting -> System Setting)
const formatTargetEntity = (modelType) => {
    if (!modelType) return 'Store System';
    const ENTITY_MAP = {
        SystemSetting: 'System Setting',
        SystemSettings: 'System Setting',
        Setting: 'Store Setting',
        Settings: 'Store Setting',
        Product: 'Product',
        Category: 'Category',
        User: 'Admin Account',
        Sale: 'POS Sale',
        Shift: 'Cashier Shift',
        CashMovement: 'Cash Movement',
        Customer: 'Customer',
        Receipt: 'Receipt'
    };
    if (ENTITY_MAP[modelType]) return ENTITY_MAP[modelType];
    return modelType
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();
};

// Human-friendly Action Code translation for Store Admins
const ACTION_LABELS = {
    login_success: 'Logged In',
    login_failed: 'Failed Login',
    logout: 'Logged Out',
    created: 'Created',
    updated: 'Updated',
    deleted: 'Deleted',
    restocked: 'Stock Added',
    stock_adjusted: 'Stock Adjusted',
    price_change: 'Price Updated',
    sale_completed: 'POS Sale',
    sale_voided: 'Sale Voided',
    item_voided: 'Item Voided',
    shift_opened: 'Shift Started',
    shift_closed: 'Shift Ended',
    'shift.open': 'Shift Started',
    'shift.close': 'Shift Closed',
    shift_open: 'Shift Started',
    shift_close: 'Shift Closed',
    'cash_movement.create': 'Cash Movement',
    cash_in: 'Cash In / Float',
    cash_out: 'Cash Out / Payout',
    status_toggle: 'Status Changed',
    password_changed: 'Password Changed',
    password_change: 'PIN / Password Changed',
    terms_accepted: 'Setup Completed',
    setup_completed: 'Setup Completed',
    recovery_failed: 'Failed Account Recovery',
    credential_recovered: 'Sign-in Reset (Recovery)'
};

const formatActionName = (action) => {
    if (!action) return 'Activity';
    if (ACTION_LABELS[action]) return ACTION_LABELS[action];
    return action
        .replace(/\./g, ' ')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();
};

// Human-friendly Description Formatter (translates raw slugs like loyalty_10, damaged_15)
const formatLogDescription = (desc) => {
    if (!desc) return 'No description logged';
    return desc
        .replace(/loyalty_10/g, 'Loyalty Reward (10%)')
        .replace(/damaged_15/g, 'Damaged / Clearance (15%)')
        .replace(/national_athlete/g, 'National Athlete (20%)')
        .replace(/solo_parent/g, 'Solo Parent (10%)')
        .replace(/custom_percentage/g, 'Custom Discount')
        .replace(/custom_fixed/g, 'Custom Fixed Amount');
};

// Helper to humanize field names for Store Admins
const FIELD_LABELS = {
    name: 'Name / Title',
    sku: 'Barcode / SKU',
    price: 'Selling Price',
    cost_price: 'Cost Price',
    wholesale_price: 'Wholesale Price',
    stock_quantity: 'Stock Quantity',
    stock: 'Stock Count',
    quantity: 'Quantity',
    quantity_added: 'Units Added / Restocked',
    quantity_change: 'Units Added / Restocked',
    category_id: 'Category ID',
    is_active: 'Status',
    email: 'Email Address',
    phone: 'Contact Number',
    address: 'Store Address',
    store_name: 'Store Name',
    logo_path: 'Store Logo',
    store_logo_path: 'Store Logo',
    tax_rate: 'Tax Rate (%)',
    total_amount: 'Total Amount',
    subtotal: 'Subtotal',
    discount_amount: 'Discount Amount',
    discount_type: 'Discount Applied',
    discount_label: 'Discount Applied',
    invoice_number: 'Invoice Number',
    items_count: 'Total Items Sold',
    cash_given: 'Cash Tendered',
    change: 'Change Given',
    payment_method: 'Payment Channel',
    starting_cash: 'Starting Cash Float',
    actual_cash: 'Actual Cash Count',
    expected_cash: 'Expected Drawer Balance',
    difference: 'Cash Variance (Short/Over)',
    opening_notes: 'Opening Notes',
    closing_notes: 'Closing Notes',
    barcode: 'Barcode',
    description: 'Description',
    status: 'Status',
    account_number: 'Account Number',
    type: 'Movement Type',
    amount: 'Amount',
    reason: 'Reason',
    shift_id: 'Shift',
    category: 'Category',
    low_stock_threshold: 'Low Stock Alert Level',
    image_path: 'Product Image',
    expected_opening_cash: 'Expected Opening Cash',
    discrepancy: 'Opening Discrepancy',
    total_sales: 'Total Sales',
    transactions_count: 'Transactions'
};

// Internal technical & CRM fields to exclude from Store Admin view
const IGNORED_FIELDS = new Set([
    'id', 'store_id', 'user_id', 'created_at', 'updated_at', 'deleted_at',
    'remember_token', 'password', 'password_confirmation', 'email_verified_at',
    'two_factor_secret', 'two_factor_recovery_codes', 'api_token', 'ip_address', 'user_agent',
    'customer_name', 'customer_id_number', 'discount_label',
    'quantity_added', 'quantity_change',
    'terminal_id'
]);

// Cash In / Out movement types (same wording as the Cash In / Cash Out form)
const MOVEMENT_TYPE_LABELS = {
    cash_in: 'Cash In / Deposit',
    cash_out: 'Cash Out / Expense',
    owner_draw: 'Owner Withdrawal',
    safe_drop: 'Safe Drop',
    float_topup: 'Float Top-up',
    expense: 'Expense'
};

// Discount slug lookup for clean human presentation
const DISCOUNT_LABELS = {
    senior: 'Senior Citizen (20%)',
    pwd: 'PWD (20%)',
    national_athlete: 'National Athlete (20%)',
    solo_parent: 'Solo Parent (10%)',
    loyalty_10: 'Loyalty Reward (10%)',
    damaged_15: 'Damaged / Clearance (15%)',
    custom_percentage: 'Custom Discount (%)',
    custom_fixed: 'Custom Fixed Discount'
};

// Payment channel lookup
const PAYMENT_LABELS = {
    cash: 'Cash',
    gcash: 'GCash',
    maya: 'Maya',
    card: 'Credit / Debit Card',
    bank_transfer: 'Bank Transfer'
};

// Product / logo image preview; the file may no longer exist for very old records
const ImagePreview = ({ src }) => {
    const [failed, setFailed] = useState(false);
    const url = src.startsWith('http') || src.startsWith('/') ? src : `/storage/${src}`;

    if (failed) {
        return <span className="text-xs font-semibold text-gray-500 italic font-sans">Image file no longer stored</span>;
    }

    return (
        <a href={url} target="_blank" rel="noopener noreferrer" title="Open full image" className="inline-block">
            <img
                src={url}
                alt="Product image"
                className="w-20 h-20 rounded-none object-contain border border-gray-200 shadow-2xs bg-white"
                onError={() => setFailed(true)}
            />
        </a>
    );
};

// Helper to format values cleanly without developer clutter
const formatAdminValue = (key, value) => {
    if (key === 'image_path' && (value === null || value === undefined || value === '')) {
        return <span className="text-xs font-semibold text-gray-500 italic font-sans">No image</span>;
    }

    if (key === 'shift_id') {
        if (value === null || value === undefined || value === '') {
            return (
                <span className="font-sans">
                    <span className="text-xs font-semibold text-gray-800 block">No open shift</span>
                    <span className="text-[11px] font-medium text-gray-500 block mt-0.5">Applied to the cash drawer; counted in the next shift's opening cash.</span>
                </span>
            );
        }
        return <span className="text-xs font-semibold text-gray-800 font-sans">Shift #{value}</span>;
    }

    if (value === null || value === undefined || value === '') {
        if (key === 'quantity_change' || key === 'quantity_added') {
            return <span className="text-gray-400 font-sans italic">—</span>;
        }
        return <span className="text-gray-400 font-sans italic">None</span>;
    }

    // Units added or restocked
    if (key === 'quantity_change' || key === 'quantity_added') {
        const num = Number(value);
        if (num === 0) {
            return <span className="text-gray-400 font-sans font-medium">—</span>;
        }
        return (
            <span className="inline-flex items-center px-2 py-0.5 rounded-none text-[11px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 font-sans">
                {num > 0 ? `+${num}` : num} units
            </span>
        );
    }

    // Stock quantities
    if (key === 'stock_quantity' || key === 'stock') {
        return <span className="font-bold text-gray-900 font-sans">{Number(value).toLocaleString()} units</span>;
    }

    // Booleans
    if (typeof value === 'boolean' || key === 'is_active') {
        const isTrue = value === true || value === 1 || value === '1';
        return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded-none text-[11px] font-bold ${isTrue ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {isTrue ? 'Active' : 'Inactive'}
            </span>
        );
    }

    // Currency values
    const currencyKeys = ['price', 'cost_price', 'wholesale_price', 'total_amount', 'subtotal', 'discount_amount', 'cash_given', 'change', 'starting_cash', 'actual_cash', 'expected_cash', 'difference', 'expenses', 'amount', 'expected_opening_cash', 'discrepancy', 'total_sales'];
    if (currencyKeys.includes(key) && !isNaN(Number(value))) {
        return <span className="font-bold text-gray-900 font-sans">₱{Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    }

    // Discount Type Formatting
    if (key === 'discount_type' || key === 'discount_label') {
        const label = DISCOUNT_LABELS[value] || (typeof value === 'string' ? value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : String(value));
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-none font-black text-xs bg-sky-50 text-sky-800 border border-sky-200">
                {label}
            </span>
        );
    }

    // Cash movement type
    if (key === 'type' && MOVEMENT_TYPE_LABELS[value]) {
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-none font-black text-xs bg-sky-50 text-sky-800 border border-sky-200">
                {MOVEMENT_TYPE_LABELS[value]}
            </span>
        );
    }

    // Payment Method Formatting
    if (key === 'payment_method') {
        const label = PAYMENT_LABELS[value] || (typeof value === 'string' ? value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : String(value));
        return (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-none font-black text-xs bg-gray-100 text-gray-800 border border-gray-200">
                {label}
            </span>
        );
    }

    // Image / Logo paths
    if (typeof value === 'string' && (value.includes('/storage/') || value.includes('logos/') || value.endsWith('.webp') || value.endsWith('.png') || value.endsWith('.jpg') || value.endsWith('.jpeg'))) {
        return <ImagePreview key={value} src={value} />;
    }

    // Objects
    if (typeof value === 'object') {
        return <span className="text-xs text-gray-700 font-sans">{JSON.stringify(value)}</span>;
    }

    return <span className="text-xs font-semibold text-gray-800 font-sans">{String(value)}</span>;
};

export default function ActivityLogs() {
    const { auth, initial_logs, initial_settings, focus_log_id } = usePage().props;
    const settings = initial_settings || {};

    // --- STATE MANAGEMENT ---
    const [logs, setLogs] = useState(initial_logs || []);
    const [searchTerm, setSearchTerm] = useState(() => (focus_log_id ? formatLogId(focus_log_id) : ''));
    const [categoryTab, setCategoryTab] = useState('all');
    const [filterAction, setFilterAction] = useState('');
    const [datePreset, setDatePreset] = useState('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'
    const [selectedLogForModal, setSelectedLogForModal] = useState(() => (
        focus_log_id ? (initial_logs || []).find((l) => l.id === focus_log_id) || null : null
    ));
    const [currentPage, setCurrentPage] = useState(1);
    const [showDataMenu, setShowDataMenu] = useState(false);
    const itemsPerPage = 10;

    // Refs for scrolling (matches Inventory.jsx)
    const pipelineTabsRef = useRef(null);
    const workspaceSectionRef = useRef(null);

    // Sync with initial_logs if props update
    useEffect(() => {
        if (initial_logs) {
            setLogs(initial_logs);
        }
    }, [initial_logs]);

    // Silent background auto-refresh (every 6s)
    useEffect(() => {
        const interval = setInterval(() => {
            router.reload({
                only: ['initial_logs'],
                preserveScroll: true,
                preserveState: true,
            });
        }, 6000);

        return () => clearInterval(interval);
    }, []);

    // Close export dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest('.data-menu-container')) {
                setShowDataMenu(false);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    // Format Helpers
    const formatDateTime = (dateStr) => {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatRelativeTime = (dateStr) => {
        if (!dateStr) return '';
        const now = new Date();
        const past = new Date(dateStr);
        const diffMs = now - past;
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;
        return past.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // Category Resolution Helper
    const getCategoryDetails = (category, action) => {
        const catLower = (category || '').toLowerCase();
        const actLower = (action || '').toLowerCase();

        if (catLower.includes('inventory') || catLower.includes('product') || catLower.includes('category') || actLower.includes('stock') || actLower.includes('product')) {
            return {
                key: 'inventory',
                label: 'Inventory & Stock',
                badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200/80',
                iconColor: 'text-indigo-600'
            };
        }
        if (catLower.includes('sale') || catLower.includes('checkout') || actLower.includes('sale') || actLower.includes('checkout')) {
            return {
                key: 'sales',
                label: 'Sales & POS',
                badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
                iconColor: 'text-emerald-600'
            };
        }
        if (catLower.includes('payment') || catLower.includes('shift') || catLower.includes('cash') || actLower.includes('movement') || actLower.includes('float')) {
            return {
                key: 'cash',
                label: 'Cash & Shifts',
                badgeClass: 'bg-sky-50 text-sky-800 border-sky-200/80',
                iconColor: 'text-sky-600'
            };
        }
        if (catLower.includes('security') || catLower.includes('user') || actLower.includes('login') || actLower.includes('logout') || actLower.includes('auth') || actLower.includes('password') || actLower.includes('credential') || actLower.includes('recovery') || actLower.includes('setup')) {
            return {
                key: 'security',
                label: 'Security & Account',
                badgeClass: 'bg-purple-50 text-purple-700 border-purple-200/80',
                iconColor: 'text-purple-600'
            };
        }
        if (actLower.includes('void') || actLower.includes('delete') || actLower.includes('remove') || actLower.includes('cancel')) {
            return {
                key: 'voids',
                label: 'Voids & Deletions',
                badgeClass: 'bg-rose-50 text-rose-700 border-rose-200/80',
                iconColor: 'text-rose-600'
            };
        }
        return {
            key: 'system',
            label: 'Store Settings',
            badgeClass: 'bg-gray-100 text-gray-700 border-gray-200/80',
            iconColor: 'text-gray-600'
        };
    };

    // Scroll to workspace on tab change (matches Inventory.jsx)
    const scrollToWorkspace = (tabKey) => {
        requestAnimationFrame(() => {
            if (workspaceSectionRef.current) {
                const isMobile = window.innerWidth < 640;
                const isTablet = window.innerWidth < 1024;
                const offset = isMobile ? 68 : (isTablet ? 76 : 85);

                const bodyRect = document.body.getBoundingClientRect().top;
                const elementRect = workspaceSectionRef.current.getBoundingClientRect().top;
                const elementPosition = elementRect - bodyRect;
                const offsetPosition = elementPosition - offset;

                const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
                const maxScroll = Math.max(0, scrollHeight - window.innerHeight);

                if (maxScroll > 0) {
                    const targetScroll = Math.min(maxScroll, Math.max(0, offsetPosition));
                    if (Math.abs(window.scrollY - targetScroll) > 6) {
                        window.scrollTo({
                            top: targetScroll,
                            behavior: 'smooth'
                        });
                    }
                }
            }

            if (tabKey && pipelineTabsRef.current) {
                const tabEl = pipelineTabsRef.current.querySelector(`[data-tab="${tabKey}"]`);
                if (tabEl) {
                    tabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }
        });
    };

    const handleCategoryTabChange = (tabKey) => {
        setCategoryTab(tabKey);
        setCurrentPage(1);
        scrollToWorkspace(tabKey);
    };

    // Date Presets Handler
    const handleDatePresetChange = (preset) => {
        setDatePreset(preset);
        setCurrentPage(1);
        const now = new Date();

        if (preset === 'all') {
            setStartDate('');
            setEndDate('');
        } else if (preset === 'today') {
            const todayStr = now.toISOString().split('T')[0];
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (preset === 'yesterday') {
            const yest = new Date(now);
            yest.setDate(now.getDate() - 1);
            const yestStr = yest.toISOString().split('T')[0];
            setStartDate(yestStr);
            setEndDate(yestStr);
        } else if (preset === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 7);
            setStartDate(weekAgo.toISOString().split('T')[0]);
            setEndDate(now.toISOString().split('T')[0]);
        } else if (preset === 'month') {
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(monthStart.toISOString().split('T')[0]);
            setEndDate(now.toISOString().split('T')[0]);
        }
    };

    // Tab Counts & KPI Stats Precomputation
    const stats = useMemo(() => {
        let totalCount = logs.length;
        let inventoryCount = 0;
        let salesCount = 0;
        let cashCount = 0;
        let securityCount = 0;
        let systemCount = 0;
        let todayCount = 0;

        const todayDateStr = new Date().toISOString().split('T')[0];

        logs.forEach((log) => {
            const logDate = (log.created_at || '').split('T')[0];
            if (logDate === todayDateStr) {
                todayCount++;
            }

            const cat = getCategoryDetails(log.category, log.action).key;
            if (cat === 'inventory') inventoryCount++;
            else if (cat === 'sales') salesCount++;
            else if (cat === 'cash') cashCount++;
            else if (cat === 'security') securityCount++;
            else systemCount++;
        });

        return {
            totalCount,
            inventoryCount,
            salesCount,
            cashCount,
            securityCount,
            systemCount,
            todayCount
        };
    }, [logs]);

    // Unique Actions for Filter Dropdown
    const uniqueActions = useMemo(() => {
        const set = new Set();
        logs.forEach(l => {
            if (l.action) set.add(l.action);
        });
        return Array.from(set).sort();
    }, [logs]);

    // --- FILTERED LOGS ---
    const filteredLogs = useMemo(() => {
        const search = searchTerm.toLowerCase().trim();

        return logs.filter((log) => {
            // Tab Category Filter
            if (categoryTab !== 'all') {
                const cat = getCategoryDetails(log.category, log.action).key;
                if (categoryTab === 'inventory' && cat !== 'inventory') return false;
                if (categoryTab === 'sales' && cat !== 'sales') return false;
                if (categoryTab === 'cash' && cat !== 'cash') return false;
                if (categoryTab === 'security' && cat !== 'security') return false;
                if (categoryTab === 'system' && (cat !== 'system' && cat !== 'voids')) return false;
            }

            // Action Filter
            if (filterAction) {
                if (log.action !== filterAction) return false;
            }

            // Date Filtering
            if (startDate) {
                const logDate = (log.created_at || '').split('T')[0];
                if (logDate < startDate) return false;
            }
            if (endDate) {
                const logDate = (log.created_at || '').split('T')[0];
                if (logDate > endDate) return false;
            }

            // Multi-Attribute Search Query
            if (search) {
                const matchDesc = (log.description || '').toLowerCase().includes(search);
                const matchUser = (log.user_name || '').toLowerCase().includes(search);
                const matchAction = (log.action || '').toLowerCase().includes(search);
                const matchActionHuman = formatActionName(log.action).toLowerCase().includes(search);
                const matchEntity = formatTargetEntity(log.model_type).toLowerCase().includes(search);
                const matchLogId = formatLogId(log.id).toLowerCase().includes(search);
                const matchId = String(log.id || '').includes(search);

                if (!matchDesc && !matchUser && !matchAction && !matchActionHuman && !matchEntity && !matchLogId && !matchId) {
                    return false;
                }
            }

            return true;
        });
    }, [logs, categoryTab, filterAction, startDate, endDate, searchTerm]);

    // Paginated Slicing
    const totalPages = Math.ceil(filteredLogs.length / itemsPerPage) || 1;
    const paginatedLogs = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredLogs.slice(start, start + itemsPerPage);
    }, [filteredLogs, currentPage, itemsPerPage]);

    // --- EXCEL EXPORT (EXCELJS) ---
    const exportActivityExcel = async () => {
        if (filteredLogs.length === 0) {
            Swal.fire('Notice', 'No activity logs available to export.', 'info');
            return;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'POS Retail System';
            workbook.created = new Date();

            const worksheet = workbook.addWorksheet('Activity Audit Log', {
                views: [{ showGridLines: true }]
            });

            worksheet.columns = [
                { key: 'id', width: 14 },
                { key: 'created_at', width: 24 },
                { key: 'user_name', width: 22 },
                { key: 'user_account_number', width: 16 },
                { key: 'category', width: 22 },
                { key: 'action', width: 22 },
                { key: 'description', width: 50 },
                { key: 'model_type', width: 20 }
            ];

            const storeName = (settings?.store_name || 'POS Retail System').toUpperCase();
            
            // Header Banner
            worksheet.mergeCells('A1:H1');
            worksheet.getCell('A1').value = storeName;
            worksheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 14 };
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 24;

            worksheet.mergeCells('A2:H2');
            worksheet.getCell('A2').value = 'STORE SYSTEM ACTIVITY & AUDIT TRAIL REPORT';
            worksheet.getCell('A2').font = { bold: true, color: { argb: '333333' }, size: 11 };
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 20;

            const dateRangeLabel = startDate || endDate
                ? `Period: ${startDate || 'Start'} to ${endDate || 'Present'}`
                : 'Period: Complete Store History';
            worksheet.mergeCells('A3:H3');
            worksheet.getCell('A3').value = `${dateRangeLabel}  |  Generated: ${new Date().toLocaleString()}  |  Total Records: ${filteredLogs.length}`;
            worksheet.getCell('A3').font = { color: { argb: '777777' }, size: 9 };
            worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(3).height = 18;

            worksheet.getRow(4).height = 10; // spacing

            // Table Column Headers
            const headers = [
                'Log ID',
                'Date & Time',
                'Performed By',
                'Account #',
                'Category',
                'Action Code',
                'Activity Description',
                'Target Entity'
            ];

            headers.forEach((h, colIndex) => {
                const cell = worksheet.getRow(5).getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: '1B3B6A' }
                };
                cell.alignment = { vertical: 'middle', horizontal: colIndex === 0 ? 'center' : 'left' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'medium', color: { argb: '0F172A' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            worksheet.getRow(5).height = 24;

            // Log Rows
            filteredLogs.forEach((log, idx) => {
                const rowNum = idx + 6;
                const row = worksheet.getRow(rowNum);
                const isEven = idx % 2 === 0;

                row.getCell('A').value = formatLogId(log.id);
                row.getCell('B').value = formatDateTime(log.created_at);
                row.getCell('C').value = log.user_name || 'System';
                row.getCell('D').value = log.user_account_number ? `#${log.user_account_number}` : '—';
                row.getCell('E').value = getCategoryDetails(log.category, log.action).label;
                row.getCell('F').value = formatActionName(log.action);
                row.getCell('G').value = log.description || '—';
                row.getCell('H').value = formatTargetEntity(log.model_type);

                for (let c = 1; c <= 8; c++) {
                    const cell = row.getCell(c);
                    cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'center' : 'left' };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'F1F5F9' } },
                        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'F1F5F9' } },
                        right: { style: 'thin', color: { argb: 'F1F5F9' } }
                    };
                    if (isEven) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FAFAFA' }
                        };
                    }
                }
                row.height = 22;
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, `Store_Activity_Log_${new Date().toISOString().split('T')[0]}.xlsx`);
            Swal.fire({ icon: 'success', title: 'Excel Exported!', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        } catch (error) {
            console.error('Error generating Activity Logs Excel file:', error);
            Swal.fire('Error', 'Failed to generate Excel report.', 'error');
        }
    };

    return (
        <AuthenticatedLayout
            user={auth.user}
            header={
                <div>
                    <h2 className="font-black text-xl text-gray-900 tracking-tight">System Activity Logs</h2>
                    <p className="text-xs font-semibold text-gray-500 mt-0.5">
                        Audit trail of store operations, security events, inventory movements, cash handling, and POS checkouts
                    </p>
                </div>
            }
        >
            <Head title="System Activity Logs" />

            <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">

                    {/* ========================================================================= */}
                    {/* 1. EXECUTIVE KPI METRIC STRIP (MATCHES INVENTORY & USER LAYOUT)           */}
                    {/* ========================================================================= */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">

                        {/* KPI 1: Total Activities */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-wider truncate">Total Logs</p>
                                    <h3 className="text-base sm:text-2xl font-black text-gray-900 tracking-tight truncate">
                                        {stats.totalCount.toLocaleString()} <span className="text-xs font-semibold text-gray-400">events</span>
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none ring-1 ring-[#CBD7E6] shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                <span className="truncate">Recorded Today</span>
                                <span className="font-bold text-gray-700 truncate shrink-0">{stats.todayCount} activities</span>
                            </div>
                        </div>

                        {/* KPI 2: Inventory & Stock */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-indigo-700 uppercase tracking-wider truncate">Catalog & Stock</p>
                                    <h3 className="text-base sm:text-2xl font-black text-indigo-900 tracking-tight truncate">
                                        {stats.inventoryCount.toLocaleString()} <span className="text-xs font-semibold text-indigo-600">updates</span>
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-indigo-50 text-indigo-700 rounded-none ring-1 ring-indigo-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-indigo-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-indigo-700 gap-1">
                                <span className="truncate">Catalog Share</span>
                                <span className="font-bold text-indigo-800 truncate shrink-0">
                                    {stats.totalCount > 0 ? Math.round((stats.inventoryCount / stats.totalCount) * 100) : 0}% of total
                                </span>
                            </div>
                        </div>

                        {/* KPI 3: Sales & POS */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-emerald-700 uppercase tracking-wider truncate">POS & Checkouts</p>
                                    <h3 className="text-base sm:text-2xl font-black text-emerald-900 tracking-tight truncate">
                                        {stats.salesCount.toLocaleString()} <span className="text-xs font-semibold text-emerald-600">transactions</span>
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-emerald-100/70 text-emerald-700 rounded-none ring-1 ring-emerald-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-emerald-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-emerald-700 gap-1">
                                <span className="truncate">Sales Share</span>
                                <span className="font-bold text-emerald-800 truncate shrink-0">
                                    {stats.totalCount > 0 ? Math.round((stats.salesCount / stats.totalCount) * 100) : 0}% of total
                                </span>
                            </div>
                        </div>

                        {/* KPI 4: Security & Account */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-purple-700 uppercase tracking-wider truncate">Security & Account</p>
                                    <h3 className="text-base sm:text-2xl font-black text-purple-900 tracking-tight truncate">
                                        {stats.securityCount.toLocaleString()} <span className="text-xs font-semibold text-purple-600">audits</span>
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-purple-100/70 text-purple-700 rounded-none ring-1 ring-purple-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-purple-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-purple-700 gap-1">
                                <span className="truncate">Security Share</span>
                                <span className="font-bold text-purple-800 truncate shrink-0">
                                    {stats.totalCount > 0 ? Math.round((stats.securityCount / stats.totalCount) * 100) : 0}% of total
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* ========================================================================= */}
                    {/* 2. ACTIVITY WORKSPACE: CONNECTED TABS + MAIN CONTENT CARD                 */}
                    {/* ========================================================================= */}
                    <div ref={workspaceSectionRef} className="flex flex-col scroll-mt-4">

                        {/* Interactive Pipeline Status Tabs */}
                        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth -mb-px relative z-20 pt-1">
                            <div ref={pipelineTabsRef} className="flex flex-nowrap items-end gap-1 sm:gap-1.5 px-3 w-max min-w-full">

                                {/* Tab 1: All Activities */}
                                <button
                                    data-tab="all"
                                    onClick={() => handleCategoryTabChange('all')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        categoryTab === 'all'
                                            ? 'bg-white text-gray-900 font-black border-t-[#1B3B6A] border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {categoryTab === 'all' && (
                                        <>
                                            <div className="absolute -bottom-px -left-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                            <div className="absolute -bottom-px -right-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current scale-x-[-1]" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                        </>
                                    )}
                                    <span>All Activities</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        categoryTab === 'all'
                                            ? 'bg-[#1B3B6A] text-white shadow-2xs'
                                            : 'bg-gray-200/80 text-gray-700 group-hover:bg-gray-300'
                                    }`}>
                                        {stats.totalCount}
                                    </span>
                                </button>

                                {/* Tab 2: Inventory & Stock */}
                                <button
                                    data-tab="inventory"
                                    onClick={() => handleCategoryTabChange('inventory')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        categoryTab === 'inventory'
                                            ? 'bg-white text-indigo-900 font-black border-t-indigo-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {categoryTab === 'inventory' && (
                                        <>
                                            <div className="absolute -bottom-px -left-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                            <div className="absolute -bottom-px -right-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current scale-x-[-1]" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                        </>
                                    )}
                                    <span>Inventory & Stock</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        categoryTab === 'inventory'
                                            ? 'bg-indigo-600 text-white shadow-2xs'
                                            : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100'
                                    }`}>
                                        {stats.inventoryCount}
                                    </span>
                                </button>

                                {/* Tab 3: Sales & POS */}
                                <button
                                    data-tab="sales"
                                    onClick={() => handleCategoryTabChange('sales')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        categoryTab === 'sales'
                                            ? 'bg-white text-emerald-900 font-black border-t-emerald-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {categoryTab === 'sales' && (
                                        <>
                                            <div className="absolute -bottom-px -left-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                            <div className="absolute -bottom-px -right-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current scale-x-[-1]" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                        </>
                                    )}
                                    <span>Sales & POS</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        categoryTab === 'sales'
                                            ? 'bg-emerald-600 text-white shadow-2xs'
                                            : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                                    }`}>
                                        {stats.salesCount}
                                    </span>
                                </button>

                                {/* Tab 4: Cash & Shifts */}
                                <button
                                    data-tab="cash"
                                    onClick={() => handleCategoryTabChange('cash')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        categoryTab === 'cash'
                                            ? 'bg-white text-sky-900 font-black border-t-sky-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {categoryTab === 'cash' && (
                                        <>
                                            <div className="absolute -bottom-px -left-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                            <div className="absolute -bottom-px -right-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current scale-x-[-1]" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                        </>
                                    )}
                                    <span>Cash & Shifts</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        categoryTab === 'cash'
                                            ? 'bg-sky-600 text-white shadow-2xs'
                                            : 'bg-sky-50 text-sky-700 group-hover:bg-sky-100'
                                    }`}>
                                        {stats.cashCount}
                                    </span>
                                </button>

                                {/* Tab 5: Security & Account */}
                                <button
                                    data-tab="security"
                                    onClick={() => handleCategoryTabChange('security')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        categoryTab === 'security'
                                            ? 'bg-white text-purple-900 font-black border-t-purple-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {categoryTab === 'security' && (
                                        <>
                                            <div className="absolute -bottom-px -left-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                            <div className="absolute -bottom-px -right-3 w-3 h-3 pointer-events-none z-30 overflow-hidden">
                                                <svg className="w-3 h-3 text-white fill-current scale-x-[-1]" viewBox="0 0 12 12">
                                                    <path d="M12 0 L12 12 L0 12 A12 12 0 0 0 12 0 Z" />
                                                    <path d="M0 12 A12 12 0 0 0 12 0" fill="none" stroke="rgba(229, 231, 235, 0.9)" strokeWidth="1.2" />
                                                </svg>
                                            </div>
                                        </>
                                    )}
                                    <span>Security & Account</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        categoryTab === 'security'
                                            ? 'bg-purple-600 text-white shadow-2xs'
                                            : 'bg-purple-50 text-purple-700 group-hover:bg-purple-100'
                                    }`}>
                                        {stats.securityCount}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* MAIN CONTENT CARD: TOOLBAR + TABLE / CARDS + PAGINATION */}
                        <div className="bg-white rounded-none border border-gray-200/80 shadow-sm overflow-hidden flex flex-col relative z-10">

                            {/* 3. FULLY RESPONSIVE SEARCH, FILTER & OPERATIONAL TOOLBAR */}
                            <div className="p-3.5 sm:p-4 bg-white border-b border-gray-100 space-y-3 relative z-10">

                                {/* Tier 1: Search, View Mode Toggle & Filter Controls */}
                                <div className="overflow-x-auto no-scrollbar pb-0.5">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-nowrap gap-2.5 min-w-full sm:min-w-max lg:min-w-0">

                                        {/* Search Bar */}
                                        <div className="relative flex-1 min-w-full sm:min-w-[220px] lg:min-w-[240px]">
                                            <input
                                                type="text"
                                                placeholder="Search by log ID (e.g. LOG-00039), action, or description..."
                                                className="pl-11 pr-10 py-2.5 bg-gray-50/70 border border-gray-200 rounded-none w-full focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 focus:bg-white text-sm font-medium transition-all shadow-2xs placeholder:text-gray-400"
                                                value={searchTerm}
                                                onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                                            />
                                            <svg className="w-5 h-5 text-gray-400 absolute left-3.5 top-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                            {searchTerm && (
                                                <button onClick={() => { setSearchTerm(''); setCurrentPage(1); }} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>

                                        {/* View Mode Toggle (Desktop only, matches Inventory) */}
                                        <div className="hidden lg:inline-flex rounded-none bg-gray-100 p-1 border border-gray-200 shrink-0 self-start sm:self-auto">
                                            <button
                                                type="button"
                                                onClick={() => setViewMode('table')}
                                                className={`p-2 rounded-none transition-all flex items-center gap-1.5 text-xs cursor-pointer ${viewMode === 'table' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'}`}
                                                title="List View"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                                                </svg>
                                                <span className="hidden sm:inline">List</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setViewMode('grid')}
                                                className={`p-2 rounded-none transition-all flex items-center gap-1.5 text-xs cursor-pointer ${viewMode === 'grid' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'}`}
                                                title="Card View"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                                                </svg>
                                                <span className="hidden sm:inline">Cards</span>
                                            </button>
                                        </div>

                                        {/* Filter Dropdown (Action Code) */}
                                        <div className="flex flex-nowrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                            <select
                                                value={filterAction}
                                                onChange={(e) => { setFilterAction(e.target.value); setCurrentPage(1); }}
                                                className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs w-full sm:w-[160px] lg:w-[175px] shrink-0 truncate cursor-pointer"
                                            >
                                                <option value="">All Actions ({uniqueActions.length})</option>
                                                {uniqueActions.map(act => (
                                                    <option key={act} value={act}>{formatActionName(act)}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                {/* Tier 2: Action Buttons, Date Range Pickers (From, To), Presets & Export */}
                                <div className="pt-2.5 border-t border-gray-100 pb-0.5 relative z-20">
                                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 w-full">

                                        {/* Left Side: Section Label (Desktop Only) */}
                                        <div className="hidden lg:block">
                                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Activity Actions</span>
                                        </div>

                                        {/* Right Side: Custom Date Range (From, To), Date Preset Dropdown, & Export Actions */}
                                        <div className="grid grid-cols-2 md:grid-cols-4 lg:flex lg:w-auto items-center gap-2 w-full lg:w-auto shrink-0 justify-end">

                                            {/* Custom Date Range: From */}
                                            <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full sm:w-auto shrink-0 shadow-2xs">
                                                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">From</span>
                                                <input
                                                    type="date"
                                                    className="w-full sm:w-[105px] bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                    value={startDate}
                                                    onChange={(e) => { setStartDate(e.target.value); setDatePreset('custom'); setCurrentPage(1); }}
                                                />
                                            </div>

                                            {/* Custom Date Range: To */}
                                            <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full sm:w-auto shrink-0 shadow-2xs">
                                                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">To</span>
                                                <input
                                                    type="date"
                                                    className="w-full sm:w-[105px] bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                    value={endDate}
                                                    onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); setCurrentPage(1); }}
                                                />
                                            </div>

                                            {/* Date Presets Dropdown */}
                                            <div className="w-full sm:w-[105px] lg:w-[110px] shrink-0">
                                                <select
                                                    value={datePreset}
                                                    onChange={(e) => handleDatePresetChange(e.target.value)}
                                                    className="h-[38px] bg-white border border-gray-200 rounded-none py-2 pl-2.5 pr-6 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs font-semibold transition-all shadow-2xs w-full cursor-pointer truncate"
                                                >
                                                    <option value="all">All Time</option>
                                                    <option value="today">Today</option>
                                                    <option value="yesterday">Yesterday</option>
                                                    <option value="week">7 Days</option>
                                                    <option value="month">This Month</option>
                                                    {datePreset === 'custom' && <option value="custom">Custom</option>}
                                                </select>
                                            </div>

                                            {/* Data & Export Dropdown */}
                                            <div className="relative data-menu-container w-full lg:w-auto shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDataMenu(!showDataMenu)}
                                                    className="w-full lg:w-auto justify-center px-3.5 py-2 rounded-none font-bold text-xs sm:text-sm bg-[#EFF4F9] text-[#1B3B6A] hover:bg-[#E2ECF6] border border-[#CBD7E6] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer h-[38px]"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                    </svg>
                                                    <span>Export Logs</span>
                                                    <svg className={`w-3.5 h-3.5 ml-0.5 text-gray-500 transition-transform duration-200 ${showDataMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>

                                                {showDataMenu && (
                                                    <div className="absolute left-0 lg:left-auto lg:right-0 top-full mt-2 w-full sm:w-56 bg-white rounded-none shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                                                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Reports & Audit</div>
                                                        <button
                                                            onClick={() => { setShowDataMenu(false); exportActivityExcel(); }}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                                            </svg>
                                                            Export to Excel (.xlsx)
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ========================================================================= */}
                            {/* 4. MAIN CONTENT: TABLE VIEW (DESKTOP ONLY WHEN viewMode === 'table')      */}
                            {/* ========================================================================= */}
                            {viewMode === 'table' && (
                                <div className="hidden lg:block bg-white overflow-hidden">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-left min-w-[1050px]">
                                            <thead className="bg-gray-50/80 border-b border-gray-200/80 text-gray-500 uppercase text-[10px] font-black tracking-wider whitespace-nowrap">
                                                <tr>
                                                    <th className="p-4 w-44 whitespace-nowrap">Date & Time</th>
                                                    <th className="p-4 min-w-[200px] whitespace-nowrap">Performed By</th>
                                                    <th className="p-4 whitespace-nowrap">Category</th>
                                                    <th className="p-4 whitespace-nowrap">Action</th>
                                                    <th className="p-4 min-w-[300px] whitespace-nowrap">Activity Details</th>
                                                    <th className="p-4 whitespace-nowrap">Target Entity</th>
                                                    <th className="p-4 text-center w-20 whitespace-nowrap">Audit Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {filteredLogs.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={7} className="py-12 px-4 text-center text-gray-500 font-bold whitespace-nowrap">
                                                            <div className="max-w-xs mx-auto flex flex-col items-center">
                                                                <div className="w-12 h-12 bg-gray-100 rounded-none flex items-center justify-center text-gray-400 mb-2">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                    </svg>
                                                                </div>
                                                                <p className="text-gray-900 font-black text-sm">No activity logs found</p>
                                                                <p className="text-gray-400 text-xs mt-0.5">Try changing your search terms, action filter, or date range.</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    paginatedLogs.map((log) => {
                                                        const catInfo = getCategoryDetails(log.category, log.action);

                                                        return (
                                                            <tr key={log.id} className="hover:bg-gray-50/60 transition-colors whitespace-nowrap">
                                                                {/* Date & Time with LOG-00039 */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <div className="font-bold text-gray-900 text-xs whitespace-nowrap">
                                                                        {formatDateTime(log.created_at)}
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 mt-1">
                                                                        <span className="font-mono text-[10px] font-bold text-[#1B3B6A] bg-[#EFF4F9] px-1.5 py-0.5 rounded border border-[#CBD7E6]/70">
                                                                            {formatLogId(log.id)}
                                                                        </span>
                                                                        <span className="text-[10px] text-gray-400 font-medium">
                                                                            {formatRelativeTime(log.created_at)}
                                                                        </span>
                                                                    </div>
                                                                </td>

                                                                {/* Performed By */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <div className="flex items-center gap-3">
                                                                        {log.user_avatar ? (
                                                                            <img src={log.user_avatar} alt={log.user_name} className="w-10 h-10 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0" />
                                                                        ) : (
                                                                            <div className="w-10 h-10 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-sm border border-gray-200 shrink-0 uppercase shadow-2xs">
                                                                                {log.user_name ? log.user_name.charAt(0) : 'S'}
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <div className="font-extrabold text-gray-900 text-sm group-hover:text-[#1B3B6A] transition-colors">{log.user_name || 'System / Auto'}</div>
                                                                            <div className="text-[11px] font-mono font-bold text-gray-400 mt-0.5">
                                                                                {log.user_account_number ? `#${log.user_account_number}` : 'SYSTEM'}
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                {/* Category Column */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <span className={`inline-flex items-center px-2.5 py-1 rounded-none text-xs font-bold border ${catInfo.badgeClass}`}>
                                                                        {catInfo.label}
                                                                    </span>
                                                                </td>

                                                                {/* Action Column */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-none text-xs font-bold bg-gray-100 text-gray-800 border border-gray-200/80">
                                                                        {formatActionName(log.action)}
                                                                    </span>
                                                                </td>

                                                                {/* Description */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <div className="text-xs font-semibold text-gray-800 truncate max-w-[320px]" title={log.description}>
                                                                        {formatLogDescription(log.description)}
                                                                    </div>
                                                                </td>

                                                                {/* Target Entity (Clean Spaced Capitalized without subtext) */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <span className="px-2.5 py-1 rounded-none text-xs font-bold bg-gray-100 text-gray-700 whitespace-nowrap">
                                                                        {formatTargetEntity(log.model_type)}
                                                                    </span>
                                                                </td>

                                                                {/* Audit Actions (Eye only) */}
                                                                <td className="p-4 text-center whitespace-nowrap">
                                                                    <button
                                                                        onClick={() => setSelectedLogForModal(log)}
                                                                        className="p-2 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-none transition-colors inline-flex items-center justify-center active:scale-95 cursor-pointer shadow-2xs"
                                                                        title="View Audit Details & Changes"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                        </svg>
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )}

                            {/* ========================================================================= */}
                            {/* 5. RESPONSIVE CARD VIEW (MATCHES INVENTORY & USER LAYOUT)                 */}
                            {/* ========================================================================= */}
                            <div className={`${viewMode === 'table' ? 'lg:hidden' : 'block'} p-3.5 sm:p-4 bg-gray-50/40 border-t lg:border-t-0 border-gray-100`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4">
                                    {filteredLogs.length === 0 ? (
                                        <div className="col-span-full bg-white py-12 px-4 rounded-none border border-gray-200/80 text-center text-gray-500 font-bold">
                                            <div className="max-w-xs mx-auto flex flex-col items-center">
                                                <div className="w-12 h-12 bg-gray-100 rounded-none flex items-center justify-center text-gray-400 mb-2">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </div>
                                                <p className="text-gray-900 font-black text-sm">No activity logs found</p>
                                                <p className="text-gray-400 text-xs mt-0.5">Try changing your search terms, action filter, or date range.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        paginatedLogs.map((log) => {
                                            const catInfo = getCategoryDetails(log.category, log.action);

                                            return (
                                                <div 
                                                    key={log.id} 
                                                    className="bg-white rounded-none border border-gray-200/80 shadow-2xs p-3.5 sm:p-4 flex flex-col justify-between gap-3 hover:shadow-md transition-all"
                                                >
                                                    {/* Card Header: Avatar, Log ID & Time */}
                                                    <div className="flex items-start justify-between gap-2 border-b border-gray-100 pb-2.5">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            {log.user_avatar ? (
                                                                <img src={log.user_avatar} alt={log.user_name} className="w-10 h-10 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0" />
                                                            ) : (
                                                                <div className="w-10 h-10 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-sm border border-gray-200 shrink-0 uppercase shadow-2xs">
                                                                    {log.user_name ? log.user_name.charAt(0) : 'S'}
                                                                </div>
                                                            )}
                                                            <div className="min-w-0">
                                                                <h4 className="font-extrabold text-sm text-gray-900 truncate">{log.user_name || 'System / Auto'}</h4>
                                                                <span className="text-[10px] text-gray-400 font-bold uppercase block">{log.user_id ? 'Store Administrator' : 'System'}</span>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className="font-mono text-[10px] font-bold text-[#1B3B6A] bg-[#EFF4F9] px-1.5 py-0.5 rounded border border-[#CBD7E6]/70 block mb-0.5">
                                                                {formatLogId(log.id)}
                                                            </span>
                                                            <span className="text-[10px] font-bold text-gray-400 block">{formatRelativeTime(log.created_at)}</span>
                                                        </div>
                                                    </div>

                                                    {/* Category, Action & Target Entity Badges */}
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-none text-[10px] font-bold border ${catInfo.badgeClass}`}>
                                                            {catInfo.label}
                                                        </span>
                                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-none text-[10px] font-bold border border-gray-200 font-sans">
                                                            {formatActionName(log.action)}
                                                        </span>
                                                        {log.model_type && (
                                                            <span className="px-2 py-0.5 bg-slate-50 text-slate-700 rounded-none text-[10px] font-bold border border-slate-200">
                                                                {formatTargetEntity(log.model_type)}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Description Box */}
                                                    <p className="text-xs text-gray-800 font-medium leading-relaxed bg-gray-50/70 p-3 rounded-none border border-gray-100 line-clamp-3">
                                                        {formatLogDescription(log.description)}
                                                    </p>

                                                    {/* Card Footer */}
                                                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                                                        <span className="text-[11px] font-mono font-bold text-gray-400">{formatLogId(log.id)}</span>
                                                        <button
                                                            onClick={() => setSelectedLogForModal(log)}
                                                            className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-none transition-colors inline-flex items-center justify-center active:scale-95 cursor-pointer shadow-2xs gap-1 font-bold text-xs"
                                                            title="View Audit Details"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                            </svg>
                                                            <span>Details</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* ========================================================================= */}
                    {/* 6. SMOOTH HORIZONTAL PAGINATION (CLEAN "Page X of Y" WITHOUT RECORD COUNT) */}
                    {/* ========================================================================= */}
                    {filteredLogs.length > 0 && totalPages > 1 && (() => {
                        const getPageNumbers = () => {
                            const pages = [];
                            const delta = 1;
                            const left = Math.max(2, currentPage - delta);
                            const right = Math.min(totalPages - 1, currentPage + delta);

                            pages.push(1);
                            if (left > 2) pages.push('...');
                            for (let i = left; i <= right; i++) {
                                if (i !== 1 && i !== totalPages) pages.push(i);
                            }
                            if (right < totalPages - 1) pages.push('...');
                            if (totalPages > 1) pages.push(totalPages);

                            return pages;
                        };

                        return (
                            <div className="py-3 flex flex-col sm:flex-row justify-between items-center gap-3 pb-8 sm:pb-3 w-full overflow-visible">
                                <span className="text-[11px] text-gray-500 font-bold uppercase tracking-wider shrink-0">
                                    Page <span className="text-gray-900 font-black">{currentPage}</span> of {totalPages}
                                </span>

                                <div className="w-full sm:w-auto overflow-x-auto hide-scrollbar pb-1 sm:pb-0">
                                    <div className="flex gap-1 flex-nowrap w-max mx-auto sm:mx-0 px-1">
                                        <button
                                            disabled={currentPage === 1}
                                            onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                            className="px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap flex items-center active:scale-95 shadow-2xs cursor-pointer"
                                        >
                                            &laquo; Prev
                                        </button>

                                        {getPageNumbers().map((num, idx) => (
                                            num === '...' ? (
                                                <span key={`ellipsis-${idx}`} className="px-1.5 py-1 min-h-[30px] text-gray-400 font-bold flex items-center text-xs">...</span>
                                            ) : (
                                                <button
                                                    key={num}
                                                    onClick={() => { setCurrentPage(num); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                                    className={`shrink-0 px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all flex items-center justify-center active:scale-95 cursor-pointer
                                                        ${currentPage === num ? 'bg-[#1B3B6A] text-white border-[#1B3B6A] shadow-xs font-extrabold' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-2xs'}`}
                                                >
                                                    {num}
                                                </button>
                                            )
                                        ))}

                                        <button
                                            disabled={currentPage === totalPages}
                                            onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                                            className="px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 whitespace-nowrap flex items-center active:scale-95 shadow-2xs cursor-pointer"
                                        >
                                            Next &raquo;
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                </div>
            </div>

            {/* ========================================================================= */}
            {/* 7. AUDIT DIFF & DETAILS INSPECTION MODAL (PORTAL MATCHING INVENTORY)       */}
            {/* ========================================================================= */}
            {selectedLogForModal && typeof document !== 'undefined' && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[100] sm:p-4 lg:p-6 backdrop-blur-sm animate-in fade-in duration-300"
                    onClick={() => setSelectedLogForModal(null)}
                >
                    <div 
                        className="bg-white w-full h-full sm:h-auto sm:max-w-4xl lg:max-w-5xl sm:rounded-none sm:shadow-2xl overflow-hidden flex flex-col sm:max-h-[92vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300 border border-gray-200/80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header (Sticky on Mobile, matches Inventory Stock History Modal) */}
                        <div className="bg-[#1B3B6A] border-b border-white/10 px-4 sm:px-8 py-3.5 sm:py-5 flex justify-between items-center shrink-0 sticky top-0 z-50 text-white shadow-md">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div className="p-2 sm:p-2.5 bg-white/10 rounded-none shrink-0 ring-1 ring-white/20">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-white">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight truncate max-w-full">
                                        Activity Details & Audit Inspector
                                    </h2>
                                    <p className="text-[11px] sm:text-xs text-white/80 font-mono flex items-center gap-1.5 mt-0.5 truncate whitespace-nowrap overflow-hidden">
                                        <span>{formatLogId(selectedLogForModal.id)}</span>
                                        <span>•</span>
                                        <span>{formatDateTime(selectedLogForModal.created_at)}</span>
                                        <span className="hidden sm:inline">•</span>
                                        <span className="hidden sm:inline truncate">{selectedLogForModal.user_name || 'System / Auto'}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                                <button
                                    onClick={() => setSelectedLogForModal(null)}
                                    className="bg-white/10 hover:bg-white/20 p-1.5 sm:p-2 rounded-none text-white transition-colors active:scale-95 shrink-0 ring-1 ring-white/20 cursor-pointer"
                                    title="Close Modal"
                                >
                                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Modal Body */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 bg-gray-50/50 custom-scrollbar">

                            {/* Core Meta Details Grid */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div className="bg-white p-3.5 rounded-none border border-gray-200/80 shadow-2xs">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block mb-1.5">Performed By</span>
                                    <div className="flex items-center gap-2.5 min-w-0">
                                        {selectedLogForModal.user_avatar ? (
                                            <img src={selectedLogForModal.user_avatar} alt={selectedLogForModal.user_name} className="w-8 h-8 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-xs border border-gray-200 shrink-0 uppercase shadow-2xs">
                                                {selectedLogForModal.user_name ? selectedLogForModal.user_name.charAt(0) : 'S'}
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <span className="font-black text-gray-900 block truncate text-xs">{selectedLogForModal.user_name || 'System / Auto'}</span>
                                            <span className="text-[10px] text-gray-400 uppercase font-bold block">{selectedLogForModal.user_id ? 'Store Administrator' : 'System'}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-white p-3.5 rounded-none border border-gray-200/80 shadow-2xs">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Category</span>
                                    <span className="font-black text-gray-900 mt-1 block truncate text-sm">
                                        {getCategoryDetails(selectedLogForModal.category, selectedLogForModal.action).label}
                                    </span>
                                    <span className="text-[10px] text-gray-600 font-bold block">{formatActionName(selectedLogForModal.action)}</span>
                                </div>
                                <div className="bg-white p-3.5 rounded-none border border-gray-200/80 shadow-2xs">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Target Entity</span>
                                    <span className="font-black text-gray-900 mt-1 block truncate text-sm">
                                        {formatTargetEntity(selectedLogForModal.model_type)}
                                    </span>
                                </div>
                                <div className="bg-white p-3.5 rounded-none border border-gray-200/80 shadow-2xs">
                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Timestamp</span>
                                    <span className="font-bold text-gray-900 mt-1 block truncate text-xs">{formatDateTime(selectedLogForModal.created_at)}</span>
                                    <span className="text-[10px] text-gray-400 font-semibold block">{formatRelativeTime(selectedLogForModal.created_at)}</span>
                                </div>
                            </div>

                            {/* Summary Description Box */}
                            <div className="bg-white p-4 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs space-y-1.5">
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">Activity Summary</span>
                                <p className="text-sm font-semibold text-gray-900 leading-relaxed">
                                    {formatLogDescription(selectedLogForModal.description)}
                                </p>
                            </div>

                            {/* Human-Friendly Details / Diff Inspector */}
                            {(() => {
                                const action = (selectedLogForModal.action || '').toLowerCase();
                                const isEditAction = action.includes('update') || action.includes('edit') || action.includes('adjust') || action.includes('toggle') || action.includes('change');

                                const oldV = selectedLogForModal.old_values || {};
                                const newV = selectedLogForModal.new_values || {};
                                const allKeys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]))
                                    .filter(k => !IGNORED_FIELDS.has(k.toLowerCase()))
                                    .filter(k => !(k === 'quantity_change' && (newV.quantity_added !== undefined || oldV.quantity_added !== undefined)));

                                // If it is an Edit / Update action, render the Field Changes & Modifications table
                                if (isEditAction && allKeys.length > 0) {
                                    return (
                                        <div className="bg-white p-4 sm:p-6 rounded-none border border-gray-200/80 shadow-2xs space-y-3">
                                            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                                                <div className="flex items-center gap-2">
                                                    <div className="p-1.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none">
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                                        </svg>
                                                    </div>
                                                    <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                                                        Field Changes & Modifications
                                                    </h4>
                                                </div>
                                                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-none">{allKeys.filter((k) => JSON.stringify(oldV[k]) !== JSON.stringify(newV[k])).length} of {allKeys.length} fields changed</span>
                                            </div>

                                            <div className="overflow-x-auto rounded-none border border-gray-200">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-wider text-gray-500 border-b border-gray-200">
                                                        <tr>
                                                            <th className="py-2.5 px-3.5 text-left w-1/3">Item / Field Name</th>
                                                            <th className="py-2.5 px-3.5 text-left bg-rose-50/40 text-rose-900 w-1/3">Previous Value</th>
                                                            <th className="py-2.5 px-3.5 text-left bg-emerald-50/40 text-emerald-900 w-1/3">New Value</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100">
                                                        {allKeys.map((key) => {
                                                            const oldVal = oldV[key];
                                                            const newVal = newV[key];
                                                            const isChanged = JSON.stringify(oldVal) !== JSON.stringify(newVal);
                                                            const friendlyLabel = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                                                            return (
                                                                <tr key={key} className={isChanged ? 'bg-amber-50/20' : ''}>
                                                                    <td className="py-2.5 px-3.5 font-bold text-gray-800">
                                                                        {friendlyLabel}
                                                                    </td>
                                                                    <td className="py-2.5 px-3.5 bg-rose-50/20">
                                                                        {formatAdminValue(key, oldVal)}
                                                                    </td>
                                                                    <td className="py-2.5 px-3.5 bg-emerald-50/20">
                                                                        <div className="flex items-center gap-2 flex-wrap">
                                                                            {formatAdminValue(key, newVal)}
                                                                            {(key === 'stock_quantity' || key === 'stock') && (() => {
                                                                                const added = Number(newV.quantity_added ?? newV.quantity_change);
                                                                                if (!added || isNaN(added) || added <= 0) return null;
                                                                                return (
                                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-none text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 font-sans shadow-2xs">
                                                                                        +{added.toLocaleString()} added
                                                                                    </span>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    );
                                }

                                // For Non-Edit actions (Sales, Cash Movements, Shifts, Creations, Security), display rich payload key-value cards
                                const detailsObj = Object.keys(newV).length > 0 ? newV : oldV;
                                const detailEntries = Object.entries(detailsObj).filter(([k]) => !IGNORED_FIELDS.has(k.toLowerCase()));

                                if (detailEntries.length === 0) {
                                    return null;
                                }

                                return (
                                    <div className="bg-white p-4 sm:p-6 rounded-none border border-gray-200/80 shadow-2xs space-y-3">
                                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none">
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </div>
                                                <h4 className="text-xs font-black text-gray-900 uppercase tracking-wider">
                                                    Transaction & Operation Details
                                                </h4>
                                            </div>
                                            <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2.5 py-1 rounded-none">{detailEntries.length} detail attribute(s)</span>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {detailEntries.map(([key, value]) => {
                                                const friendlyLabel = FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                                                return (
                                                    <div key={key} className="bg-gray-50/80 p-3 rounded-none border border-gray-200/60 flex flex-col justify-between">
                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{friendlyLabel}</span>
                                                        <span className="text-xs font-black text-gray-900 mt-1 break-words flex items-center gap-2 flex-wrap">
                                                            {formatAdminValue(key, value)}
                                                            {(key === 'stock_quantity' || key === 'stock') && (() => {
                                                                const added = Number(detailsObj.quantity_added ?? detailsObj.quantity_change);
                                                                if (!added || isNaN(added) || added <= 0) return null;
                                                                return (
                                                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-none text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 font-sans shadow-2xs">
                                                                        +{added.toLocaleString()} added
                                                                    </span>
                                                                );
                                                            })()}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}

                        </div>

                        {/* Modal Footer (matches Inventory Stock History Modal) */}
                        <div className="bg-white px-4 sm:px-8 py-3.5 border-t border-gray-100 flex justify-end shrink-0">
                            <button
                                onClick={() => setSelectedLogForModal(null)}
                                className="px-6 py-2.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white rounded-none text-xs font-bold transition-all active:scale-95 shadow-md shadow-[#1B3B6A]/15 cursor-pointer"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </AuthenticatedLayout>
    );
}
