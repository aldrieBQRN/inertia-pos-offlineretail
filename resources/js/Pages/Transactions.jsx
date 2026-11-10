import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, usePage } from '@inertiajs/react';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import usePrinterStore from '@/Stores/usePrinterStore';

export default function Transactions({ auth, initial_transactions, initial_settings }) {
    const { auth: pageAuth } = usePage().props;
    const currentAuth = auth || pageAuth;
    const user = currentAuth?.user;
    // Standalone POS: the single Admin account sees the whole store's sales history
    const isAdmin = true;

    // 1. Core Data States
    const [allTransactions, setAllTransactions] = useState(() => initial_transactions || []);
    const [settings, setSettings] = useState(() => initial_settings || null);
    const [loading, setLoading] = useState(() => !Array.isArray(initial_transactions));
    const [isExporting, setIsExporting] = useState(false);
    const [showDataMenu, setShowDataMenu] = useState(false);

    // View Mode State (List Table vs Cards Grid)
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('pos_transactions_view_mode') || 'table';
        } catch {
            return 'table';
        }
    });

    // Client-Side Pagination State (Balanced: 9 items for 3-col card grid, 10 for 2-col or list table)
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        if (typeof window !== 'undefined') {
            const savedMode = localStorage.getItem('pos_transactions_view_mode');
            if (savedMode === 'grid') {
                return window.innerWidth >= 1280 ? 9 : 10;
            }
        }
        return 10;
    });

    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        try {
            localStorage.setItem('pos_transactions_view_mode', mode);
        } catch {}
        if (mode === 'grid') {
            setItemsPerPage(window.innerWidth >= 1280 ? 9 : 10);
        } else {
            setItemsPerPage(10);
        }
        setCurrentPage(1);
    };

    // Auto-adjust itemsPerPage on window resize when in Card grid view
    useEffect(() => {
        const handleResize = () => {
            if (viewMode === 'grid') {
                const targetItems = window.innerWidth >= 1280 ? 9 : 10;
                setItemsPerPage(prev => (prev !== targetItems ? targetItems : prev));
            } else {
                setItemsPerPage(10);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewMode]);

    // Filter States
    const [statusTab, setStatusTab] = useState('all'); // 'all' | 'cash' | 'digital' | 'discount' | 'void'
    const [datePreset, setDatePreset] = useState('all'); // Default to All Time for all users
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [searchFilter, setSearchFilter] = useState('');
    const [paymentFilter, setPaymentFilter] = useState('');

    // Detail View States
    const [showDetails, setShowDetails] = useState(false);
    const [selectedSale, setSelectedSale] = useState(null);

    // Section Refs for Smooth Auto-Scroll Clearance
    const workspaceSectionRef = useRef(null);
    const pipelineTabsRef = useRef(null);

    // Global Printer Store Access
    const { printReceipt } = usePrinterStore();

    const formatCurrency = (cents) => {
        return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    // Helper for resolving full avatar URLs
    const getAvatarUrl = (path) => {
        if (!path) return null;
        if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/storage/')) {
            return path;
        }
        return `/storage/${path}`;
    };

    // Auto horizontal scroll active tab into view when statusTab changes
    useEffect(() => {
        if (pipelineTabsRef.current) {
            const activeBtn = pipelineTabsRef.current.querySelector(`[data-tab="${statusTab}"]`);
            if (activeBtn) {
                activeBtn.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }, [statusTab]);

    // Smooth Workspace Scrolling with Sticky Header Clearance (Identical to Inventory.jsx)
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

    // Tab Change Handler
    const handleStatusTabChange = (tab) => {
        setStatusTab(tab);
        setCurrentPage(1);
        scrollToWorkspace(tab);
    };

    // Helper for Payment Badge UI
    const getPaymentBadgeStyle = (method) => {
        const m = (method || '').toLowerCase();
        switch (m) {
            case 'cash':
                return 'bg-emerald-50 text-emerald-700 border-emerald-200/70';
            case 'gcash':
                return 'bg-blue-50 text-blue-700 border-blue-200/70';
            case 'maya':
            case 'paymaya':
                return 'bg-emerald-50 text-emerald-800 border-emerald-300/70';
            case 'card':
            case 'credit_card':
                return 'bg-purple-50 text-purple-700 border-purple-200/70';
            case 'debit_card':
                return 'bg-indigo-50 text-indigo-700 border-indigo-200/70';
            case 'bank_transfer':
                return 'bg-sky-50 text-sky-700 border-sky-200/70';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200/70';
        }
    };

    const formatPaymentName = (method) => {
        if (!method) return 'Cash';
        const m = method.toLowerCase();
        if (m === 'cash') return 'Cash';
        if (m === 'gcash') return 'GCash';
        if (m === 'maya' || m === 'paymaya') return 'Maya';
        if (m === 'card' || m === 'credit_card') return 'Credit Card';
        if (m === 'debit_card') return 'Debit Card';
        if (m === 'bank_transfer') return 'Bank Transfer';
        return method.charAt(0).toUpperCase() + method.slice(1);
    };

    // discount_amount arrives as a decimal string ("0.00" when no discount), so compare numerically
    const hasDiscount = (sale) => Boolean(sale && (sale.is_senior || Number(sale.discount_amount) > 0));

    const getDiscountBadgeText = (sale) => {
        if (!hasDiscount(sale)) return null;
        if (sale.discount_type === 'senior') return 'Senior (20%)';
        if (sale.discount_type === 'pwd') return 'PWD (20%)';
        if (sale.discount_type === 'loyalty_5') return 'Loyalty (5%)';
        if (sale.discount_type === 'loyalty_10') return 'VIP (10%)';
        if (sale.discount_type === 'damaged_15') return 'Clearance (15%)';
        if (sale.discount_type === 'custom_percentage') return `Custom (${sale.discount_rate || 0}%)`;
        if (sale.discount_type === 'custom_fixed') return `Custom (-₱${((sale.discount_amount || 0) / 100).toFixed(2)})`;
        if (sale.discount_rate) return `${sale.discount_rate}% Off`;
        if (sale.is_senior) return 'Senior (20%)';
        return 'Discounted';
    };

    const getDiscountBadgeStyle = (sale) => {
        if (sale?.discount_type === 'senior' || sale?.is_senior) {
            return 'bg-amber-50 text-amber-800 border-amber-200/80';
        }
        if (sale?.discount_type === 'pwd') {
            return 'bg-purple-50 text-purple-800 border-purple-200/80';
        }
        return 'bg-sky-50 text-sky-800 border-sky-200/80';
    };

    const handleReprint = async (sale) => {
        try {
            await printReceipt(sale, settings);
            Swal.fire({
                icon: 'success',
                title: 'Receipt Sent to Printer',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500
            });
        } catch (err) {
            console.error(err);
            Swal.fire("Reprint Failed", "Ensure your printer is connected in Settings.", "error");
        }
    };

    // Sync preloaded server-side props on navigation
    useEffect(() => {
        if (Array.isArray(initial_transactions)) {
            setAllTransactions(initial_transactions);
            setLoading(false);
        }
    }, [initial_transactions]);

    useEffect(() => {
        if (initial_settings) {
            setSettings(initial_settings);
        }
    }, [initial_settings]);

    // Initial Load & Background Polling
    useEffect(() => {
        const hasInitialData = Array.isArray(initial_transactions);
        if (!hasInitialData) {
            loadAllTransactions(true);
        }
        if (!initial_settings) {
            fetchSettings();
        }

        const interval = setInterval(() => {
            loadAllTransactions(false);
        }, 6000);

        return () => clearInterval(interval);
    }, []);

    // Reset Pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [startDate, endDate, searchFilter, paymentFilter, statusTab]);

    // Close Data Menu on Outside Click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (showDataMenu && !event.target.closest('.data-menu-container')) {
                setShowDataMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDataMenu]);

    const fetchSettings = async () => {
        try {
            const res = await axios.get('/api/settings');
            setSettings(res.data);
        } catch (e) {}
    };

    const loadAllTransactions = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const response = await axios.get('/api/transactions', { params: { all: true } });
            const data = Array.isArray(response.data) ? response.data : (response.data.data || []);
            setAllTransactions(data);
        } catch (error) {
            console.error("Critical error loading transactions:", error);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    // Quick Date Preset Handler
    const handleDatePreset = (preset) => {
        setDatePreset(preset);
        const now = new Date();
        const formatDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (preset === 'today') {
            const todayStr = formatDate(now);
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (preset === 'yesterday') {
            const yest = new Date(now);
            yest.setDate(yest.getDate() - 1);
            const yestStr = formatDate(yest);
            setStartDate(yestStr);
            setEndDate(yestStr);
        } else if (preset === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 6);
            setStartDate(formatDate(weekAgo));
            setEndDate(formatDate(now));
        } else if (preset === 'month') {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(formatDate(firstDay));
            setEndDate(formatDate(now));
        } else if (preset === 'all') {
            setStartDate('');
            setEndDate('');
        }
        scrollToWorkspace();
    };

    // Base Transactions: Scoped to Current Cashier if non-admin, or Store-wide if Admin
    const baseTransactions = useMemo(() => {
        if (isAdmin) return allTransactions;
        return allTransactions.filter(sale => {
            const cashierId = sale.cashier_id || sale.cashier?.id || sale.user_id;
            return String(cashierId) === String(user?.id);
        });
    }, [allTransactions, user, isAdmin]);

    // SCOPED TRANSACTIONS (Date Range, Cashier, Search & Payment Method Filtered)
    const scopedTransactions = useMemo(() => {
        return baseTransactions.filter(sale => {
            // Search Query
            if (searchFilter) {
                const searchLower = searchFilter.toLowerCase();
                const invoice = (sale.invoice_number || '').toLowerCase();
                const cashier = (sale.cashier?.name || '').toLowerCase();
                const ref = (sale.payment_reference || sale.reference_number || '').toLowerCase();
                const cust = (sale.customer_name || '').toLowerCase();
                const hasMatchingProduct = (sale.items || []).some(item => {
                    const prodName = (item.display_name || item.custom_name || item.product?.name || '').toLowerCase();
                    const prodSku = (item.product?.sku || item.product?.barcode || '').toLowerCase();
                    return prodName.includes(searchLower) || prodSku.includes(searchLower);
                });

                const matches = invoice.includes(searchLower) || cashier.includes(searchLower) || ref.includes(searchLower) || cust.includes(searchLower) || hasMatchingProduct;
                if (!matches) return false;
            }


            // Payment Method Filter
            if (paymentFilter) {
                const saleMethod = (sale.payment_method || 'cash').toLowerCase();
                if (paymentFilter === 'digital') {
                    if (saleMethod === 'cash') return false;
                } else if (saleMethod !== paymentFilter.toLowerCase()) {
                    return false;
                }
            }

            // Date Range Filter
            if (startDate) {
                const saleDate = new Date(sale.created_at || sale.transaction_date).setHours(0, 0, 0, 0);
                const start = new Date(startDate).setHours(0, 0, 0, 0);
                if (saleDate < start) return false;
            }

            if (endDate) {
                const saleDate = new Date(sale.created_at || sale.transaction_date).setHours(23, 59, 59, 999);
                const end = new Date(endDate).setHours(23, 59, 59, 999);
                if (saleDate > end) return false;
            }

            return true;
        });
    }, [baseTransactions, searchFilter, startDate, endDate, paymentFilter, user, isAdmin]);

    // Tab Counts Computation (computed from base transactions)
    const tabCounts = useMemo(() => {
        let all = baseTransactions.length;
        let cash = 0;
        let digital = 0;
        let discount = 0;
        let voided = 0;

        baseTransactions.forEach(sale => {
            if (sale.status === 'void') {
                voided++;
            } else {
                const method = (sale.payment_method || 'cash').toLowerCase();
                if (method === 'cash') {
                    cash++;
                } else {
                    digital++;
                }
            }
            if (hasDiscount(sale)) {
                discount++;
            }
        });

        return { all, cash, digital, discount, voided };
    }, [baseTransactions]);

    // Financial & Cash Drawer Balancing Metrics (Computed from baseTransactions so KPIs remain constant when filtering, just like in Inventory.jsx)
    const kpiMetrics = useMemo(() => {
        let totalValidRevenue = 0;
        let validTransactionsCount = 0;
        let cashRevenue = 0;
        let cashCount = 0;
        let digitalRevenue = 0;
        let digitalCount = 0;
        let totalVoidedRevenue = 0;
        let voidedTransactionsCount = 0;
        let totalItemsSold = 0;

        baseTransactions.forEach(sale => {
            const amount = sale.total_amount || 0;
            if (sale.status === 'void') {
                totalVoidedRevenue += amount;
                voidedTransactionsCount++;
            } else {
                totalValidRevenue += amount;
                validTransactionsCount++;

                const method = (sale.payment_method || 'cash').toLowerCase();
                if (method === 'cash') {
                    cashRevenue += amount;
                    cashCount++;
                } else {
                    digitalRevenue += amount;
                    digitalCount++;
                }

                (sale.items || []).forEach(it => {
                    totalItemsSold += (Number(it.quantity) || 0);
                });
            }
        });

        const aov = validTransactionsCount > 0 ? totalValidRevenue / validTransactionsCount : 0;

        return {
            totalValidRevenue,
            validTransactionsCount,
            cashRevenue,
            cashCount,
            digitalRevenue,
            digitalCount,
            totalVoidedRevenue,
            voidedTransactionsCount,
            totalItemsSold,
            aov
        };
    }, [baseTransactions]);

    // TAB-FILTERED TRANSACTIONS (For Register Table and Pagination)
    const filteredTransactions = useMemo(() => {
        return scopedTransactions.filter(sale => {
            if (statusTab === 'cash') {
                if (sale.status === 'void' || (sale.payment_method || 'cash').toLowerCase() !== 'cash') return false;
            } else if (statusTab === 'digital') {
                if (sale.status === 'void' || (sale.payment_method || 'cash').toLowerCase() === 'cash') return false;
            } else if (statusTab === 'discount') {
                if (!hasDiscount(sale)) return false;
            } else if (statusTab === 'void') {
                if (sale.status !== 'void') return false;
            }
            return true;
        });
    }, [scopedTransactions, statusTab]);

    // Client-side pagination
    const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage) || 1;
    const paginatedTransactions = filteredTransactions.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // EXCEL EXPORT (.xlsx)
    const exportExcel = async () => {
        setIsExporting(true);
        try {
            const exportData = filteredTransactions;
            if (!exportData || exportData.length === 0) {
                Swal.fire('No Data', 'No transactions found to export.', 'info');
                setIsExporting(false);
                return;
            }

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'POS Retail System';
            workbook.created = new Date();

            const sheet = workbook.addWorksheet('Sales Transactions', {
                views: [{ showGridLines: true }]
            });

            const storeName = settings?.store_name || 'POS Store System';
            const storeAddress = settings?.address || '';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

            // Row 1: Store Name
            sheet.mergeCells('A1:I1');
            sheet.getCell('A1').value = storeName.toUpperCase();
            sheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 14 };
            sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(1).height = 24;

            // Row 2: Address
            sheet.mergeCells('A2:I2');
            sheet.getCell('A2').value = storeAddress;
            sheet.getCell('A2').font = { color: { argb: '555555' }, size: 9 };
            sheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(2).height = 16;

            // Row 3: Contact
            sheet.mergeCells('A3:I3');
            sheet.getCell('A3').value = storeContact;
            sheet.getCell('A3').font = { color: { argb: '555555' }, size: 9, italic: true };
            sheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(3).height = 16;

            // Row 4: Report Title
            sheet.mergeCells('A4:I4');
            sheet.getCell('A4').value = 'TRANSACTIONS & SALES AUDIT REPORT';
            sheet.getCell('A4').font = { bold: true, color: { argb: '333333' }, size: 10 };
            sheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(4).height = 18;

            // Row 5: Period & Generation Metadata
            sheet.mergeCells('A5:I5');
            let periodText = 'Period: All Time';
            if (startDate || endDate) periodText = `Period: ${startDate || 'Start'} to ${endDate || 'Present'}`;
            if (paymentFilter) periodText += ` | Payment: ${formatPaymentName(paymentFilter)}`;
            sheet.getCell('A5').value = `${periodText} | Generated: ${new Date().toLocaleString()}`;
            sheet.getCell('A5').font = { color: { argb: '777777' }, size: 9 };
            sheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(5).height = 16;

            // Row 6: Empty spacing row
            sheet.getRow(6).height = 10;

            // Row 7: Table Headers
            const headers = [
                'Invoice #',
                'Date & Time',
                'Cashier',
                'Items Summary',
                'Payment Method',
                'Reference #',
                'Status',
                'Discount Applied',
                'Total Amount'
            ];

            const headerRow = sheet.getRow(7);
            headers.forEach((h, colIndex) => {
                const cell = headerRow.getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: '1B3A69' }
                };
                cell.alignment = { vertical: 'middle', horizontal: colIndex === 8 ? 'right' : (colIndex === 0 || colIndex === 1 || colIndex === 4 || colIndex === 5 || colIndex === 6 || colIndex === 7 ? 'center' : 'left') };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'medium', color: { argb: '0F172A' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            headerRow.height = 25;

            let totalValidSum = 0;
            let totalVoidedSum = 0;
            let totalCash = 0;
            let totalDigital = 0;
            let totalDiscounts = 0;
            let totalItemsSold = 0;
            let validCount = 0;
            let voidedCount = 0;
            let discountCount = 0;
            const paymentBreakdown = {};

            exportData.forEach((sale) => {
                const totalPHP = (sale.total_amount || 0) / 100;
                const itemsCount = (sale.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0);
                const itemsDetails = (sale.items || []).map(i => `${Number(i.quantity) || 1}x ${i.display_name || i.custom_name || i.product?.name || 'Item'}`).join(', ');
                const itemsSummary = `${itemsCount} item(s):\n${itemsDetails}`;
                const paymentMethod = sale.payment_method || 'cash';

                if (sale.status === 'void') {
                    totalVoidedSum += totalPHP;
                    voidedCount++;
                } else {
                    totalValidSum += totalPHP;
                    validCount++;
                    totalItemsSold += itemsCount;
                    if (sale.is_senior) {
                        discountCount++;
                        totalDiscounts += ((sale.discount_amount || 0) / 100);
                    }
                    if (paymentMethod === 'cash') {
                        totalCash += totalPHP;
                    } else {
                        totalDigital += totalPHP;
                    }

                    if (!paymentBreakdown[paymentMethod]) {
                        paymentBreakdown[paymentMethod] = 0;
                    }
                    paymentBreakdown[paymentMethod] += totalPHP;
                }

                const ref = sale.payment_reference || sale.reference_number || 'N/A';
                const discountText = getDiscountBadgeText(sale) || 'No';
                const row = sheet.addRow([
                    sale.invoice_number || 'N/A',
                    sale.created_at ? new Date(sale.created_at).toLocaleString() : 'N/A',
                    sale.cashier?.name || 'Staff',
                    itemsSummary,
                    formatPaymentName(sale.payment_method),
                    ref,
                    sale.status === 'void' ? 'VOIDED' : 'PAID',
                    discountText,
                    totalPHP
                ]);

                row.eachCell((cell, colNumber) => {
                    cell.font = { name: 'Arial', size: 9.5 };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                    };

                    if (colNumber === 4) {
                        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    } else if (colNumber === 9) {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { vertical: 'middle', horizontal: 'right' };
                        if (sale.status === 'void') {
                            cell.font = { name: 'Arial', size: 9.5, color: { argb: 'FFDC2626' }, strike: true };
                        } else {
                            cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                        }
                    } else if (colNumber === 7) {
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                        if (sale.status === 'void') {
                            cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
                        } else {
                            cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: 'FF16A34A' } };
                        }
                    } else if (colNumber === 1 || colNumber === 2 || colNumber === 5 || colNumber === 6 || colNumber === 8) {
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    } else {
                        cell.alignment = { vertical: 'middle', horizontal: 'left' };
                    }
                });
            });

            // Financial Reconciliation Summary Footer Box (Styled 1:1 like Inventory.jsx)
            const summaryStartRow = exportData.length + 9;
            sheet.getRow(summaryStartRow).height = 12; // Spacing row

            // Summary Title Bar
            sheet.mergeCells(`A${summaryStartRow + 1}:I${summaryStartRow + 1}`);
            const summaryTitle = sheet.getCell(`A${summaryStartRow + 1}`);
            summaryTitle.value = 'SALES & FINANCIAL RECONCILIATION SUMMARY';
            summaryTitle.font = { bold: true, color: { argb: '1E293B' }, size: 10 };
            summaryTitle.alignment = { vertical: 'middle', horizontal: 'center' };
            summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
            sheet.getRow(summaryStartRow + 1).height = 22;

            // Summary Row 1: Volume & Count Analytics
            sheet.mergeCells(`A${summaryStartRow + 2}:B${summaryStartRow + 2}`);
            sheet.getCell(`A${summaryStartRow + 2}`).value = `Total Recorded: ${exportData.length} Invoices`;

            sheet.mergeCells(`C${summaryStartRow + 2}:D${summaryStartRow + 2}`);
            sheet.getCell(`C${summaryStartRow + 2}`).value = `Paid: ${validCount} | Voided: ${voidedCount}`;

            sheet.mergeCells(`E${summaryStartRow + 2}:F${summaryStartRow + 2}`);
            sheet.getCell(`E${summaryStartRow + 2}`).value = `Discounted Orders: ${discountCount}`;

            sheet.mergeCells(`G${summaryStartRow + 2}:H${summaryStartRow + 2}`);
            sheet.getCell(`G${summaryStartRow + 2}`).value = `Total Units Sold: ${totalItemsSold} pcs`;

            sheet.getCell(`I${summaryStartRow + 2}`).value = `Avg Ticket: ${(validCount > 0 ? (totalValidSum / validCount) : 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            // Summary Row 2: Financial Channel Breakdown
            sheet.mergeCells(`A${summaryStartRow + 3}:B${summaryStartRow + 3}`);
            sheet.getCell(`A${summaryStartRow + 3}`).value = `Cash In Drawer: ${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            sheet.mergeCells(`C${summaryStartRow + 3}:D${summaryStartRow + 3}`);
            sheet.getCell(`C${summaryStartRow + 3}`).value = `Digital & Cards: ${totalDigital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            sheet.mergeCells(`E${summaryStartRow + 3}:F${summaryStartRow + 3}`);
            sheet.getCell(`E${summaryStartRow + 3}`).value = `Discounts: -${totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            sheet.mergeCells(`G${summaryStartRow + 3}:H${summaryStartRow + 3}`);
            sheet.getCell(`G${summaryStartRow + 3}`).value = `Void Losses: -${totalVoidedSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            sheet.getCell(`I${summaryStartRow + 3}`).value = `Gross Sales: ${totalValidSum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            [summaryStartRow + 2, summaryStartRow + 3].forEach(rowNum => {
                const r = sheet.getRow(rowNum);
                r.height = 24;
                ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
                    const cell = r.getCell(col);
                    cell.font = { bold: true, size: 9, color: { argb: '334155' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'CBD5E1' } },
                        bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                        left: { style: 'thin', color: { argb: 'CBD5E1' } },
                        right: { style: 'thin', color: { argb: 'CBD5E1' } }
                    };
                });
            });

            // Accent Gross Sales & Void Losses
            sheet.getCell(`I${summaryStartRow + 3}`).font = { bold: true, size: 9.5, color: { argb: '16A34A' } };
            sheet.getCell(`G${summaryStartRow + 3}`).font = { bold: true, size: 9, color: { argb: 'DC2626' } };

            // Payment Channel Breakdown Sub-Grid (Distinct Columns for Each Method)
            let currentSummaryRow = summaryStartRow + 4;
            sheet.getRow(currentSummaryRow).height = 8; // Spacing row

            currentSummaryRow++;
            sheet.mergeCells(`A${currentSummaryRow}:I${currentSummaryRow}`);
            const channelHeader = sheet.getCell(`A${currentSummaryRow}`);
            channelHeader.value = 'PAYMENT CHANNEL MIX & REVENUE BREAKDOWN';
            channelHeader.font = { bold: true, color: { argb: '1E293B' }, size: 9.5 };
            channelHeader.alignment = { vertical: 'middle', horizontal: 'center' };
            channelHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
            sheet.getRow(currentSummaryRow).height = 20;

            const channelEntries = Object.entries(paymentBreakdown);
            if (channelEntries.length === 0) {
                currentSummaryRow++;
                sheet.mergeCells(`A${currentSummaryRow}:I${currentSummaryRow}`);
                const emptyCell = sheet.getCell(`A${currentSummaryRow}`);
                emptyCell.value = 'No payment transactions recorded';
                emptyCell.font = { size: 9, italic: true, color: { argb: '64748B' } };
                emptyCell.alignment = { vertical: 'middle', horizontal: 'center' };
                sheet.getRow(currentSummaryRow).height = 22;
            } else {
                const chunks = [];
                for (let i = 0; i < channelEntries.length; i += 4) {
                    chunks.push(channelEntries.slice(i, i + 4));
                }

                const slotRanges = [
                    { start: 'A', end: 'B' },
                    { start: 'C', end: 'D' },
                    { start: 'E', end: 'F' },
                    { start: 'G', end: 'I' }
                ];

                chunks.forEach(chunk => {
                    currentSummaryRow++;
                    const rowNum = currentSummaryRow;
                    sheet.getRow(rowNum).height = 24;

                    chunk.forEach(([method, amt], idx) => {
                        const slot = slotRanges[idx];
                        sheet.mergeCells(`${slot.start}${rowNum}:${slot.end}${rowNum}`);
                        const cell = sheet.getCell(`${slot.start}${rowNum}`);
                        const displayMethod = formatPaymentName(method);
                        const pct = totalValidSum > 0 ? ((amt / totalValidSum) * 100).toFixed(1) : '0.0';
                        cell.value = `${displayMethod}: ${amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}%)`;
                        cell.font = { bold: true, size: 9, color: { argb: '1E293B' } };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    });

                    // Fill remaining empty slots
                    for (let idx = chunk.length; idx < 4; idx++) {
                        const slot = slotRanges[idx];
                        sheet.mergeCells(`${slot.start}${rowNum}:${slot.end}${rowNum}`);
                        const cell = sheet.getCell(`${slot.start}${rowNum}`);
                        cell.value = '—';
                        cell.font = { size: 9, color: { argb: '94A3B8' } };
                        cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    }

                    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(col => {
                        const cell = sheet.getRow(rowNum).getCell(col);
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                        cell.border = {
                            top: { style: 'thin', color: { argb: 'CBD5E1' } },
                            bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                            left: { style: 'thin', color: { argb: 'CBD5E1' } },
                            right: { style: 'thin', color: { argb: 'CBD5E1' } }
                        };
                    });
                });
            }

            sheet.columns = [
                { width: 20 },
                { width: 22 },
                { width: 18 },
                { width: 42 },
                { width: 18 },
                { width: 20 },
                { width: 14 },
                { width: 20 },
                { width: 22 }
            ];

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const filename = `Transactions_Report_${startDate || 'All'}_to_${endDate || 'All'}.xlsx`;
            saveAs(blob, filename);

            Swal.fire({
                icon: 'success',
                title: 'Excel Exported!',
                text: 'Your transactions spreadsheet has been generated successfully.',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        } catch (error) {
            console.error('Excel Generation Error:', error);
            Swal.fire('Error', 'Failed to generate Excel report.', 'error');
        } finally {
            setIsExporting(false);
            setShowDataMenu(false);
        }
    };

    // PDF EXPORT (.pdf)
    const exportPDF = async () => {
        setIsExporting(true);
        try {
            const exportData = filteredTransactions;

            if (!exportData || exportData.length === 0) {
                Swal.fire('No Data', 'No transactions found to export.', 'info');
                setIsExporting(false);
                return;
            }

            const doc = new jsPDF('landscape');
            const pageWidth = doc.internal.pageSize.width;

            const storeName = settings?.store_name || 'POS Retail System';
            const storeAddress = settings?.address || '';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

            let currentY = 20;

            doc.setFontSize(22);
            doc.setTextColor(27, 59, 106);
            doc.setFont(undefined, 'bold');
            doc.text(storeName, 14, currentY);

            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.setFont(undefined, 'normal');

            if (storeAddress) {
                currentY += 6;
                doc.text(storeAddress, 14, currentY);
            }
            if (storeContact) {
                currentY += 5;
                doc.text(storeContact, 14, currentY);
            }

            currentY += 8;
            doc.setDrawColor(229, 231, 235);
            doc.setLineWidth(0.5);
            doc.line(14, currentY, pageWidth - 14, currentY);

            currentY += 10;
            doc.setFontSize(16);
            doc.setTextColor(31, 41, 55);
            doc.setFont(undefined, 'bold');
            doc.text('Sales & Transactions Audit Report', 14, currentY);

            currentY += 6;
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.setFont(undefined, 'normal');

            let filterParts = [];
            if (startDate || endDate) filterParts.push(`Period: ${startDate || 'Start'} to ${endDate || 'Present'}`);
            if (statusTab !== 'all') filterParts.push(`Tab: ${statusTab.toUpperCase()}`);
            if (paymentFilter) filterParts.push(`Payment: ${formatPaymentName(paymentFilter).toUpperCase()}`);
            if (searchFilter) filterParts.push(`Search: "${searchFilter}"`);

            const filterText = filterParts.length > 0 ? filterParts.join(' | ') : 'Period: All Time';
            doc.text(filterText, 14, currentY);

            const generatedText = `Generated: ${new Date().toLocaleString()}`;
            const textWidth = doc.getTextWidth(generatedText);
            doc.text(generatedText, pageWidth - 14 - textWidth, currentY);

            const tableStartY = currentY + 8;

            const tableColumns = ["Invoice #", "Date & Time", "Cashier", "Items Summary", "Payment Method", "Status", "Total Amount"];
            const tableRows = [];
            let totalValidAmount = 0;
            let totalVoidedAmount = 0;
            let totalCash = 0;
            let totalDigital = 0;
            let totalDiscounts = 0;
            let totalItemsSold = 0;
            let validCount = 0;
            let voidedCount = 0;
            let discountCount = 0;
            const paymentBreakdown = {};

            exportData.forEach(sale => {
                const safeItems = sale.items || [];
                const totalItemsCount = safeItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                const itemsDetails = safeItems.map(i => `${Number(i.quantity) || 1}x ${i.display_name || i.custom_name || i.product?.name || 'Item'}`).join(', ');
                const itemsSummary = `${totalItemsCount} item(s):\n${itemsDetails}`;

                const refNum = sale.payment_reference || sale.reference_number;
                const discountText = getDiscountBadgeText(sale);

                let formattedMethod = formatPaymentName(sale.payment_method).toUpperCase();
                const paymentMethodText = formattedMethod
                    + (discountText ? ` (${discountText})` : '')
                    + (refNum ? `\nRef: ${refNum}` : '');

                const total = (sale.total_amount || 0) / 100;
                const paymentMethod = sale.payment_method || 'cash';

                if (sale.status !== 'void') {
                    totalValidAmount += total;
                    validCount++;
                    totalItemsSold += totalItemsCount;
                    if (sale.is_senior) {
                        discountCount++;
                        totalDiscounts += ((sale.discount_amount || 0) / 100);
                    }
                    if (paymentMethod === 'cash') {
                        totalCash += total;
                    } else {
                        totalDigital += total;
                    }

                    if (!paymentBreakdown[paymentMethod]) {
                        paymentBreakdown[paymentMethod] = 0;
                    }
                    paymentBreakdown[paymentMethod] += total;
                } else {
                    totalVoidedAmount += total;
                    voidedCount++;
                }

                tableRows.push([
                    sale.invoice_number || 'N/A',
                    sale.created_at ? new Date(sale.created_at).toLocaleString() : 'N/A',
                    sale.cashier?.name || 'Staff',
                    itemsSummary,
                    paymentMethodText,
                    sale.status === 'void' ? 'VOIDED' : 'PAID',
                    total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                ]);
            });

            autoTable(doc, {
                head: [tableColumns],
                body: tableRows,
                startY: tableStartY,
                theme: 'striped',
                headStyles: { fillColor: '#1B3B6A', textColor: 255, fontStyle: 'bold' },
                styles: { fontSize: 8.5, cellPadding: 3.5, valign: 'middle', overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 32 },
                    1: { cellWidth: 38 },
                    2: { cellWidth: 28 },
                    3: { cellWidth: 'auto', overflow: 'linebreak' },
                    4: { cellWidth: 38 },
                    5: { cellWidth: 22, halign: 'center' },
                    6: { cellWidth: 34, halign: 'right' }
                },
                didParseCell: function(data) {
                    if (data.section === 'body' && data.column.index === 5) {
                        if (data.cell.raw === 'VOIDED') {
                            data.cell.styles.textColor = [220, 38, 38];
                            data.cell.styles.fontStyle = 'bold';
                        } else {
                            data.cell.styles.textColor = [22, 163, 74];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            });

            let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : tableStartY + 20;

            if (finalY > 140) {
                doc.addPage();
                finalY = 20;
            }

            const boxHeight = 56;
            doc.setFillColor(249, 250, 251);
            doc.setDrawColor(229, 231, 235);
            doc.rect(14, finalY, pageWidth - 28, boxHeight, 'FD');

            doc.setFontSize(11);
            doc.setTextColor(27, 59, 106);
            doc.setFont(undefined, 'bold');
            doc.text('SALES & FINANCIAL RECONCILIATION SUMMARY', 20, finalY + 8);

            doc.setFontSize(8.5);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);

            const col1X = 20;
            const col2X = pageWidth / 3 + 10;
            const col3X = (pageWidth / 3) * 2 + 10;
            const avgTicket = validCount > 0 ? totalValidAmount / validCount : 0;

            // Column 1: Operational Counts & Volume
            doc.setFont(undefined, 'bold');
            doc.setTextColor(31, 41, 55);
            doc.text('Volume & Operations', col1X, finalY + 16);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);

            doc.text(`Total Recorded: ${exportData.length} Invoices`, col1X, finalY + 23);
            doc.text(`Paid: ${validCount} | Voided: ${voidedCount}`, col1X, finalY + 29);
            doc.text(`Discounted Orders: ${discountCount}`, col1X, finalY + 35);
            doc.text(`Total Units Sold: ${totalItemsSold} pcs`, col1X, finalY + 41);
            doc.text(`Avg Ticket: ${avgTicket.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col1X, finalY + 47);

            // Column 2: Financial Breakdown
            doc.setFont(undefined, 'bold');
            doc.setTextColor(31, 41, 55);
            doc.text('Financial Breakdown', col2X, finalY + 16);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);

            doc.text(`Cash in Drawer: ${totalCash.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2X, finalY + 23);
            doc.text(`Digital & Cards: ${totalDigital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2X, finalY + 29);
            doc.text(`Discounts: -${totalDiscounts.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2X, finalY + 35);
            
            doc.setTextColor(220, 38, 38);
            doc.text(`Void Losses: -${totalVoidedAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2X, finalY + 41);
            
            doc.setFont(undefined, 'bold');
            doc.setTextColor(22, 163, 74);
            doc.text(`Gross Sales: ${totalValidAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, col2X, finalY + 47);

            // Column 3: Payment Channel Mix
            doc.setFont(undefined, 'bold');
            doc.setTextColor(31, 41, 55);
            doc.text('Payment Channel Mix', col3X, finalY + 16);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);

            let breakdownY = finalY + 23;
            const channelEntries = Object.entries(paymentBreakdown);
            if (channelEntries.length === 0) {
                doc.text('No payments recorded', col3X, breakdownY);
            } else {
                channelEntries.forEach(([method, amount]) => {
                    const displayMethod = formatPaymentName(method);
                    const pct = totalValidAmount > 0 ? ((amount / totalValidAmount) * 100).toFixed(1) : '0.0';
                    doc.text(`${displayMethod}: ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${pct}%)`, col3X, breakdownY);
                    breakdownY += 6;
                });
            }

            const filename = `Transactions_Report_${startDate || 'All'}_to_${endDate || 'All'}.pdf`;
            doc.save(filename);
            Swal.fire({ icon: 'success', title: 'PDF Exported!', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });
        } catch (error) {
            console.error("PDF Generation Error:", error);
            Swal.fire('Error', 'Failed to generate PDF report.', 'error');
        } finally {
            setIsExporting(false);
            setShowDataMenu(false);
        }
    };

    const handleVoid = async (sale) => {
        const result = await Swal.fire({
            title: 'Void Transaction?',
            text: `This will cancel Invoice ${sale.invoice_number} and return items to inventory.`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#DC2626',
            cancelButtonColor: '#64748B',
            confirmButtonText: 'Yes, Void it!'
        });

        if (result.isConfirmed) {
            try {
                await axios.post(`/api/transactions/${sale.id}/void`);
                Swal.fire('Voided!', 'Transaction has been voided.', 'success');
                loadAllTransactions(false);
                if (showDetails) setShowDetails(false);
            } catch (error) {
                Swal.fire('Error', error.response?.data?.message || 'Failed to void.', 'error');
            }
        }
    };

    const handleViewDetails = (sale) => {
        setSelectedSale(sale);
        setShowDetails(true);
    };

    return (
        <AuthenticatedLayout
            user={user}
            header={
                <div>
                    <h2 className="font-black text-xl text-gray-900 tracking-tight">Sales & Transactions</h2>
                    <p className="text-xs font-semibold text-gray-500 mt-0.5">
                        {isAdmin
                            ? 'Monitor store transactions, cash drawer balance, payment channels, and receipt audits'
                            : 'View store sales transactions, receipt reprinting, and payment logs'}
                    </p>
                </div>
            }
        >
            <Head title="Sales & Transactions" />
            <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">

                    {/* ========================================================================= */}
                    {/* 1. EXECUTIVE CASH DRAWER & FINANCIAL BALANCING STRIP                      */}
                    {/* ========================================================================= */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                        
                        {/* KPI 1: Gross Sales (Admin) vs My Shift Sales (Cashier) */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-wider truncate">
                                        {isAdmin ? 'Gross Sales' : 'My Shift Sales'}
                                    </p>
                                    <h3 className="text-base sm:text-2xl font-black text-gray-900 tracking-tight truncate">{formatCurrency(kpiMetrics.totalValidRevenue)}</h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none ring-1 ring-[#CBD7E6] shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 0c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                <span className="truncate">{isAdmin ? 'Completed Orders' : 'My Orders'}</span>
                                <span className="font-bold text-gray-700 truncate shrink-0">{kpiMetrics.validTransactionsCount} orders</span>
                            </div>
                        </div>

                        {/* KPI 2: Cash in Drawer */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-emerald-700 uppercase tracking-wider truncate">
                                        {isAdmin ? 'Cash in Drawer' : 'My Cash in Drawer'}
                                    </p>
                                    <h3 className="text-base sm:text-2xl font-black text-emerald-900 tracking-tight truncate">{formatCurrency(kpiMetrics.cashRevenue)}</h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-emerald-100/70 text-emerald-700 rounded-none ring-1 ring-emerald-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6H2.25m0 0v8.25m0-8.25h19.5m0 0v8.25m0-8.25a.75.75 0 0 0-.75-.75h-.75V4.5m1.5 1.5v8.25a.75.75 0 0 1-.75.75h-.75M3.75 6h16.5m0 0v8.25m0 0a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V6m0 0v8.25" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-emerald-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-emerald-700 gap-1">
                                <span className="truncate">Cash Register</span>
                                <span className="font-bold text-emerald-800 truncate shrink-0">{kpiMetrics.cashCount} sales</span>
                            </div>
                        </div>

                        {/* KPI 3: Digital & E-Wallets */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-indigo-700 uppercase tracking-wider truncate">
                                        {isAdmin ? 'Digital & Cards' : 'My Digital Sales'}
                                    </p>
                                    <h3 className="text-base sm:text-2xl font-black text-indigo-900 tracking-tight truncate">{formatCurrency(kpiMetrics.digitalRevenue)}</h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-indigo-100/70 text-indigo-700 rounded-none ring-1 ring-indigo-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-indigo-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-indigo-700 gap-1">
                                <span className="truncate">E-Wallets & Card</span>
                                <span className="font-bold text-indigo-800 truncate shrink-0">{kpiMetrics.digitalCount} orders</span>
                            </div>
                        </div>

                        {/* KPI 4: Voided Losses (Admin) vs Units Sold & Avg Ticket (Cashier) */}
                        {isAdmin ? (
                            <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                        <p className="text-[10px] sm:text-[11px] font-black text-rose-700 uppercase tracking-wider truncate">Voided Losses</p>
                                        <h3 className="text-base sm:text-2xl font-black text-rose-900 tracking-tight truncate">{formatCurrency(kpiMetrics.totalVoidedRevenue)}</h3>
                                    </div>
                                    <div className="p-2 sm:p-2.5 bg-rose-100/70 text-rose-700 rounded-none ring-1 ring-rose-200 shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-rose-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-rose-700 gap-1">
                                    <span className="truncate">Cancelled</span>
                                    <span className="font-bold text-rose-800 truncate shrink-0">{kpiMetrics.voidedTransactionsCount} voids</span>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                        <p className="text-[10px] sm:text-[11px] font-black text-blue-700 uppercase tracking-wider truncate">Units Sold</p>
                                        <h3 className="text-base sm:text-2xl font-black text-blue-900 tracking-tight truncate">{kpiMetrics.totalItemsSold.toLocaleString()} <span className="text-xs font-semibold text-gray-400">pcs</span></h3>
                                    </div>
                                    <div className="p-2 sm:p-2.5 bg-blue-50 text-blue-600 rounded-none ring-1 ring-blue-100 shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                    <span className="truncate">Sold Volume</span>
                                    <span className="font-bold text-gray-700 truncate shrink-0">{kpiMetrics.totalItemsSold} items</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ========================================================================= */}
                    {/* 2. TRANSACTIONS WORKSPACE: CONNECTED TABS + MAIN CONTENT CARD             */}
                    {/* ========================================================================= */}
                    <div ref={workspaceSectionRef} className="flex flex-col scroll-mt-4">
                        
                        {/* Interactive Pipeline Status Tabs */}
                        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth -mb-px relative z-20 pt-1">
                            <div ref={pipelineTabsRef} className="flex flex-nowrap items-end gap-1 sm:gap-1.5 px-3 w-max min-w-full">
                                
                                {/* Tab 1: All Orders */}
                                <button
                                    data-tab="all"
                                    onClick={() => handleStatusTabChange('all')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'all'
                                            ? 'bg-white text-[#1B3B6A] font-black border-t-[#1B3B6A] border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'all' && (
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
                                    <span>All Transactions</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'all'
                                            ? 'bg-[#1B3B6A] text-white shadow-2xs'
                                            : 'bg-gray-200/80 text-gray-600 group-hover:bg-gray-300 group-hover:text-gray-800'
                                    }`}>
                                        {tabCounts.all}
                                    </span>
                                </button>

                                {/* Tab 2: Cash Only */}
                                <button
                                    data-tab="cash"
                                    onClick={() => handleStatusTabChange('cash')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'cash'
                                            ? 'bg-white text-emerald-800 font-black border-t-emerald-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'cash' && (
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
                                    <span>Cash Checkouts</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'cash'
                                            ? 'bg-emerald-600 text-white shadow-2xs'
                                            : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                                    }`}>
                                        {tabCounts.cash}
                                    </span>
                                </button>

                                {/* Tab 3: Digital & Cards */}
                                <button
                                    data-tab="digital"
                                    onClick={() => handleStatusTabChange('digital')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'digital'
                                            ? 'bg-white text-indigo-800 font-black border-t-indigo-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'digital' && (
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
                                    <span>Digital & Cards</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'digital'
                                            ? 'bg-indigo-600 text-white shadow-2xs'
                                            : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100'
                                    }`}>
                                        {tabCounts.digital}
                                    </span>
                                </button>

                                {/* Tab 4: Senior / PWD */}
                                <button
                                    data-tab="discount"
                                    onClick={() => handleStatusTabChange('discount')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'discount'
                                            ? 'bg-white text-sky-900 font-black border-t-sky-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'discount' && (
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
                                    <span>Discounted</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'discount'
                                            ? 'bg-sky-600 text-white shadow-2xs'
                                            : 'bg-sky-50 text-sky-700 group-hover:bg-sky-100'
                                    }`}>
                                        {tabCounts.discount}
                                    </span>
                                </button>

                                {/* Tab 5: Voided */}
                                <button
                                    data-tab="void"
                                    onClick={() => handleStatusTabChange('void')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'void'
                                            ? 'bg-white text-rose-900 font-black border-t-rose-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'void' && (
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
                                    <span>Voided / Cancelled</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'void'
                                            ? 'bg-rose-600 text-white shadow-2xs'
                                            : 'bg-rose-50 text-rose-700 group-hover:bg-rose-100'
                                    }`}>
                                        {tabCounts.voided}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* MAIN CONTENT CARD: TOOLBAR + TABLE / CARDS + PAGINATION */}
                        <div className="bg-white rounded-none border border-gray-200/80 shadow-sm overflow-hidden flex flex-col relative z-10">
                            
                            {/* SEARCH, FILTER & OPERATIONAL TOOLBAR */}
                            <div className="p-3.5 sm:p-4 bg-white border-b border-gray-100 space-y-3 relative z-10">
                                
                                {/* Tier 1: Search Bar, View Mode Toggle (List vs Cards), Cashier Selector & Payment Filter */}
                                <div className="overflow-x-auto no-scrollbar pb-0.5">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-nowrap gap-2.5 min-w-full sm:min-w-max lg:min-w-0">
                                        
                                        {/* Multi-Attribute Search Input */}
                                        <div className="relative flex-1 min-w-full sm:min-w-[220px] lg:min-w-[260px]">
                                            <input
                                                type="text"
                                                placeholder="Search by Invoice, Cashier, Ref #, or Product inside order..."
                                                className="pl-11 pr-10 py-2.5 bg-gray-50/70 border border-gray-200 rounded-none w-full focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 focus:bg-white text-xs sm:text-sm font-medium transition-all shadow-2xs placeholder:text-gray-400"
                                                value={searchFilter}
                                                onChange={(e) => setSearchFilter(e.target.value)}
                                            />
                                            <svg className="w-5 h-5 text-gray-400 absolute left-3.5 top-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                            </svg>
                                            {searchFilter && (
                                                <button onClick={() => setSearchFilter('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer">
                                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>

                                        {/* View Mode Toggle (Desktop only - List vs Cards) */}
                                        <div className="hidden lg:inline-flex rounded-none bg-gray-100 p-1 border border-gray-200 shrink-0 self-start sm:self-auto">
                                            <button
                                                type="button"
                                                onClick={() => handleViewModeChange('table')}
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
                                                onClick={() => handleViewModeChange('grid')}
                                                className={`p-2 rounded-none transition-all flex items-center gap-1.5 text-xs cursor-pointer ${viewMode === 'grid' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'}`}
                                                title="Card View"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" />
                                                </svg>
                                                <span className="hidden sm:inline">Cards</span>
                                            </button>
                                        </div>

                                        {/* Payment Method Selector */}
                                        <div className="grid grid-cols-2 sm:flex sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                            <div className="col-span-2 w-full sm:w-[155px] lg:w-[170px] shrink-0">
                                                <select
                                                    value={paymentFilter}
                                                    onChange={(e) => setPaymentFilter(e.target.value)}
                                                    className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs w-full cursor-pointer truncate"
                                                >
                                                    <option value="">All Payments</option>
                                                    <option value="cash">Cash</option>
                                                    <option value="gcash">GCash</option>
                                                    <option value="maya">Maya</option>
                                                    <option value="credit_card">Credit Card</option>
                                                    <option value="debit_card">Debit Card</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Tier 2: Transaction Actions Label, Date Range Presets Dropdown & Custom Pickers & Data Export (Admin Only) */}
                                {isAdmin && (
                                    <div className="pt-2.5 border-t border-gray-100 pb-0.5 relative z-20">
                                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 w-full">
                                            
                                            {/* Left Side: Section Label (Desktop Only) */}
                                            <div className="hidden lg:block">
                                                <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Transaction Actions</span>
                                            </div>

                                            {/* Right Side: Custom Date Range (From, To), Date Preset Dropdown, & Export Actions (2x2 on mobile & small tablet, 4 full-width columns on md+, flex on desktop) */}
                                            <div className="grid grid-cols-2 md:grid-cols-4 lg:flex lg:w-auto items-center gap-2 w-full lg:w-auto shrink-0 justify-end">
                                                
                                                {/* Custom Date Range: From */}
                                                <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full lg:w-auto shrink-0 shadow-2xs">
                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">From</span>
                                                    <input
                                                        type="date"
                                                        className="w-full bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                        value={startDate}
                                                        onChange={(e) => { setStartDate(e.target.value); setDatePreset('custom'); }}
                                                    />
                                                </div>

                                                {/* Custom Date Range: To */}
                                                <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full lg:w-auto shrink-0 shadow-2xs">
                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">To</span>
                                                    <input
                                                        type="date"
                                                        className="w-full bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                        value={endDate}
                                                        onChange={(e) => { setEndDate(e.target.value); setDatePreset('custom'); }}
                                                    />
                                                </div>

                                                {/* Date Presets Dropdown (Before Data & Export) */}
                                                <div className="w-full lg:w-[145px] shrink-0">
                                                    <select
                                                        value={datePreset}
                                                        onChange={(e) => handleDatePreset(e.target.value)}
                                                        className="h-[38px] bg-white border border-gray-200 rounded-none py-2 pl-3 pr-7 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs font-semibold transition-all shadow-2xs w-full cursor-pointer truncate"
                                                    >
                                                        <option value="all">All Time</option>
                                                        <option value="today">Today</option>
                                                        <option value="yesterday">Yesterday</option>
                                                        <option value="week">7 Days</option>
                                                        <option value="month">This Month</option>
                                                        {datePreset === 'custom' && <option value="custom">Custom Range</option>}
                                                    </select>
                                                </div>

                                                {/* Data & Export Dropdown (Admin only) */}
                                                <div className="relative data-menu-container w-full lg:w-auto shrink-0">
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowDataMenu(!showDataMenu)}
                                                        className="h-[38px] w-full lg:w-auto justify-center px-3.5 py-2 rounded-none font-bold text-xs sm:text-sm bg-[#EFF4F9] text-[#1B3B6A] hover:bg-[#E2ECF6] border border-[#CBD7E6] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]">
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                        </svg>
                                                        <span>Data & Export</span>
                                                        <svg className={`w-3.5 h-3.5 ml-0.5 text-gray-500 transition-transform duration-200 ${showDataMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                                        </svg>
                                                    </button>

                                                    {showDataMenu && (
                                                        <div className="absolute right-0 top-full mt-2 w-full sm:w-56 bg-white rounded-none shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                                                            <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Reports & Export</div>
                                                            <button
                                                                onClick={exportExcel}
                                                                disabled={isExporting}
                                                                className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors disabled:opacity-50 cursor-pointer"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                                                </svg>
                                                                Export to Excel (.xlsx)
                                                            </button>
                                                            <button
                                                                onClick={exportPDF}
                                                                disabled={isExporting}
                                                                className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors disabled:opacity-50 cursor-pointer"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-rose-600">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                                                </svg>
                                                                Export to PDF Document
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* 3. TABLE VIEW (Desktop List Mode with smooth horizontal scroll for small laptops) */}
                            {viewMode === 'table' && (
                                <div className="hidden lg:block bg-white overflow-hidden">
                                    <div className="overflow-x-auto custom-scrollbar">
                                        <table className="w-full text-left min-w-[1050px] border-collapse">
                                            <thead className="bg-gray-50/80 border-b border-gray-200/80 text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-gray-500 whitespace-nowrap">
                                                <tr>
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Invoice / Status</th>
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Date & Time</th>
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Cashier</th>
                                                    <th className="py-3.5 px-4 whitespace-nowrap min-w-[200px]">Items Summary</th>
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Payment Method</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Total Amount</th>
                                                    <th className="py-3.5 px-4 text-center whitespace-nowrap w-36">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 text-xs sm:text-sm">
                                                {loading ? (
                                                    Array.from({ length: 5 }).map((_, index) => (
                                                        <tr key={`skel-${index}`} className="animate-pulse">
                                                            <td className="p-4 whitespace-nowrap"><div className="h-5 bg-gray-200 rounded-none w-28 mb-1.5"></div><div className="h-4 bg-gray-200 rounded-none w-14"></div></td>
                                                            <td className="p-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded-none w-32"></div></td>
                                                            <td className="p-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded-none w-24"></div></td>
                                                            <td className="p-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded-none w-44"></div></td>
                                                            <td className="p-4 whitespace-nowrap"><div className="h-5 bg-gray-200 rounded-none w-20"></div></td>
                                                            <td className="p-4 text-right whitespace-nowrap"><div className="h-6 bg-gray-200 rounded-none w-24 ml-auto"></div></td>
                                                            <td className="p-4 whitespace-nowrap"><div className="w-16 h-8 bg-gray-200 rounded-none mx-auto"></div></td>
                                                        </tr>
                                                    ))
                                                ) : paginatedTransactions.length === 0 ? (
                                                    <tr>
                                                        <td colSpan="7" className="py-12 px-4 text-center whitespace-nowrap">
                                                            <div className="max-w-xs mx-auto flex flex-col items-center">
                                                                <div className="p-3 bg-gray-100 rounded-none mb-3">
                                                                    <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                                                    </svg>
                                                                </div>
                                                                <h3 className="text-base font-bold text-gray-900">No transactions found</h3>
                                                                <p className="text-xs text-gray-500 mt-1">
                                                                    Try adjusting your search terms, cashier filter, or date presets.
                                                                </p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    paginatedTransactions.map((sale) => {
                                                        const totalItemsCount = (sale.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                                                        const firstItemsPreview = (sale.items || []).map(i => i.display_name || i.custom_name || i.product?.name || 'Item').slice(0, 2).join(', ');

                                                        return (
                                                            <tr key={sale.id} className={`transition-colors whitespace-nowrap ${sale.status === 'void' ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-blue-50/30'}`}>
                                                                
                                                                {/* Invoice # & Status */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className={`font-mono font-black text-sm ${sale.status === 'void' ? 'text-red-500 line-through' : 'text-[#1B3B6A]'}`}>
                                                                        {sale.invoice_number}
                                                                    </div>
                                                                    <div className="flex items-center gap-1 mt-1">
                                                                        <span className={`inline-flex items-center px-2 py-0.5 rounded-none text-[9px] font-black uppercase tracking-widest ${
                                                                            sale.status === 'void'
                                                                                ? 'bg-rose-50 text-rose-700 border border-rose-200/70 shadow-2xs'
                                                                                : 'bg-emerald-50 text-emerald-700 border border-emerald-200/70 shadow-2xs'
                                                                        }`}>
                                                                            {sale.status === 'void' ? 'VOID' : 'PAID'}
                                                                        </span>
                                                                        {hasDiscount(sale) && (
                                                                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-none text-[9px] font-black uppercase tracking-widest bg-sky-50 text-sky-700 border border-sky-200/70 shadow-2xs">
                                                                                Discounted
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>

                                                                {/* Date & Time */}
                                                                <td className="py-3.5 px-4 text-xs text-gray-600 font-medium whitespace-nowrap">
                                                                    <div>{new Date(sale.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                                                    <div className="text-[10px] text-gray-400 font-bold">{new Date(sale.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                                                </td>

                                                                {/* Cashier */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className="flex items-center gap-2.5">
                                                                        {sale.cashier?.avatar_path ? (
                                                                            <img
                                                                                src={getAvatarUrl(sale.cashier.avatar_path)}
                                                                                alt={sale.cashier.name}
                                                                                className="w-9 h-9 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                            />
                                                                        ) : (
                                                                            <div className="w-9 h-9 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-gray-200 flex items-center justify-center font-black text-xs shrink-0 uppercase shadow-2xs">
                                                                                {(sale.cashier?.name || 'S').charAt(0)}
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <span className="font-extrabold text-xs text-gray-900 block truncate max-w-[130px]">
                                                                                {sale.cashier?.name || 'Staff Member'}
                                                                            </span>
                                                                            {isAdmin && (
                                                                                <div className="text-[10px] font-mono font-bold text-gray-400 mt-0.5">
                                                                                    {sale.cashier?.account_number ? `#${sale.cashier.account_number}` : (sale.cashier?.id ? `ID: #${sale.cashier.id}` : 'STAFF')}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                {/* Items Summary Preview */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap max-w-[260px]">
                                                                    <div className="font-bold text-xs text-gray-800 truncate" title={(sale.items || []).map(i => i.display_name || i.custom_name || i.product?.name).join(', ')}>
                                                                        {totalItemsCount} item(s): <span className="font-medium text-gray-500">{firstItemsPreview}{sale.items?.length > 2 ? '...' : ''}</span>
                                                                    </div>
                                                                </td>

                                                                {/* Payment Method & Reference */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className="flex flex-col items-start gap-1">
                                                                        <span className={`inline-block px-2.5 py-0.5 rounded-none text-[10px] font-black tracking-wider uppercase border shadow-2xs ${getPaymentBadgeStyle(sale.payment_method)}`}>
                                                                            {formatPaymentName(sale.payment_method)}
                                                                        </span>
                                                                        {getDiscountBadgeText(sale) && (
                                                                            <span className={`inline-block px-2 py-0.2 rounded-none text-[9px] font-black tracking-wider uppercase border shadow-2xs ${getDiscountBadgeStyle(sale)}`}>
                                                                                {getDiscountBadgeText(sale)}
                                                                            </span>
                                                                        )}
                                                                        {(sale.payment_reference || sale.reference_number) && (
                                                                            <span className="text-[10px] font-mono text-gray-400">
                                                                                Ref: {sale.payment_reference || sale.reference_number}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>

                                                                {/* Total Amount */}
                                                                <td className={`py-3.5 px-4 text-right font-black text-base whitespace-nowrap ${sale.status === 'void' ? 'text-red-400 line-through' : 'text-gray-900'}`}>
                                                                    {formatCurrency(sale.total_amount)}
                                                                </td>

                                                                {/* Actions */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className="flex justify-center items-center gap-1.5 whitespace-nowrap">
                                                                        {/* View Details */}
                                                                        <button
                                                                            onClick={() => handleViewDetails(sale)}
                                                                            className="p-1.5 text-[#1B3B6A] hover:bg-[#EFF4F9] border border-transparent hover:border-[#CBD7E6] rounded-none transition-colors active:scale-95 cursor-pointer"
                                                                            title="View Digital Receipt"
                                                                        >
                                                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                                                            </svg>
                                                                        </button>

                                                                        {sale.status !== 'void' && (
                                                                            <>
                                                                                {/* Reprint Receipt */}
                                                                                <button
                                                                                    onClick={() => handleReprint(sale)}
                                                                                    className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-none transition-colors active:scale-95 cursor-pointer"
                                                                                    title="Reprint Thermal Receipt"
                                                                                >
                                                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                                                                    </svg>
                                                                                </button>

                                                                                {/* Void Order (Admin Only) */}
                                                                                {isAdmin && (
                                                                                    <button
                                                                                        onClick={() => handleVoid(sale)}
                                                                                        className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-none transition-colors active:scale-95 cursor-pointer"
                                                                                        title="Void Order & Restock Items"
                                                                                    >
                                                                                        <svg className="w-4 h-4 fill-none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                                                                        </svg>
                                                                                    </button>
                                                                                )}
                                                                            </>
                                                                        )}
                                                                    </div>
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

                            {/* 4. RESPONSIVE CARD VIEW (Mobile/Tablet always, and Laptop/Desktop when viewMode === 'grid') */}
                            <div className={`${viewMode === 'table' ? 'lg:hidden' : 'block'} p-3.5 sm:p-4 bg-gray-50/40 border-t lg:border-t-0 border-gray-100`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4">
                                    {loading ? (
                                        Array.from({ length: 4 }).map((_, index) => (
                                            <div key={`mob-skel-${index}`} className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs space-y-3 animate-pulse">
                                                <div className="flex justify-between items-start">
                                                    <div className="space-y-1 w-1/2">
                                                        <div className="h-4 bg-gray-200 rounded-none w-3/4"></div>
                                                        <div className="h-3 bg-gray-200 rounded-none w-1/2"></div>
                                                    </div>
                                                    <div className="h-5 bg-gray-200 rounded-none w-1/3"></div>
                                                </div>
                                                <div className="h-10 bg-gray-200 rounded-none w-full"></div>
                                            </div>
                                        ))
                                    ) : paginatedTransactions.length === 0 ? (
                                        <div className="col-span-full bg-white py-10 px-4 rounded-none border border-gray-200/80 text-center text-gray-500 font-bold">
                                            <div className="max-w-xs mx-auto flex flex-col items-center">
                                                <div className="w-10 h-10 bg-gray-100 rounded-none flex items-center justify-center text-gray-400 mb-2">
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                                    </svg>
                                                </div>
                                                <p className="text-gray-900 font-black text-sm">No transactions found</p>
                                                <p className="text-gray-400 text-xs mt-0.5">Try changing your search terms or filters.</p>
                                            </div>
                                        </div>
                                    ) : (
                                        paginatedTransactions.map((sale) => {
                                            const totalItemsCount = (sale.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
                                            const firstItemsPreview = (sale.items || []).map(i => i.display_name || i.custom_name || i.product?.name || 'Item').slice(0, 2).join(', ');

                                            return (
                                                <div
                                                    key={sale.id}
                                                    className={`bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs flex flex-col justify-between gap-3 transition-all hover:shadow-md ${sale.status === 'void' ? 'opacity-85 bg-red-50/20' : ''}`}
                                                >
                                                    {/* Top Row: Invoice #, Status & Amount */}
                                                    <div className="flex justify-between items-start gap-2">
                                                        <div className="min-w-0">
                                                            <div className={`font-mono font-black text-sm tracking-tight truncate ${sale.status === 'void' ? 'text-red-500 line-through' : 'text-[#1B3B6A]'}`}>
                                                                {sale.invoice_number}
                                                            </div>
                                                            <div className="text-[11px] text-gray-400 font-medium mt-0.5">
                                                                {new Date(sale.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-col items-end shrink-0">
                                                            <span className={`px-2 py-0.5 rounded-none text-[9px] font-black uppercase tracking-widest mb-1 ${
                                                                sale.status === 'void'
                                                                    ? 'bg-rose-50 text-rose-700 border border-rose-200/70'
                                                                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200/70'
                                                            }`}>
                                                                {sale.status === 'void' ? 'VOID' : 'PAID'}
                                                            </span>
                                                            <span className={`font-black text-base ${sale.status === 'void' ? 'text-red-400 line-through' : 'text-gray-900'}`}>
                                                                {formatCurrency(sale.total_amount)}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {/* Item Preview Line */}
                                                    <div className="text-xs font-semibold text-gray-600 bg-gray-50/80 p-2.5 rounded-none border border-gray-100">
                                                        <span className="font-bold text-gray-800">{totalItemsCount} item(s):</span> {firstItemsPreview}{sale.items?.length > 2 ? '...' : ''}
                                                    </div>

                                                    {/* Meta Row: Cashier & Payment Method */}
                                                    <div className="flex justify-between items-center text-xs font-bold text-gray-600 pt-0.5">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            {sale.cashier?.avatar_path ? (
                                                                <img
                                                                    src={getAvatarUrl(sale.cashier.avatar_path)}
                                                                    alt={sale.cashier.name}
                                                                    className="w-7 h-7 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                />
                                                            ) : (
                                                                <div className="w-7 h-7 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-[#CBD7E6] flex items-center justify-center font-black text-[10px] shrink-0 uppercase shadow-2xs">
                                                                    {(sale.cashier?.name || 'S').charAt(0)}
                                                                </div>
                                                            )}
                                                            <div className="min-w-0">
                                                                <span className="truncate max-w-[120px] font-extrabold text-gray-900 block text-xs">{sale.cashier?.name || 'Staff'}</span>
                                                                {isAdmin && (
                                                                    <span className="text-[10px] font-mono font-bold text-gray-400 block -mt-0.5">
                                                                        {sale.cashier?.account_number ? `#${sale.cashier.account_number}` : (sale.cashier?.id ? `ID: #${sale.cashier.id}` : '')}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                                                            <span className={`px-2 py-0.5 rounded-none text-[9px] font-black tracking-wider uppercase border shadow-2xs ${getPaymentBadgeStyle(sale.payment_method)}`}>
                                                                {formatPaymentName(sale.payment_method)}
                                                            </span>
                                                            {getDiscountBadgeText(sale) && (
                                                                <span className={`px-1.5 py-0.5 rounded-none text-[9px] font-black uppercase tracking-wider border shadow-2xs ${getDiscountBadgeStyle(sale)}`}>
                                                                    {getDiscountBadgeText(sale)}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Action Buttons */}
                                                    <div className={`grid gap-1.5 pt-1 border-t border-gray-100 ${sale.status === 'void' ? 'grid-cols-1' : (isAdmin ? 'grid-cols-3' : 'grid-cols-2')}`}>
                                                        <button
                                                            onClick={() => handleViewDetails(sale)}
                                                            className="py-2 px-2.5 text-xs font-bold text-[#1B3B6A] bg-[#EFF4F9] hover:bg-[#E2ECF6] rounded-none border border-[#CBD7E6] shadow-2xs active:scale-95 transition-all text-center cursor-pointer"
                                                        >
                                                            Details
                                                        </button>

                                                        {sale.status !== 'void' && (
                                                            <>
                                                                <button
                                                                    onClick={() => handleReprint(sale)}
                                                                    className="py-2 px-2.5 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 rounded-none border border-gray-200 shadow-2xs active:scale-95 transition-all text-center cursor-pointer"
                                                                >
                                                                    Reprint
                                                                </button>

                                                                {isAdmin && (
                                                                    <button
                                                                        onClick={() => handleVoid(sale)}
                                                                        className="py-2 px-2.5 text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-none border border-rose-200 shadow-2xs active:scale-95 transition-all text-center cursor-pointer"
                                                                    >
                                                                        Void
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* 5. SEPARATE PAGINATION (Outside main card, matching Inventory.jsx) */}
                        {!loading && totalPages > 1 && (() => {
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
                                                onClick={() => { setCurrentPage(p => p - 1); scrollToWorkspace(); }}
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
                                                        onClick={() => { setCurrentPage(num); scrollToWorkspace(); }}
                                                        className={`shrink-0 px-2.5 py-1 min-h-[30px] rounded-none text-xs font-bold border transition-all flex items-center justify-center active:scale-95 cursor-pointer ${
                                                            currentPage === num
                                                                ? 'bg-[#1B3B6A] text-white border-[#1B3B6A] shadow-xs font-extrabold'
                                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 shadow-2xs'
                                                        }`}
                                                    >
                                                        {num}
                                                    </button>
                                                )
                                            ))}
                                            <button
                                                disabled={currentPage === totalPages}
                                                onClick={() => { setCurrentPage(p => p + 1); scrollToWorkspace(); }}
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
            </div>

            {/* ========================================================================= */}
            {/* 6. ORDER DETAILS & AUTHENTIC POS RECEIPT MODAL                           */}
            {/* ========================================================================= */}
            {showDetails && selectedSale && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 transition-opacity">
                    <div className="absolute inset-0" onClick={() => setShowDetails(false)}></div>

                    <div className="relative bg-white w-full max-w-md rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[88vh] md:max-h-[90vh] animate-slide-up sm:animate-fade-in-up border border-gray-200/80">

                        {/* Top Pull Bar (Mobile) */}
                        <div className="md:hidden flex justify-center pt-2.5 pb-1 bg-[#1B3B6A] w-full cursor-pointer" onClick={() => setShowDetails(false)}>
                            <div className="w-12 h-1.5 bg-white/30 rounded-none"></div>
                        </div>

                        {/* Modal Header */}
                        <div className="bg-[#1B3B6A] px-6 py-4 flex justify-between items-center text-white shrink-0 shadow-md">
                            <div>
                                <h3 className="text-lg sm:text-xl font-black tracking-tight text-white">Order Receipt</h3>
                                <div className="text-xs text-blue-200 font-mono mt-0.5">{selectedSale.invoice_number}</div>
                            </div>
                            <button
                                onClick={() => setShowDetails(false)}
                                className="bg-white/10 hover:bg-white/20 p-2 rounded-none text-white transition-colors active:scale-95 shrink-0 ml-2 cursor-pointer"
                                title="Close"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Receipt Body: Authentic Thermal Print Paper Style */}
                        <div className="p-4 sm:p-6 overflow-y-auto bg-gray-50/50 space-y-4 font-sans">
                            
                            {/* Store Header Banner */}
                            <div className="text-center pb-2 border-b border-dashed border-gray-200">
                                <h4 className="font-black text-gray-900 text-base">{settings?.store_name || 'POS Retail Store'}</h4>
                                {settings?.address && <p className="text-[11px] text-gray-500">{settings.address}</p>}
                                {settings?.phone && <p className="text-[11px] text-gray-500">Tel: {settings.phone}</p>}
                            </div>

                            {/* Meta Info Bar */}
                            <div className="text-xs text-gray-600 space-y-1 bg-white p-3 rounded-none border border-gray-200/80">
                                <div className="flex justify-between">
                                    <span className="text-gray-400 font-bold uppercase text-[10px]">Date / Time:</span>
                                    <span className="font-semibold text-gray-800">{new Date(selectedSale.created_at).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-gray-400 font-bold uppercase text-[10px]">Cashier:</span>
                                    <span className="font-semibold text-gray-800 flex items-center gap-1.5">
                                        <span>{selectedSale.cashier?.name || 'Staff'}</span>
                                        {isAdmin && (selectedSale.cashier?.account_number || selectedSale.cashier?.id) && (
                                            <span className="font-mono text-[10px] font-bold text-gray-400">
                                                ({selectedSale.cashier.account_number ? `#${selectedSale.cashier.account_number}` : `#${selectedSale.cashier.id}`})
                                            </span>
                                        )}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400 font-bold uppercase text-[10px]">Status:</span>
                                    <span className={`font-black text-[10px] uppercase px-1.5 py-0.2 rounded-none ${
                                        selectedSale.status === 'void' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
                                    }`}>
                                        {selectedSale.status === 'void' ? 'VOIDED / CANCELLED' : 'COMPLETED (PAID)'}
                                    </span>
                                </div>
                            </div>

                            {/* Itemized Line Items Table */}
                            <div className="bg-white rounded-none border border-gray-200/80 overflow-hidden shadow-2xs">
                                <table className="w-full text-xs">
                                    <thead className="bg-gray-50 text-gray-400 uppercase text-[10px] font-black tracking-wider border-b border-gray-100">
                                        <tr>
                                            <th className="text-left py-2.5 px-3">Item</th>
                                            <th className="text-center py-2.5 px-2">Qty</th>
                                            <th className="text-right py-2.5 px-3">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {selectedSale.items?.map((item, idx) => (
                                            <tr key={idx}>
                                                <td className="py-2.5 px-3">
                                                    <div className="font-bold text-gray-900 leading-tight">
                                                        {item.display_name || item.custom_name || item.product?.name || 'Product'} {item.unit_name ? `(${item.unit_name})` : ''}
                                                    </div>
                                                    <div className="text-[10px] text-gray-400 mt-0.5">
                                                        {formatCurrency(item.unit_price)} each
                                                    </div>
                                                </td>
                                                <td className="py-2.5 px-2 text-center font-black text-gray-600">
                                                    {item.quantity}
                                                </td>
                                                <td className="py-2.5 px-3 text-right font-black text-gray-900">
                                                    {formatCurrency((item.unit_price || 0) * (item.quantity || 0))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Modal Footer / Financial Summary */}
                        <div className="bg-white p-4 sm:p-5 border-t border-gray-100 shrink-0 space-y-2 shadow-[0_-10px_20px_-15px_rgba(0,0,0,0.05)]">
                            
                            {/* Payment Method & Ref */}
                            <div className="flex justify-between items-center text-xs font-bold">
                                <span className="text-gray-500 uppercase tracking-wider">Payment Method</span>
                                <span className={`px-2.5 py-0.5 rounded-none uppercase tracking-wider text-[10px] font-black border ${getPaymentBadgeStyle(selectedSale.payment_method)}`}>
                                    {formatPaymentName(selectedSale.payment_method)}
                                </span>
                            </div>

                            {(selectedSale.payment_reference || selectedSale.reference_number) && (
                                <div className="flex justify-between items-center text-xs font-bold">
                                    <span className="text-gray-500 uppercase tracking-wider">Ref Number</span>
                                    <span className="font-mono text-gray-800">
                                        {selectedSale.payment_reference || selectedSale.reference_number}
                                    </span>
                                </div>
                            )}

                            {/* Cash Breakdown */}
                            {selectedSale.payment_method === 'cash' && (
                                <>
                                    <div className="flex justify-between items-center text-xs font-bold">
                                        <span className="text-gray-500 uppercase tracking-wider">Cash Tendered</span>
                                        <span className="text-gray-800">{formatCurrency(selectedSale.cash_given || 0)}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-xs font-bold">
                                        <span className="text-gray-500 uppercase tracking-wider">Change Given</span>
                                        <span className="text-gray-800">{formatCurrency(selectedSale.change || 0)}</span>
                                    </div>
                                </>
                            )}

                            {/* Dynamic Discount Breakdown */}
                            {((selectedSale.discount_amount && Number(selectedSale.discount_amount) > 0) || selectedSale.is_senior) && (() => {
                                const itemsSubtotal = (selectedSale.items || []).reduce((sum, item) => sum + ((item.quantity || 0) * (item.unit_price || 0)), 0);
                                const discountLabel = getDiscountBadgeText(selectedSale) || 'Discount';
                                return (
                                    <div className="space-y-1 pt-1 border-t border-dashed border-gray-200">
                                        <div className="flex justify-between items-center text-xs font-bold">
                                            <span className="text-gray-500 uppercase tracking-wider">Gross Subtotal</span>
                                            <span className="text-gray-800">{formatCurrency(itemsSubtotal)}</span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs font-bold text-emerald-600">
                                            <span className="uppercase tracking-wider">Less: {discountLabel}</span>
                                            <span>-{formatCurrency(selectedSale.discount_amount || 0)}</span>
                                        </div>
                                        {selectedSale.customer_name && (
                                            <div className="flex justify-between items-center text-[11px] font-bold text-gray-600 bg-gray-50 px-2 py-1 rounded-none border border-gray-100">
                                                <span className="text-gray-400 uppercase text-[10px]">Customer:</span>
                                                <span className="text-gray-900">{selectedSale.customer_name}</span>
                                            </div>
                                        )}
                                        {selectedSale.customer_id_number && (
                                            <div className="flex justify-between items-center text-[11px] font-mono font-bold text-gray-600 bg-gray-50 px-2 py-1 rounded-none border border-gray-100">
                                                <span className="text-gray-400 uppercase text-[10px]">ID / Booklet #:</span>
                                                <span className="text-gray-900">{selectedSale.customer_id_number}</span>
                                            </div>
                                        )}
                                        {selectedSale.discount_reason && (
                                            <div className="flex justify-between items-center text-[11px] font-bold text-gray-600 bg-gray-50 px-2 py-1 rounded-none border border-gray-100">
                                                <span className="text-gray-400 uppercase text-[10px]">Reason:</span>
                                                <span className="text-gray-900 truncate max-w-[200px]">{selectedSale.discount_reason}</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Total Paid */}
                            <div className="flex justify-between items-center pt-2 border-t border-dashed border-gray-200">
                                <span className="text-gray-700 text-sm font-black uppercase tracking-wider">Total Paid</span>
                                <span className="text-2xl font-black text-gray-900 tracking-tight">
                                    {formatCurrency(selectedSale.total_amount)}
                                </span>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 pt-2">
                                <button
                                    onClick={() => handleReprint(selectedSale)}
                                    className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-none font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                                    </svg>
                                    <span>Reprint Receipt</span>
                                </button>

                                {selectedSale.status !== 'void' && isAdmin && (
                                    <button
                                        onClick={() => handleVoid(selectedSale)}
                                        className="py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-none font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                                    >
                                        <svg className="w-4 h-4 fill-none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                        <span>Void</span>
                                    </button>
                                )}

                                <button
                                    onClick={() => setShowDetails(false)}
                                    className="py-2.5 px-4 bg-[#1B3B6A] hover:bg-[#142E54] text-white rounded-none font-bold text-xs sm:text-sm transition-all active:scale-95 shadow-md shadow-[#1B3B6A]/15 cursor-pointer"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </AuthenticatedLayout>
    );
}