import React, { useState, useEffect, useMemo, useRef } from 'react';
import { formatQty, productQtyDecimals, isMultiUom } from '@/Utils/quantity';
import axios from 'axios';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link } from '@inertiajs/react';
import {
    AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, Legend
} from 'recharts';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const formatDate = (date) => {
    const d = new Date(date);
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const year = d.getFullYear();
    return `${year}-${month}-${day}`;
};

const formatCurrency = (cents) => {
    return ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatNumber = (num) => {
    return (num || 0).toLocaleString('en-US');
};

// Product quantities: each product's precision (Multiple UOM) and its unit
const formatRowQty = (row, num) => formatQty(num, productQtyDecimals(row));
const rowUnit = (row) => (isMultiUom(row) && row.base_unit ? row.base_unit : null);

const formatPaymentName = (method) => {
    if (!method) return 'Unknown';
    if (method === 'credit_card') return 'Credit Card';
    if (method === 'debit_card') return 'Debit Card';
    if (method === 'gcash') return 'GCash';
    if (method === 'maya') return 'Maya';
    if (method === 'cash') return 'Cash';
    return method.charAt(0).toUpperCase() + method.slice(1);
};

export default function Reports({ auth, initial_report_data }) {
    const user = auth?.user;

    // 1. Core State
    const [loading, setLoading] = useState(() => !initial_report_data);
    const [isFiltering, setIsFiltering] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [showDataMenu, setShowDataMenu] = useState(false);
    const [activeTab, setActiveTab] = useState('sales'); // 'sales' | 'products' | 'inventory' | 'shifts'

    // View Mode (Table vs Grid)
    const [viewMode, setViewMode] = useState(() => {
        try {
            return localStorage.getItem('pos_reports_view_mode') || 'table';
        } catch {
            return 'table';
        }
    });

    // Pagination — independent page state per tab, 5 records per page
    const [pagesByTab, setPagesByTab] = useState({ sales: 1, products: 1, inventory: 1, shifts: 1 });
    const currentPage = pagesByTab[activeTab] ?? 1;
    const setCurrentPage = (updater) => {
        setPagesByTab((prev) => {
            const current = prev[activeTab] ?? 1;
            const next = typeof updater === 'function' ? updater(current) : updater;
            return { ...prev, [activeTab]: Math.max(1, next) };
        });
    };
    const itemsPerPage = 5;

    // Filter States
    const [searchTerm, setSearchTerm] = useState('');
    const [activePreset, setActivePreset] = useState('last_7_days');
    const [startDate, setStartDate] = useState(() => {
        const today = new Date();
        const last7 = new Date(today);
        last7.setDate(last7.getDate() - 6);
        return formatDate(last7);
    });
    const [endDate, setEndDate] = useState(() => formatDate(new Date()));
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');

    // Sorting
    const [sortField, setSortField] = useState('date');
    const [sortOrder, setSortOrder] = useState('desc');

    // Drill-Down Drawer
    const [drawerItem, setDrawerItem] = useState(null);
    const [drawerType, setDrawerType] = useState(null); // 'date' | 'product' | 'shift'
    const [showDrawer, setShowDrawer] = useState(false);

    // Data Store from API / Preloaded
    const [reportData, setReportData] = useState(() => initial_report_data || {
        summary: {
            total_sales: 0,
            total_orders: 0,
            average_order_value: 0,
            total_discounts: 0,
            total_units_sold: 0,
            total_cogs: 0,
            total_gross_profit: 0,
            gross_margin_percent: 0,
            void_count: 0,
            void_amount: 0,
            inventory_skus: 0,
            inventory_units: 0,
            inventory_cost_value: 0,
            inventory_retail_value: 0,
            inventory_unrealized_profit: 0,
        },
        sales_report: {
            daily_breakdown: [],
            hourly_breakdown: [],
            payment_methods: [],
        },
        product_report: {
            products: [],
            top_selling: [],
            category_breakdown: [],
        },
        inventory_report: {
            inventory: [],
            low_stock_count: 0,
            out_of_stock_count: 0,
        },
        shift_report: {
            shifts: [],
            total_shifts: 0,
            total_overage: 0,
            total_shortage: 0,
            net_discrepancy: 0,
        },
        meta: {
            categories: [],
            store: { name: 'POS Store System', address: '', phone: '' },
            date_range: { start_date: '', end_date: '' }
        }
    });

    const dataMenuRef = useRef(null);
    const pipelineTabsRef = useRef(null);
    const workspaceSectionRef = useRef(null);

    // Fetch Reports from Backend (showLoading only on initial mount or full manual reload)
    const fetchReports = async (sDate = startDate, eDate = endDate, showLoading = false) => {
        if (showLoading) {
            setLoading(true);
        } else {
            setIsFiltering(true);
        }
        try {
            const params = {
                start_date: sDate,
                end_date: eDate,
            };
            const response = await axios.get('/api/reports', { params });
            setReportData(response.data);
        } catch (error) {
            console.error("Reports API Error:", error);
            Swal.fire('Error', 'Failed to retrieve reports data.', 'error');
        } finally {
            if (showLoading) setLoading(false);
            setIsFiltering(false);
        }
    };

    const isFirstMountRef = useRef(true);

    // Sync state immediately when server-side initial_report_data prop updates (e.g. back navigation)
    useEffect(() => {
        if (initial_report_data) {
            setReportData(initial_report_data);
            setLoading(false);
        }
    }, [initial_report_data]);

    // Initial preloaded data check
    useEffect(() => {
        if (isFirstMountRef.current) {
            isFirstMountRef.current = false;
            if (!initial_report_data) {
                fetchReports(startDate, endDate, true);
            }
        }
    }, []);

    // Silent background auto-refresh (every 6s)
    useEffect(() => {
        const interval = setInterval(() => {
            fetchReports(startDate, endDate, false);
        }, 6000);

        return () => clearInterval(interval);
    }, [startDate, endDate]);

    // Handle Outside Click for Data Menu
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dataMenuRef.current && !dataMenuRef.current.contains(e.target)) {
                setShowDataMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Quick Date Presets Handler
    const handlePresetChange = (preset) => {
        setActivePreset(preset);
        setCurrentPage(1);
        const today = new Date();
        let start = '';
        let end = formatDate(today);

        switch (preset) {
            case 'all':
                start = '2020-01-01';
                end = formatDate(today);
                break;
            case 'today':
                start = formatDate(today);
                end = start;
                break;
            case 'yesterday':
                const yest = new Date(today);
                yest.setDate(yest.getDate() - 1);
                start = formatDate(yest);
                end = start;
                break;
            case 'this_week':
                const currentDay = today.getDay(); // 0 is Sunday
                const diffToMonday = today.getDate() - currentDay + (currentDay === 0 ? -6 : 1);
                const monday = new Date(today.setDate(diffToMonday));
                start = formatDate(monday);
                end = formatDate(new Date());
                break;
            case 'last_7_days':
                const l7 = new Date();
                l7.setDate(l7.getDate() - 6);
                start = formatDate(l7);
                end = formatDate(new Date());
                break;
            case 'this_month':
                const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
                start = formatDate(firstDayOfMonth);
                end = formatDate(new Date());
                break;
            case 'last_month':
                const firstDayLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                const lastDayLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
                start = formatDate(firstDayLastMonth);
                end = formatDate(lastDayLastMonth);
                break;
            case 'custom':
            default:
                return;
        }

        setStartDate(start);
        setEndDate(end);
        fetchReports(start, end, false);
    };

    // Smoothly center the active tab in the visible area
    useEffect(() => {
        if (pipelineTabsRef.current) {
            const activeBtn = pipelineTabsRef.current.querySelector(`[data-tab="${activeTab}"]`);
            if (activeBtn) {
                activeBtn.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }, [activeTab]);

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

    // Tab Change with Smooth Workspace & Tab Alignment (Same as Inventory Management)
    const handleTabChange = (tabKey) => {
        setActiveTab(tabKey);
        scrollToWorkspace(tabKey);
    };

    // Sort Handler
    const handleSort = (field) => {
        setCurrentPage(1);
        if (sortField === field) {
            setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('desc');
        }
    };

    // View Mode Toggle (9 cards for 3-column grid, 10 cards for 2-column grid, 10 items for list)
    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('pos_reports_view_mode', mode);
        }
        setCurrentPage(1);
    };

    // (Card grids keep 5 records per page as well, per the Reports tab requirement.)

    // Active Dataset based on Active Tab with Instant Zero-Latency Filtering & Sorting
    const currentDataset = useMemo(() => {
        let list = [];
        if (activeTab === 'sales') {
            list = reportData.sales_report.daily_breakdown || [];
        } else if (activeTab === 'products') {
            list = reportData.product_report.products || [];
        } else if (activeTab === 'inventory') {
            list = reportData.inventory_report.items || [];
        } else if (activeTab === 'shifts') {
            list = reportData.shift_report.shifts || [];
        }

        // 1. Instant In-Memory Search Filtering (0ms delay)
        if (searchTerm && searchTerm.trim()) {
            const query = searchTerm.toLowerCase().trim();
            list = list.filter(item => {
                if (activeTab === 'sales') {
                    return (item.date && item.date.toLowerCase().includes(query));
                } else if (activeTab === 'products') {
                    return (
                        (item.name && item.name.toLowerCase().includes(query)) ||
                        (item.sku && item.sku.toLowerCase().includes(query)) ||
                        (item.category_name && item.category_name.toLowerCase().includes(query))
                    );
                } else if (activeTab === 'inventory') {
                    return (
                        (item.name && item.name.toLowerCase().includes(query)) ||
                        (item.sku && item.sku.toLowerCase().includes(query)) ||
                        (item.category_name && item.category_name.toLowerCase().includes(query))
                    );
                } else if (activeTab === 'shifts') {
                    return (
                        (item.cashier_name && item.cashier_name.toLowerCase().includes(query)) ||
                        (String(item.id).includes(query))
                    );
                }
                return true;
            });
        }

        // 2. Instant In-Memory Category Filtering (0ms delay)
        if (selectedCategory && ['products', 'inventory'].includes(activeTab)) {
            list = list.filter(item => String(item.category_id) === String(selectedCategory));
        }


        // 4. Instant In-Memory Payment Method Filtering (Sales)
        if (selectedPaymentMethod && activeTab === 'sales') {
            if (selectedPaymentMethod === 'cash') {
                list = list.filter(item => Number(item.cash_sales || 0) > 0);
            } else if (['gcash', 'maya', 'credit_card', 'debit_card'].includes(selectedPaymentMethod)) {
                list = list.filter(item => Number(item.digital_sales || 0) > 0);
            }
        }

        // 5. Sorting
        return [...list].sort((a, b) => {
            let valA = a[sortField];
            let valB = b[sortField];
            if (valA === undefined || valB === undefined) return 0;
            if (typeof valA === 'string') {
                return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return sortOrder === 'asc' ? valA - valB : valB - valA;
        });
    }, [activeTab, reportData, searchTerm, selectedCategory, selectedPaymentMethod, sortField, sortOrder]);

    const totalPages = Math.ceil(currentDataset.length / itemsPerPage) || 1;
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return currentDataset.slice(start, start + itemsPerPage);
    }, [currentDataset, currentPage, itemsPerPage]);

    // Open Drill-down Drawer
    const handleRowClick = (item, type) => {
        setDrawerItem(item);
        setDrawerType(type);
        setShowDrawer(true);
    };

    // =========================================================================
    // EXPORT TO EXCEL (ExcelJS — Branded Store Theme)
    // =========================================================================
    const exportExcel = async () => {
        setIsExporting(true);
        setShowDataMenu(false);

        try {
            const workbook = new ExcelJS.Workbook();
            const sheetName = activeTab.charAt(0).toUpperCase() + activeTab.slice(1) + ' Report';
            const worksheet = workbook.addWorksheet(sheetName, { views: [{ showGridLines: true }] });

            const storeName = reportData.meta.store.name || 'POS Retail Store';
            const storeAddress = reportData.meta.store.address || '';
            const storeContact = reportData.meta.store.phone ? `Contact: ${reportData.meta.store.phone}` : '';

            // 1. Store Header
            let colCount = 8;
            if (activeTab === 'sales') colCount = 9;
            if (activeTab === 'products') colCount = 9;
            if (activeTab === 'inventory') colCount = 8;
            if (activeTab === 'shifts') colCount = 10;

            const endColLetter = String.fromCharCode(64 + colCount);

            worksheet.mergeCells(`A1:${endColLetter}1`);
            worksheet.getCell('A1').value = storeName.toUpperCase();
            worksheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 16 };
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 28;

            worksheet.mergeCells(`A2:${endColLetter}2`);
            worksheet.getCell('A2').value = storeAddress;
            worksheet.getCell('A2').font = { color: { argb: '555555' }, size: 9 };
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 16;

            worksheet.mergeCells(`A3:${endColLetter}3`);
            worksheet.getCell('A3').value = storeContact;
            worksheet.getCell('A3').font = { color: { argb: '555555' }, size: 9, italic: true };
            worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(3).height = 16;

            worksheet.mergeCells(`A4:${endColLetter}4`);
            worksheet.getCell('A4').value = `OFFICIAL ${activeTab.toUpperCase()} AUDIT REPORT (${startDate} to ${endDate})`;
            worksheet.getCell('A4').font = { bold: true, color: { argb: '333333' }, size: 11 };
            worksheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(4).height = 20;

            worksheet.getRow(5).height = 10;

            // 2. Table Headers & Rows per Domain
            let headers = [];
            if (activeTab === 'sales') {
                headers = ['Date', 'Transactions', 'Gross Revenue', 'Discounts', 'Net Sales', 'Avg Basket (AOV)', 'Cash Sales', 'Digital Sales', 'Voids'];
                worksheet.columns = [
                    { width: 16 }, { width: 14 }, { width: 18 }, { width: 15 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 14 }
                ];
            } else if (activeTab === 'products') {
                headers = ['SKU / Code', 'Product Name', 'Category', 'Selling Price', 'Cost Price', 'Units Sold', 'Total Revenue', 'Gross Profit', 'Margin %'];
                worksheet.columns = [
                    { width: 18 }, { width: 30 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 14 }, { width: 18 }, { width: 18 }, { width: 14 }
                ];
            } else if (activeTab === 'inventory') {
                headers = ['SKU', 'Product Name', 'Category', 'Stock Qty', 'Cost Price', 'Retail Price', 'Total Cost Value', 'Total Retail Value'];
                worksheet.columns = [
                    { width: 18 }, { width: 32 }, { width: 22 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 20 }
                ];
            } else if (activeTab === 'shifts') {
                headers = ['Shift ID', 'Cashier', 'Terminal', 'Open Time', 'Close Time', 'Starting Cash', 'Cash Sales', 'Expected Cash', 'Actual Cash', 'Over / Short'];
                worksheet.columns = [
                    { width: 12 }, { width: 22 }, { width: 16 }, { width: 20 }, { width: 20 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 16 }
                ];
            }

            // Style Header Row (Row 6)
            headers.forEach((h, colIndex) => {
                const cell = worksheet.getRow(6).getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1B3A69' } };
                cell.alignment = { vertical: 'middle', horizontal: colIndex >= 3 ? 'right' : 'left' };
            });
            worksheet.getRow(6).height = 25;

            // Fill Data Rows
            currentDataset.forEach((row, idx) => {
                const rowNum = idx + 7;
                const r = worksheet.getRow(rowNum);

                if (activeTab === 'sales') {
                    r.getCell(1).value = row.date;
                    r.getCell(2).value = row.orders_count;
                    r.getCell(3).value = row.gross_sales / 100;
                    r.getCell(4).value = row.discounts / 100;
                    r.getCell(5).value = row.net_sales / 100;
                    r.getCell(6).value = row.aov / 100;
                    r.getCell(7).value = row.cash_sales / 100;
                    r.getCell(8).value = row.digital_sales / 100;
                    r.getCell(9).value = row.void_count;
                } else if (activeTab === 'products') {
                    r.getCell(1).value = row.sku;
                    r.getCell(2).value = row.name;
                    r.getCell(3).value = row.category_name;
                    r.getCell(4).value = row.unit_retail_price / 100;
                    r.getCell(5).value = row.unit_cost_price / 100;
                    r.getCell(6).value = row.units_sold;
                    r.getCell(7).value = row.total_revenue / 100;
                    r.getCell(8).value = row.total_profit / 100;
                    r.getCell(9).value = `${row.margin_percent}%`;
                } else if (activeTab === 'inventory') {
                    r.getCell(1).value = row.sku;
                    r.getCell(2).value = row.name;
                    r.getCell(3).value = row.category_name;
                    r.getCell(4).value = row.stock_quantity;
                    r.getCell(5).value = row.cost_price / 100;
                    r.getCell(6).value = row.retail_price / 100;
                    r.getCell(7).value = row.total_cost_value / 100;
                    r.getCell(8).value = row.total_retail_value / 100;
                } else if (activeTab === 'shifts') {
                    r.getCell(1).value = `#${row.id}`;
                    r.getCell(2).value = row.cashier_name;
                    r.getCell(3).value = row.terminal_name;
                    r.getCell(4).value = row.start_time ? new Date(row.start_time).toLocaleString() : '—';
                    r.getCell(5).value = row.end_time ? new Date(row.end_time).toLocaleString() : 'Open';
                    r.getCell(6).value = row.starting_cash;
                    r.getCell(7).value = row.cash_sales;
                    r.getCell(8).value = row.expected_cash;
                    r.getCell(9).value = row.actual_cash !== null ? row.actual_cash : '—';
                    r.getCell(10).value = row.difference;
                }

                // Format Alignments & Number formats
                for (let c = 1; c <= colCount; c++) {
                    const cell = r.getCell(c);
                    cell.alignment = { vertical: 'middle', horizontal: c >= 4 ? 'right' : 'left' };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'E2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'E2E8F0' } },
                        right: { style: 'thin', color: { argb: 'E2E8F0' } }
                    };
                }
            });

            // =================================================================
            // SUMMARY FOOTER BOX (Audit Totals & Statistics)
            // =================================================================
            const summaryStartRow = currentDataset.length + 8;
            worksheet.getRow(summaryStartRow).height = 10;

            worksheet.mergeCells(`A${summaryStartRow + 1}:${endColLetter}${summaryStartRow + 1}`);
            const summaryTitleCell = worksheet.getCell(`A${summaryStartRow + 1}`);
            summaryTitleCell.value = `${activeTab.toUpperCase()} AUDIT SUMMARY & TOTALS`;
            summaryTitleCell.font = { bold: true, color: { argb: '1E293B' }, size: 10 };
            summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            summaryTitleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'F1F5F9' }
            };
            worksheet.getRow(summaryStartRow + 1).height = 20;

            if (activeTab === 'sales') {
                const totalGross = currentDataset.reduce((sum, r) => sum + (r.gross_sales || 0), 0);
                const totalDiscounts = currentDataset.reduce((sum, r) => sum + (r.discounts || 0), 0);
                const totalNet = currentDataset.reduce((sum, r) => sum + (r.net_sales || 0), 0);
                const totalOrders = currentDataset.reduce((sum, r) => sum + (r.orders_count || 0), 0);
                const totalVoids = currentDataset.reduce((sum, r) => sum + (r.void_count || 0), 0);

                const summaryRow = worksheet.getRow(summaryStartRow + 2);
                summaryRow.getCell(1).value = `Days / Records: ${currentDataset.length}`;
                summaryRow.getCell(2).value = `Total Orders: ${formatNumber(totalOrders)}`;
                summaryRow.getCell(3).value = `Gross: ${formatCurrency(totalGross)}`;
                summaryRow.getCell(4).value = `Discounts: ${formatCurrency(totalDiscounts)}`;
                summaryRow.getCell(5).value = `Net Sales: ${formatCurrency(totalNet)}`;
                summaryRow.getCell(7).value = `Total Voids: ${totalVoids}`;

                for (let c = 1; c <= colCount; c++) {
                    const cell = summaryRow.getCell(c);
                    cell.font = { bold: true, size: 9, color: { argb: '1E293B' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
                summaryRow.height = 22;
            } else if (activeTab === 'products') {
                const totalUnits = currentDataset.reduce((sum, r) => sum + (r.units_sold || 0), 0);
                const totalRev = currentDataset.reduce((sum, r) => sum + (r.total_revenue || 0), 0);
                const totalProf = currentDataset.reduce((sum, r) => sum + (r.total_profit || 0), 0);
                const avgMargin = totalRev > 0 ? ((totalProf / totalRev) * 100).toFixed(1) : 0;

                const summaryRow = worksheet.getRow(summaryStartRow + 2);
                summaryRow.getCell(1).value = `Products: ${currentDataset.length}`;
                summaryRow.getCell(3).value = `Total Units Sold: ${formatNumber(totalUnits)}`;
                summaryRow.getCell(6).value = `Total Revenue: ${formatCurrency(totalRev)}`;
                summaryRow.getCell(8).value = `Total Profit: ${formatCurrency(totalProf)}`;
                summaryRow.getCell(9).value = `Avg Margin: ${avgMargin}%`;

                for (let c = 1; c <= colCount; c++) {
                    const cell = summaryRow.getCell(c);
                    cell.font = { bold: true, size: 9, color: { argb: '1E293B' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
                summaryRow.height = 22;
            } else if (activeTab === 'inventory') {
                const totalStock = currentDataset.reduce((sum, r) => sum + (r.stock_quantity || 0), 0);
                const totalCost = currentDataset.reduce((sum, r) => sum + (r.total_cost_value || 0), 0);
                const totalRetail = currentDataset.reduce((sum, r) => sum + (r.total_retail_value || 0), 0);
                const projectedProfit = totalRetail - totalCost;

                const summaryRow = worksheet.getRow(summaryStartRow + 2);
                summaryRow.getCell(1).value = `Total SKUs: ${currentDataset.length}`;
                summaryRow.getCell(4).value = `Total Units: ${formatNumber(totalStock)}`;
                summaryRow.getCell(6).value = `Cost Valuation: ${formatCurrency(totalCost)}`;
                summaryRow.getCell(7).value = `Retail Valuation: ${formatCurrency(totalRetail)}`;
                summaryRow.getCell(8).value = `Projected Profit: ${formatCurrency(projectedProfit)}`;

                for (let c = 1; c <= colCount; c++) {
                    const cell = summaryRow.getCell(c);
                    cell.font = { bold: true, size: 9, color: { argb: '1E293B' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
                summaryRow.height = 22;
            } else if (activeTab === 'shifts') {
                const totalStarting = currentDataset.reduce((sum, r) => sum + (parseFloat(r.starting_cash) || 0), 0);
                const totalCashSales = currentDataset.reduce((sum, r) => sum + (parseFloat(r.cash_sales) || 0), 0);
                const totalExpected = currentDataset.reduce((sum, r) => sum + (parseFloat(r.expected_cash) || 0), 0);
                const totalDiff = currentDataset.reduce((sum, r) => sum + (parseFloat(r.difference) || 0), 0);

                const summaryRow = worksheet.getRow(summaryStartRow + 2);
                summaryRow.getCell(1).value = `Total Shifts: ${currentDataset.length}`;
                summaryRow.getCell(4).value = `Total Starting Cash: ${formatCurrency(totalStarting * 100)}`;
                summaryRow.getCell(6).value = `Total Cash Sales: ${formatCurrency(totalCashSales * 100)}`;
                summaryRow.getCell(8).value = `Total Expected: ${formatCurrency(totalExpected * 100)}`;
                summaryRow.getCell(10).value = `Net Variance: ${formatCurrency(totalDiff * 100)}`;

                for (let c = 1; c <= colCount; c++) {
                    const cell = summaryRow.getCell(c);
                    cell.font = { bold: true, size: 9, color: { argb: '1E293B' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                }
                summaryRow.height = 22;
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const safeStorePrefix = (storeName || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            saveAs(blob, `${safeStorePrefix}_${activeTab.toUpperCase()}_Report_${formatDate(new Date())}.xlsx`);

            Swal.fire({
                icon: 'success',
                title: 'Excel Exported!',
                text: `${activeTab.toUpperCase()} report successfully generated.`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500
            });

        } catch (error) {
            console.error("Excel generation error:", error);
            Swal.fire('Error', 'Failed to generate Excel report.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    // =========================================================================
    // EXPORT TO PDF (jsPDF Landscape with Striped AutoTable)
    // =========================================================================
    const exportPDF = () => {
        setIsExporting(true);
        setShowDataMenu(false);

        try {
            const doc = new jsPDF('landscape');
            const pageWidth = doc.internal.pageSize.width;

            const storeName = reportData.meta.store.name || 'POS Retail Store';
            const storeAddress = reportData.meta.store.address || '';
            const storeContact = reportData.meta.store.phone ? `Contact: ${reportData.meta.store.phone}` : '';

            let currentY = 18;

            doc.setFontSize(20);
            doc.setTextColor(31, 41, 55);
            doc.setFont(undefined, 'bold');
            doc.text(storeName, 14, currentY);

            doc.setFontSize(9);
            doc.setTextColor(107, 114, 128);
            doc.setFont(undefined, 'normal');

            if (storeAddress) {
                currentY += 5;
                doc.text(storeAddress, 14, currentY);
            }
            if (storeContact) {
                currentY += 4;
                doc.text(storeContact, 14, currentY);
            }

            currentY += 6;
            doc.setDrawColor(229, 231, 235);
            doc.setLineWidth(0.5);
            doc.line(14, currentY, pageWidth - 14, currentY);

            currentY += 8;
            doc.setFontSize(14);
            doc.setTextColor(31, 41, 55);
            doc.setFont(undefined, 'bold');
            doc.text(`Official ${activeTab.toUpperCase()} Audit & Analysis Report`, 14, currentY);

            currentY += 5;
            doc.setFontSize(9);
            doc.setTextColor(107, 114, 128);
            doc.setFont(undefined, 'normal');
            doc.text(`Reporting Period: ${startDate} to ${endDate}`, 14, currentY);

            const generatedText = `Generated: ${new Date().toLocaleString()}`;
            const textWidth = doc.getTextWidth(generatedText);
            doc.text(generatedText, pageWidth - 14 - textWidth, currentY);

            let tableHead = [];
            let tableBody = [];

            if (activeTab === 'sales') {
                tableHead = [['Date', 'Orders', 'Gross Sales', 'Discounts', 'Net Sales', 'AOV', 'Cash Sales', 'Digital Sales', 'Voids']];
                tableBody = currentDataset.map(r => [
                    r.date,
                    formatNumber(r.orders_count),
                    `P ${formatCurrency(r.gross_sales)}`,
                    `P ${formatCurrency(r.discounts)}`,
                    `P ${formatCurrency(r.net_sales)}`,
                    `P ${formatCurrency(r.aov)}`,
                    `P ${formatCurrency(r.cash_sales)}`,
                    `P ${formatCurrency(r.digital_sales)}`,
                    r.void_count.toString()
                ]);
            } else if (activeTab === 'products') {
                tableHead = [['SKU', 'Product Name', 'Category', 'Price', 'Cost', 'Units Sold', 'Revenue', 'Profit', 'Margin']];
                tableBody = currentDataset.map(r => [
                    r.sku,
                    r.name,
                    r.category_name,
                    `P ${formatCurrency(r.unit_retail_price)}`,
                    `P ${formatCurrency(r.unit_cost_price)}`,
                    `${formatRowQty(r, r.units_sold)}${rowUnit(r) ? ` ${rowUnit(r)}` : ''}`,
                    `P ${formatCurrency(r.total_revenue)}`,
                    `P ${formatCurrency(r.total_profit)}`,
                    `${r.margin_percent}%`
                ]);
            } else if (activeTab === 'inventory') {
                tableHead = [['SKU', 'Product Name', 'Category', 'Stock Qty', 'Cost Price', 'Retail Price', 'Cost Valuation', 'Retail Valuation']];
                tableBody = currentDataset.map(r => [
                    r.sku,
                    r.name,
                    r.category_name,
                    `${formatRowQty(r, r.stock_quantity)}${rowUnit(r) ? ` ${rowUnit(r)}` : ''}`,
                    `P ${formatCurrency(r.cost_price)}`,
                    `P ${formatCurrency(r.retail_price)}`,
                    `P ${formatCurrency(r.total_cost_value)}`,
                    `P ${formatCurrency(r.total_retail_value)}`
                ]);
            } else if (activeTab === 'shifts') {
                tableHead = [['ID', 'Cashier', 'Terminal', 'Open Time', 'Close Time', 'Starting Cash', 'Cash Sales', 'Expected', 'Actual', 'Variance']];
                tableBody = currentDataset.map(r => [
                    `#${r.id}`,
                    r.cashier_name,
                    r.terminal_name,
                    r.start_time ? new Date(r.start_time).toLocaleDateString() : '—',
                    r.end_time ? new Date(r.end_time).toLocaleDateString() : 'Open',
                    `P ${r.starting_cash.toFixed(2)}`,
                    `P ${r.cash_sales.toFixed(2)}`,
                    `P ${r.expected_cash.toFixed(2)}`,
                    r.actual_cash !== null ? `P ${r.actual_cash.toFixed(2)}` : '—',
                    `P ${r.difference.toFixed(2)}`
                ]);
            }

            autoTable(doc, {
                head: tableHead,
                body: tableBody,
                startY: currentY + 6,
                theme: 'striped',
                headStyles: { fillColor: '#1B3A69', textColor: 255, fontStyle: 'bold', fontSize: 8 },
                styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
            });

            let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : currentY + 20;
            if (finalY > 165) {
                doc.addPage();
                finalY = 15;
            }

            // Summary Box
            doc.setFillColor(249, 250, 251);
            doc.setDrawColor(229, 231, 235);
            doc.rect(14, finalY, pageWidth - 28, 26, 'FD');

            doc.setFontSize(10);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(31, 41, 55);
            doc.text('Key Report Summary & Highlights', 20, finalY + 7);

            doc.setFontSize(8.5);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);
            doc.text(`Total Period Revenue: P ${formatCurrency(reportData.summary.total_sales)}`, 20, finalY + 15);
            doc.text(`Gross Profit: P ${formatCurrency(reportData.summary.total_gross_profit)} (${reportData.summary.gross_margin_percent}%)`, 20, finalY + 21);

            doc.text(`Total Transactions: ${formatNumber(reportData.summary.total_orders)}`, pageWidth / 2 - 30, finalY + 15);
            doc.text(`Average Basket: P ${formatCurrency(reportData.summary.average_order_value)}`, pageWidth / 2 - 30, finalY + 21);

            doc.text(`Units Sold: ${formatNumber(reportData.summary.total_units_sold)}`, pageWidth - 80, finalY + 15);
            doc.text(`Total Discounts: P ${formatCurrency(reportData.summary.total_discounts)}`, pageWidth - 80, finalY + 21);

            const safeStorePrefix = (storeName || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            doc.save(`${safeStorePrefix}_${activeTab.toUpperCase()}_Report_${formatDate(new Date())}.pdf`);

            Swal.fire({
                icon: 'success',
                title: 'PDF Exported!',
                text: `${activeTab.toUpperCase()} report successfully generated.`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500
            });

        } catch (error) {
            console.error("PDF generation error:", error);
            Swal.fire('Error', 'Failed to generate PDF report.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    // Print Report (Standard Document Print)
    const handlePrint = () => {
        window.print();
    };

    return (
        <AuthenticatedLayout
            user={auth.user}
            header={
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="font-black text-xl text-gray-900 tracking-tight">Audit & Reports Center</h2>
                        <p className="text-xs font-semibold text-gray-500 mt-0.5">
                            In-depth operational audit, multi-criteria filtering, stock valuation, shift reconciliation, and official exports
                        </p>
                    </div>
                </div>
            }
        >
            <Head title="Reports & Auditing" />

            <div className="py-3 sm:py-8 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-4 sm:px-6 lg:px-8 space-y-6">

                    {/* ========================================================================= */}
                    {/* 1. EXECUTIVE KPI SUMMARY METRIC STRIP (4 CARDS)                           */}
                    {/* ========================================================================= */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
                        
                        {/* KPI 1: Net Sales Revenue */}
                        <div className="p-3 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs flex flex-col justify-between">
                            <div className="flex justify-between items-start gap-1 sm:gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
                                    <p className="text-[10px] sm:text-xs font-bold text-gray-500 uppercase tracking-wider truncate">Net Sales Revenue</p>
                                    <h3 className="text-sm sm:text-2xl font-bold text-gray-900 tracking-tight font-mono truncate">
                                        {formatCurrency(reportData.summary.total_sales)}
                                    </h3>
                                </div>
                                <div className="p-1.5 sm:p-2.5 bg-blue-50 text-blue-700 rounded-none ring-1 ring-blue-100 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-0 text-[10px] sm:text-xs text-gray-500 font-medium">
                                <span className="truncate">{formatNumber(reportData.summary.total_orders)} Orders</span>
                                <span className="font-semibold text-gray-800 font-mono truncate">Avg: {formatCurrency(reportData.summary.average_order_value)}</span>
                            </div>
                        </div>

                        {/* KPI 2: Gross Profit & Margin */}
                        <div className="p-3 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs flex flex-col justify-between">
                            <div className="flex justify-between items-start gap-1 sm:gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
                                    <p className="text-[10px] sm:text-xs font-bold text-emerald-700 uppercase tracking-wider truncate">Gross Profit</p>
                                    <h3 className="text-sm sm:text-2xl font-bold text-emerald-900 tracking-tight font-mono truncate">
                                        {formatCurrency(reportData.summary.total_gross_profit)}
                                    </h3>
                                </div>
                                <div className="p-1.5 sm:p-2.5 bg-emerald-50 text-emerald-700 rounded-none ring-1 ring-emerald-100 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-emerald-50 flex items-center justify-between text-[10px] sm:text-xs text-emerald-700 font-medium">
                                <span>Gross Margin</span>
                                <span className="font-bold text-emerald-800 font-mono">{reportData.summary.gross_margin_percent}%</span>
                            </div>
                        </div>

                        {/* KPI 3: Units Sold & Discounts */}
                        <div className="p-3 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs flex flex-col justify-between">
                            <div className="flex justify-between items-start gap-1 sm:gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
                                    <p className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-wider truncate">Volume & Disc.</p>
                                    <h3 className="text-sm sm:text-2xl font-bold text-gray-900 tracking-tight font-mono truncate">
                                        {formatNumber(reportData.summary.total_units_sold)} <span className="text-[10px] sm:text-sm font-semibold text-gray-400 font-sans">Units</span>
                                    </h3>
                                </div>
                                <div className="p-1.5 sm:p-2.5 bg-amber-50 text-amber-700 rounded-none ring-1 ring-amber-100 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-amber-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-0 text-[10px] sm:text-xs text-gray-500 font-medium">
                                <span className="truncate">Discounts</span>
                                <span className="font-semibold text-amber-700 font-mono truncate">{formatCurrency(reportData.summary.total_discounts)}</span>
                            </div>
                        </div>

                        {/* KPI 4: Stock Valuation & Discrepancies */}
                        <div className="p-3 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs flex flex-col justify-between">
                            <div className="flex justify-between items-start gap-1 sm:gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0 flex-1">
                                    <p className="text-[10px] sm:text-xs font-bold text-purple-700 uppercase tracking-wider truncate">Inventory Value</p>
                                    <h3 className="text-sm sm:text-2xl font-bold text-purple-900 tracking-tight font-mono truncate">
                                        {formatCurrency(reportData.summary.inventory_retail_value)}
                                    </h3>
                                </div>
                                <div className="p-1.5 sm:p-2.5 bg-purple-50 text-purple-700 rounded-none ring-1 ring-purple-100 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-purple-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-0 text-[10px] sm:text-xs text-gray-500 font-medium">
                                <span className="truncate">Cost: {formatCurrency(reportData.summary.inventory_cost_value)}</span>
                                <span className="font-semibold text-purple-700 font-mono shrink-0">{formatNumber(reportData.summary.inventory_skus)} SKUs</span>
                            </div>
                        </div>
                    </div>

                    {/* ========================================================================= */}
                    {/* 2. CONNECTED PIPELINE TABS                                                 */}
                    {/* ========================================================================= */}
                    <div ref={workspaceSectionRef} className="flex flex-col scroll-mt-4">
                        
                        {/* Interactive Pipeline Status Tabs */}
                        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth -mb-px relative z-20 pt-1">
                            <div ref={pipelineTabsRef} className="flex flex-nowrap items-end gap-1 sm:gap-1.5 px-3 w-max min-w-full">
                                
                                {/* Tab 1: Sales & Revenue */}
                                <button
                                    data-tab="sales"
                                    onClick={() => handleTabChange('sales')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        activeTab === 'sales'
                                            ? 'bg-white text-[#1B3A69] font-black border-t-[#1B3A69] border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {activeTab === 'sales' && (
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
                                    <span>Sales & Revenue Audit</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        activeTab === 'sales' ? 'bg-[#1B3A69] text-white shadow-2xs' : 'bg-gray-200 text-gray-700 group-hover:bg-gray-300'
                                    }`}>
                                        {reportData.sales_report.daily_breakdown.length}
                                    </span>
                                </button>

                                {/* Tab 2: Product Performance */}
                                <button
                                    data-tab="products"
                                    onClick={() => handleTabChange('products')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        activeTab === 'products'
                                            ? 'bg-white text-blue-900 font-black border-t-blue-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {activeTab === 'products' && (
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
                                    <span>Products & Categories</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        activeTab === 'products' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-blue-50 text-blue-700 group-hover:bg-blue-100'
                                    }`}>
                                        {reportData.product_report.products.length}
                                    </span>
                                </button>

                                {/* Tab 3: Inventory Valuation */}
                                <button
                                    data-tab="inventory"
                                    onClick={() => handleTabChange('inventory')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        activeTab === 'inventory'
                                            ? 'bg-white text-purple-900 font-black border-t-purple-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {activeTab === 'inventory' && (
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
                                    <span>Inventory Valuation</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        activeTab === 'inventory' ? 'bg-purple-600 text-white shadow-2xs' : 'bg-purple-50 text-purple-700 group-hover:bg-purple-100'
                                    }`}>
                                        {reportData.inventory_report.items.length}
                                    </span>
                                </button>

                                {/* Tab 4: Shift & Cash Reconciliation */}
                                <button
                                    data-tab="shifts"
                                    onClick={() => handleTabChange('shifts')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        activeTab === 'shifts'
                                            ? 'bg-white text-emerald-900 font-black border-t-emerald-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {activeTab === 'shifts' && (
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
                                    <span>Shift & Cash Reconciliation</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        activeTab === 'shifts' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                                    }`}>
                                        {reportData.shift_report.shifts.length}
                                    </span>
                                </button>

                            </div>
                        </div>

                        {/* MAIN CONTENT CARD: TOOLBAR + TABLE / CARDS + PAGINATION */}
                        <div className="bg-white rounded-none border border-gray-200/80 shadow-sm overflow-hidden flex flex-col relative z-10">

                            {/* 3. FULLY RESPONSIVE SEARCH, FILTER & OPERATIONAL TOOLBAR */}
                            <div className="p-3.5 sm:p-4 bg-white border-b border-gray-100 space-y-3 relative z-10">
                                
                                {/* Tier 1: Search Bar, View Mode Toggle (List vs Cards) & Dropdown Filters */}
                                <div className="overflow-x-auto no-scrollbar pb-0.5">
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:flex-nowrap gap-2.5 min-w-full sm:min-w-max lg:min-w-0">
                                        
                                        {/* Multi-Attribute Search Input */}
                                        <div className="relative flex-1 min-w-full sm:min-w-[220px] lg:min-w-[240px]">
                                            <input
                                                type="text"
                                                placeholder={
                                                    activeTab === 'sales' ? 'Search sales, transactions, cashiers...' :
                                                     activeTab === 'products' ? 'Search products, SKUs, categories...' :
                                                    activeTab === 'inventory' ? 'Search inventory items, SKUs...' :
                                                    activeTab === 'shifts' ? 'Search shift logs, cashiers, registers...' :
                                                    'Search staff members, cashiers, emails...'
                                                }
                                                className="pl-11 pr-10 py-2.5 bg-gray-50/70 border border-gray-200 rounded-none w-full focus:border-[#1B3A69] focus:ring-2 focus:ring-[#1B3A69]/10 focus:bg-white text-xs sm:text-sm font-medium transition-all shadow-2xs placeholder:text-gray-400"
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

                                        {/* View Mode Toggle (Desktop only) */}
                                        <div className="hidden lg:inline-flex rounded-none bg-gray-100 p-1 border border-gray-200 shrink-0 self-start sm:self-auto">
                                            <button
                                                type="button"
                                                onClick={() => handleViewModeChange('table')}
                                                className={`p-2 rounded-none transition-all flex items-center gap-1.5 text-xs ${viewMode === 'table' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'}`}
                                                title="List View"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" /></svg>
                                                <span className="hidden sm:inline">List</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleViewModeChange('grid')}
                                                className={`p-2 rounded-none transition-all flex items-center gap-1.5 text-xs ${viewMode === 'grid' ? 'bg-white text-gray-900 shadow-xs font-black' : 'text-gray-500 hover:text-gray-900 font-medium'}`}
                                                title="Cards View"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" /></svg>
                                                <span className="hidden sm:inline">Cards</span>
                                            </button>
                                        </div>

                                        {/* Contextual Dropdowns */}
                                        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                            {/* Category Filter (Sales, Products, Inventory tabs) */}
                                            {['sales', 'products', 'inventory'].includes(activeTab) && (
                                                <select
                                                    value={selectedCategory}
                                                    onChange={(e) => { setSelectedCategory(e.target.value); setCurrentPage(1); }}
                                                    className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3A69] focus:ring-2 focus:ring-[#1B3A69]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs flex-1 sm:flex-none sm:w-[160px] lg:w-[175px] shrink-0 cursor-pointer truncate"
                                                >
                                                    <option value="">All Categories</option>
                                                    {reportData.meta.categories.map(cat => (
                                                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                                                    ))}
                                                </select>
                                            )}

                                            {/* Payment Method Filter (Sales tab) */}
                                            {activeTab === 'sales' && (
                                                <select
                                                    value={selectedPaymentMethod}
                                                    onChange={(e) => { setSelectedPaymentMethod(e.target.value); setCurrentPage(1); }}
                                                    className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3A69] focus:ring-2 focus:ring-[#1B3A69]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs flex-1 sm:flex-none sm:w-[160px] lg:w-[175px] shrink-0 cursor-pointer truncate"
                                                >
                                                    <option value="">All Payment Methods</option>
                                                    <option value="cash">Cash Only</option>
                                                    <option value="gcash">GCash Only</option>
                                                    <option value="maya">Maya Only</option>
                                                    <option value="credit_card">Credit Card Only</option>
                                                    <option value="debit_card">Debit Card Only</option>
                                                </select>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Tier 2: Domain Title (Desktop Left) + Date Presets, Date Picker & Data & Export (Right) */}
                                <div className="pt-2.5 border-t border-gray-100 pb-0.5 relative z-20">
                                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 w-full">
                                        
                                        {/* Left Side: Section Label (Desktop Only) */}
                                        <div className="hidden lg:block">
                                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Report Actions</span>
                                        </div>

                                        {/* Right Side: From, To, Date Presets, Data & Export */}
                                        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 lg:flex lg:w-auto items-center gap-2 w-full lg:w-auto shrink-0 justify-end">
                                            
                                            {/* Custom Date Range: From */}
                                            <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full lg:w-auto shrink-0 shadow-2xs">
                                                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">From</span>
                                                <input
                                                    type="date"
                                                    className="w-full bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                    value={startDate}
                                                    onChange={(e) => {
                                                        const newS = e.target.value;
                                                        setStartDate(newS);
                                                        setActivePreset('');
                                                        setCurrentPage(1);
                                                        fetchReports(newS, endDate, false);
                                                    }}
                                                />
                                            </div>

                                            {/* Custom Date Range: To */}
                                            <div className="h-[38px] flex items-center gap-1.5 bg-white border border-gray-200 rounded-none px-2.5 sm:px-3 py-2 w-full lg:w-auto shrink-0 shadow-2xs">
                                                <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider shrink-0">To</span>
                                                <input
                                                    type="date"
                                                    className="w-full bg-transparent border-none p-0 text-xs font-semibold text-gray-700 focus:ring-0 cursor-pointer"
                                                    value={endDate}
                                                    onChange={(e) => {
                                                        const newE = e.target.value;
                                                        setEndDate(newE);
                                                        setActivePreset('');
                                                        setCurrentPage(1);
                                                        fetchReports(startDate, newE, false);
                                                    }}
                                                />
                                            </div>

                                            {/* Date Presets Dropdown */}
                                            <div className="w-full lg:w-[145px] shrink-0">
                                                <select
                                                    value={activePreset}
                                                    onChange={(e) => handlePresetChange(e.target.value)}
                                                    className="h-[38px] bg-white border border-gray-200 rounded-none py-2 pl-3 pr-7 focus:border-[#1B3A69] focus:ring-2 focus:ring-[#1B3A69]/10 text-gray-700 text-xs font-semibold transition-all shadow-2xs w-full cursor-pointer truncate"
                                                >
                                                    <option value="all">All Time</option>
                                                    <option value="today">Today</option>
                                                    <option value="yesterday">Yesterday</option>
                                                    <option value="last_7_days">Last 7 Days</option>
                                                    <option value="this_month">This Month</option>
                                                    <option value="last_month">Last Month</option>
                                                </select>
                                            </div>

                                            {/* Data & Export Dropdown Button */}
                                            <div className="relative data-menu-container w-full lg:w-auto shrink-0" ref={dataMenuRef}>
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDataMenu(!showDataMenu)}
                                                    className="h-[38px] w-full lg:w-auto justify-center px-3.5 py-2 rounded-none font-bold text-xs sm:text-sm bg-[#EFF4F9] text-[#1B3A69] hover:bg-[#E2ECF6] border border-[#CBD7E6] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3A69]">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                                    </svg>
                                                    <span>Data & Export</span>
                                                    <svg className={`w-3.5 h-3.5 ml-0.5 text-gray-500 transition-transform duration-200 ${showDataMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </button>

                                                {showDataMenu && (
                                                    <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-none shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                                                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Reports & Export</div>
                                                        <button
                                                            onClick={exportExcel}
                                                            disabled={isExporting}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600">
                                                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                                                            </svg>
                                                            Export to Excel (.xlsx)
                                                        </button>
                                                        <button
                                                            onClick={exportPDF}
                                                            disabled={isExporting}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors cursor-pointer"
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
                            </div>

                            {/* ========================================================================= */}
                            {/* 4.5 DOMAIN-SPECIFIC REPORT CHARTS & ANALYTICS VISUALIZATION               */}
                            {/* ========================================================================= */}
                            {!loading && (
                                <div className="p-3.5 sm:p-4 bg-gray-50/30 border-b border-gray-100 space-y-4">
                                    
                                    {/* ----------------------------------------------------------------- */}
                                    {/* 📊 TAB 1: SALES & REVENUE VISUALIZATIONS                          */}
                                    {/* ----------------------------------------------------------------- */}
                                    {activeTab === 'sales' && (
                                        <div className="space-y-3">
                                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5">
                                                
                                                {/* Chart 1: Revenue & Order Velocity Trend (8 Cols) */}
                                                <div className="lg:col-span-8 p-4 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3">
                                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                        <div>
                                                            <h4 className="font-bold text-sm sm:text-base text-gray-900">
                                                                Sales Revenue & Trend Over Time
                                                            </h4>
                                                            <p className="text-xs text-gray-500 font-medium mt-0.5">Daily gross and net revenue performance</p>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs">
                                                            <span className="flex items-center gap-1 text-gray-600 font-semibold text-xs">
                                                                <span className="w-2.5 h-2.5 rounded-none bg-[#1B3A69]"></span> Gross
                                                            </span>
                                                            <span className="flex items-center gap-1 text-emerald-600 font-semibold text-xs">
                                                                <span className="w-2.5 h-2.5 rounded-none bg-emerald-500"></span> Cash
                                                            </span>
                                                            <span className="flex items-center gap-1 text-blue-600 font-semibold text-xs">
                                                                <span className="w-2.5 h-2.5 rounded-none bg-blue-500"></span> Digital
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="h-56 sm:h-64 w-full">
                                                        {reportData.sales_report.daily_breakdown.length === 0 ? (
                                                            <div className="h-full flex items-center justify-center text-xs text-gray-400 font-medium">
                                                                No sales trend data recorded for selected period
                                                            </div>
                                                        ) : (
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <AreaChart
                                                                    data={[...reportData.sales_report.daily_breakdown].reverse()}
                                                                    margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                                                                >
                                                                    <defs>
                                                                        <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                                                                            <stop offset="5%" stopColor="#1B3A69" stopOpacity={0.25}/>
                                                                            <stop offset="95%" stopColor="#1B3A69" stopOpacity={0.0}/>
                                                                        </linearGradient>
                                                                    </defs>
                                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                                                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} />
                                                                    <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v >= 1000 ? (v/1000).toFixed(0) + 'k' : v}`} />
                                                                    <Tooltip
                                                                        content={({ active, payload, label }) => {
                                                                            if (active && payload && payload.length) {
                                                                                const d = payload[0].payload;
                                                                                return (
                                                                                    <div className="bg-white p-3 rounded-none shadow-xl border border-gray-200 text-xs space-y-1 z-50">
                                                                                        <p className="font-bold text-gray-900">{label}</p>
                                                                                        <div className="space-y-0.5 pt-1 border-t border-gray-100 text-xs">
                                                                                            <p className="text-[#1B3A69] font-bold">Gross Sales: {formatCurrency(d.gross_sales)}</p>
                                                                                            <p className="text-emerald-700 font-semibold">Cash: {formatCurrency(d.cash_sales)}</p>
                                                                                            <p className="text-blue-700 font-semibold">Digital: {formatCurrency(d.digital_sales)}</p>
                                                                                            <p className="text-amber-700 font-semibold">Discounts: {formatCurrency(d.discounts)}</p>
                                                                                            <p className="text-gray-500">{d.orders_count} transactions</p>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        }}
                                                                    />
                                                                    <Area type="monotone" dataKey={(d) => d.gross_sales / 100} stroke="#1B3A69" strokeWidth={2.5} fillOpacity={1} fill="url(#colorSales)" />
                                                                </AreaChart>
                                                            </ResponsiveContainer>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Chart 2: Payment Method Breakdown (4 Cols) */}
                                                <div className="lg:col-span-4 p-4 rounded-none bg-white border border-gray-200/80 shadow-2xs space-y-3 flex flex-col justify-between">
                                                    <div>
                                                        <h4 className="font-bold text-sm text-gray-900">
                                                            Payment Method Mix
                                                        </h4>
                                                        <p className="text-[11px] text-gray-400 font-medium">Revenue share per tender channel</p>
                                                    </div>

                                                    <div className="h-44 w-full relative flex items-center justify-center">
                                                        {reportData.sales_report.payment_methods.length === 0 ? (
                                                            <div className="text-xs text-gray-400 font-medium">No payment breakdown</div>
                                                        ) : (
                                                            <ResponsiveContainer width="100%" height="100%">
                                                                <PieChart>
                                                                    <Pie
                                                                        data={reportData.sales_report.payment_methods}
                                                                        dataKey="total_amount"
                                                                        nameKey="method"
                                                                        innerRadius={45}
                                                                        outerRadius={68}
                                                                        paddingAngle={3}
                                                                    >
                                                                        {reportData.sales_report.payment_methods.map((entry, index) => {
                                                                            const colors = ['#10B981', '#2563EB', '#06B6D4', '#8B5CF6', '#F59E0B', '#EC4899'];
                                                                            return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                                                                        })}
                                                                    </Pie>
                                                                    <Tooltip
                                                                        content={({ active, payload }) => {
                                                                            if (active && payload && payload.length) {
                                                                                const d = payload[0].payload;
                                                                                return (
                                                                                    <div className="bg-white p-2.5 rounded-none shadow-xl border border-gray-200 text-xs z-50">
                                                                                        <p className="font-bold text-gray-900">{formatPaymentName(d.method)}</p>
                                                                                        <p className="text-[#1B3A69] font-bold">{formatCurrency(d.total_amount)}</p>
                                                                                        <p className="text-gray-400 text-[10px]">{d.percentage}% of revenue ({d.count} orders)</p>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        }}
                                                                    />
                                                                </PieChart>
                                                            </ResponsiveContainer>
                                                        )}
                                                    </div>

                                                    {/* Legend List */}
                                                    <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-gray-100 text-[11px]">
                                                        {reportData.sales_report.payment_methods.map((pm, i) => {
                                                            const colors = ['bg-emerald-500', 'bg-blue-600', 'bg-cyan-500', 'bg-purple-500', 'bg-amber-500', 'bg-pink-500'];
                                                            return (
                                                                <div key={i} className="flex items-center justify-between p-1 bg-gray-50/70 rounded-none">
                                                                    <span className="flex items-center gap-1 text-gray-600 font-medium">
                                                                        <span className={`w-2 h-2 rounded-none ${colors[i % colors.length]}`}></span>
                                                                        {formatPaymentName(pm.method)}
                                                                    </span>
                                                                    <span className="font-bold text-gray-900">{pm.percentage}%</span>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ----------------------------------------------------------------- */}
                                    {/* TAB 2: PRODUCT PERFORMANCE & VELOCITY VISUALIZATIONS               */}
                                    {/* ----------------------------------------------------------------- */}
                                    {activeTab === 'products' && (
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4">
                                            
                                            {/* Chart 1: Top Selling Products (7 Cols) */}
                                            <div className="lg:col-span-7 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                            Top Selling Products by Volume
                                                        </h4>
                                                        <p className="text-xs text-gray-500 font-medium mt-0.5">Most demanded item inventory</p>
                                                    </div>
                                                    <span className="px-2.5 py-0.5 bg-blue-50 text-blue-700 font-bold text-xs rounded-none">Top Movers</span>
                                                </div>

                                                <div className="h-56 sm:h-64 w-full">
                                                    {reportData.product_report.products.length === 0 ? (
                                                        <div className="h-full flex items-center justify-center text-xs text-gray-400 font-medium">
                                                            No product sales recorded for this period
                                                        </div>
                                                    ) : (
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart
                                                                data={reportData.product_report.products.slice(0, 6)}
                                                                layout="vertical"
                                                                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                                                            >
                                                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F1F5F9" />
                                                                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} />
                                                                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#334155' }} width={90} axisLine={false} tickLine={false} />
                                                                <Tooltip
                                                                    content={({ active, payload }) => {
                                                                        if (active && payload && payload.length) {
                                                                            const d = payload[0].payload;
                                                                            return (
                                                                                <div className="bg-white p-3 rounded-none shadow-xl border border-gray-200 text-xs space-y-1 z-50">
                                                                                    <p className="font-bold text-gray-900">{d.name}</p>
                                                                                    <p className="text-[#1B3A69] font-bold">{d.units_sold} Units Sold</p>
                                                                                    <p className="text-gray-700 font-semibold">Revenue: {formatCurrency(d.total_revenue)}</p>
                                                                                    <p className="text-emerald-700 font-semibold">Profit: {formatCurrency(d.total_profit)} ({d.margin_percent}%)</p>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }}
                                                                />
                                                                <Bar dataKey="units_sold" fill="#1B3A69" radius={0} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Chart 2: Category Revenue Performance (5 Cols) */}
                                            <div className="lg:col-span-5 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3 flex flex-col justify-between">
                                                <div>
                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                        Category Revenue Contribution
                                                    </h4>
                                                    <p className="text-xs text-gray-500 font-medium mt-0.5">Revenue generated per department</p>
                                                </div>

                                                <div className="h-56 sm:h-64 w-full">
                                                    {reportData.product_report.categories.length === 0 ? (
                                                        <div className="h-full flex items-center justify-center text-xs text-gray-400 font-medium">
                                                            No category data available
                                                        </div>
                                                    ) : (
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart data={reportData.product_report.categories.slice(0, 5)}>
                                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                                                                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v/100000).toFixed(0)}k`} />
                                                                <Tooltip
                                                                    content={({ active, payload }) => {
                                                                        if (active && payload && payload.length) {
                                                                            const d = payload[0].payload;
                                                                            return (
                                                                                <div className="bg-white p-3 rounded-none shadow-xl border border-gray-200 text-xs space-y-1 z-50">
                                                                                    <p className="font-bold text-gray-900">{d.name}</p>
                                                                                    <p className="text-purple-700 font-bold">Revenue: {formatCurrency(d.total_revenue)}</p>
                                                                                    <p className="text-emerald-700 font-semibold">Profit: {formatCurrency(d.total_profit)}</p>
                                                                                    <p className="text-gray-400 text-xs">{d.revenue_share}% revenue share</p>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }}
                                                                />
                                                                <Bar dataKey="total_revenue" fill="#8B5CF6" radius={0} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ----------------------------------------------------------------- */}
                                    {/* TAB 3: INVENTORY HEALTH & VALUATION VISUALIZATIONS                 */}
                                    {/* ----------------------------------------------------------------- */}
                                    {activeTab === 'inventory' && (
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4">
                                            
                                            {/* Chart 1: Stock Health Composition (4 Cols) */}
                                            <div className="lg:col-span-4 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3 flex flex-col justify-between">
                                                <div>
                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                        Stock Health Breakdown
                                                    </h4>
                                                    <p className="text-xs text-gray-500 font-medium mt-0.5">Inventory level status distribution</p>
                                                </div>

                                                <div className="h-56 sm:h-64 w-full flex items-center justify-center">
                                                    <ResponsiveContainer width="100%" height="100%">
                                                        <PieChart>
                                                            <Pie
                                                                data={[
                                                                    { name: 'Healthy', value: reportData.summary.healthy_stock_count, color: '#10B981' },
                                                                    { name: 'Low Stock', value: reportData.summary.low_stock_count, color: '#F59E0B' },
                                                                    { name: 'Out of Stock', value: reportData.summary.out_of_stock_count, color: '#EF4444' },
                                                                ]}
                                                                dataKey="value"
                                                                nameKey="name"
                                                                innerRadius={45}
                                                                outerRadius={68}
                                                                paddingAngle={3}
                                                            >
                                                                <Cell fill="#10B981" />
                                                                <Cell fill="#F59E0B" />
                                                                <Cell fill="#EF4444" />
                                                            </Pie>
                                                            <Tooltip
                                                                content={({ active, payload }) => {
                                                                    if (active && payload && payload.length) {
                                                                        const d = payload[0].payload;
                                                                        return (
                                                                            <div className="bg-white p-2.5 rounded-none shadow-xl border border-gray-200 text-xs">
                                                                                <p className="font-bold text-gray-900">{d.name}</p>
                                                                                <p className="font-bold text-gray-700">{d.value} SKUs</p>
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return null;
                                                                    }}
                                                            />
                                                        </PieChart>
                                                    </ResponsiveContainer>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-100 text-center">
                                                    <div className="p-2 rounded-none bg-emerald-50 text-emerald-800">
                                                        <p className="text-xs text-emerald-600 font-semibold">Healthy</p>
                                                        <p className="text-sm font-bold">{reportData.summary.healthy_stock_count}</p>
                                                    </div>
                                                    <div className="p-2 rounded-none bg-amber-50 text-amber-800">
                                                        <p className="text-xs text-amber-600 font-semibold">Low Stock</p>
                                                        <p className="text-sm font-bold">{reportData.summary.low_stock_count}</p>
                                                    </div>
                                                    <div className="p-2 rounded-none bg-rose-50 text-rose-800">
                                                        <p className="text-xs text-rose-600 font-semibold">Depleted</p>
                                                        <p className="text-sm font-bold">{reportData.summary.out_of_stock_count}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Summary 2: Valuation Aggregates (8 Cols) */}
                                            <div className="lg:col-span-8 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3 flex flex-col justify-between">
                                                <div>
                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                        Total Inventory Capitalization
                                                    </h4>
                                                    <p className="text-xs text-gray-500 font-medium mt-0.5">Asset valuations and estimated profit potential</p>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                                    <div className="p-4 rounded-none bg-gray-50 border border-gray-100 space-y-1">
                                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Cost Invested</span>
                                                        <p className="text-lg sm:text-xl font-bold text-gray-900">{formatCurrency(reportData.inventory_report.total_cost_value)}</p>
                                                        <p className="text-xs text-gray-400">Total acquisition cost</p>
                                                    </div>
                                                    <div className="p-4 rounded-none bg-[#EFF4F9] border border-[#CBD7E6] space-y-1">
                                                        <span className="text-xs font-bold text-[#1B3A69] uppercase tracking-wider">Retail Valuation</span>
                                                        <p className="text-lg sm:text-xl font-bold text-gray-900">{formatCurrency(reportData.inventory_report.total_retail_value)}</p>
                                                        <p className="text-xs text-gray-500">Gross market potential</p>
                                                    </div>
                                                    <div className="p-4 rounded-none bg-emerald-50 border border-emerald-100 space-y-1">
                                                        <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Expected Profit</span>
                                                        <p className="text-lg sm:text-xl font-bold text-emerald-700">{formatCurrency(reportData.inventory_report.potential_profit)}</p>
                                                        <p className="text-xs text-emerald-600 font-semibold">{reportData.inventory_report.potential_margin}% Projected Margin</p>
                                                    </div>
                                                </div>

                                                <div className="p-3 bg-blue-50/40 rounded-none border border-blue-100 flex items-center justify-between text-xs">
                                                    <span className="text-blue-900 font-medium">Catalog Health: <strong>{reportData.summary.total_skus}</strong> unique SKUs in active database</span>
                                                    <Link href="/inventory" className="font-bold text-[#1B3A69] hover:underline cursor-pointer">Manage Inventory →</Link>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ----------------------------------------------------------------- */}
                                    {/* TAB 4: SHIFT AUDITS & DRAWER RECONCILIATION VISUALIZATIONS        */}
                                    {/* ----------------------------------------------------------------- */}
                                    {activeTab === 'shifts' && (
                                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 sm:gap-4">
                                            
                                            {/* Chart 1: Expected vs Actual Counted Cash (7 Cols) */}
                                            <div className="lg:col-span-7 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                            Expected vs. Actual Cash Reconciled
                                                        </h4>
                                                        <p className="text-xs text-gray-500 font-medium mt-0.5">Per-shift drawer variance reconciliation</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs">
                                                        <span className="flex items-center gap-1 text-emerald-700 font-bold text-xs">
                                                            <span className="w-2.5 h-2.5 rounded-none bg-emerald-600"></span> Actual
                                                        </span>
                                                        <span className="flex items-center gap-1 text-gray-500 font-bold text-xs">
                                                            <span className="w-2.5 h-2.5 rounded-none bg-gray-400"></span> Expected
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="h-56 sm:h-64 w-full">
                                                    {reportData.shift_report.shifts.length === 0 ? (
                                                        <div className="h-full flex items-center justify-center text-xs text-gray-400 font-medium">
                                                            No shift records logged for this period
                                                        </div>
                                                    ) : (
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <BarChart data={[...reportData.shift_report.shifts].slice(0, 8)}>
                                                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                                                                <XAxis dataKey="cashier_name" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                                                                <YAxis tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}`} />
                                                                <Tooltip
                                                                    content={({ active, payload }) => {
                                                                        if (active && payload && payload.length) {
                                                                            const d = payload[0].payload;
                                                                            return (
                                                                                <div className="bg-white p-3 rounded-none shadow-xl border border-gray-200 text-xs space-y-1 z-50">
                                                                                    <p className="font-bold text-gray-900">{d.cashier_name} (Shift #{d.id})</p>
                                                                                    <p className="text-emerald-700 font-bold">Actual: {d.actual_cash !== null && d.actual_cash !== undefined ? Number(d.actual_cash).toFixed(2) : '—'}</p>
                                                                                    <p className="text-gray-500 font-semibold">Expected: {Number(d.expected_cash || 0).toFixed(2)}</p>
                                                                                    <p className={`font-bold ${(d.difference || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                                                                        Variance: {(d.difference || 0) >= 0 ? '+' : ''}{Number(d.difference || 0).toFixed(2)}
                                                                                    </p>
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    }}
                                                                />
                                                                <Bar dataKey="actual_cash" fill="#10B981" radius={0} />
                                                                <Bar dataKey="expected_cash" fill="#94A3B8" radius={0} />
                                                            </BarChart>
                                                        </ResponsiveContainer>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Chart 2: Cash Movement Breakdown (5 Cols) */}
                                            <div className="lg:col-span-5 p-4 sm:p-5 rounded-none bg-white border border-gray-200/80 shadow-xs space-y-3 flex flex-col justify-between">
                                                <div>
                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 tracking-tight">
                                                        Drawer Cash Velocity Flow
                                                    </h4>
                                                    <p className="text-xs text-gray-500 font-medium mt-0.5">Cash sales vs drawer additions & safe drops</p>
                                                </div>

                                                <div className="space-y-2.5 py-2">
                                                    <div className="p-3 bg-emerald-50/70 rounded-none flex items-center justify-between">
                                                        <div>
                                                            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Total Shift Cash Sales</span>
                                                            <p className="text-base font-bold text-emerald-950">
                                                                {((reportData.shift_report.cash_movements?.total_cash_sales || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <span className="px-2.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-none text-xs font-bold">Sales</span>
                                                    </div>

                                                    <div className="p-3 bg-blue-50/70 rounded-none flex items-center justify-between">
                                                        <div>
                                                            <span className="text-xs font-bold uppercase tracking-wider text-blue-800">Drawer Cash-In (Adds)</span>
                                                            <p className="text-base font-bold text-blue-950">
                                                                {((reportData.shift_report.cash_movements?.total_cash_in || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <span className="px-2.5 py-0.5 bg-blue-100 text-blue-800 rounded-none text-xs font-bold">Topup</span>
                                                    </div>

                                                    <div className="p-3 bg-rose-50/70 rounded-none flex items-center justify-between">
                                                        <div>
                                                            <span className="text-xs font-bold uppercase tracking-wider text-rose-800">Drawer Cash-Out (Drops / Payouts)</span>
                                                            <p className="text-base font-bold text-rose-950">
                                                                {((reportData.shift_report.cash_movements?.total_cash_out || 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                                            </p>
                                                        </div>
                                                        <span className="px-2.5 py-0.5 bg-rose-100 text-rose-800 rounded-none text-xs font-bold">Drops</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ----------------------------------------------------------------- */}
                                    {/* TAB 5: STAFF ACCOUNTABILITY VISUALIZATIONS                         */}
                                    {/* ----------------------------------------------------------------- */}
                                </div>
                            )}

                            {/* ========================================================================= */}
                            {/* 5. DATA TABLES & CARD VIEWS                                               */}
                            {/* ========================================================================= */}
                            {loading ? (
                                <div className="py-20 flex flex-col items-center justify-center space-y-3">
                                    <div className="w-9 h-9 border-4 border-[#1B3A69] border-t-transparent rounded-full animate-spin"></div>
                                    <p className="text-xs font-bold text-gray-500">Compiling multi-domain report data...</p>
                                </div>
                            ) : paginatedData.length === 0 ? (
                                <div className="m-3.5 sm:m-4 py-16 text-center space-y-2 border border-dashed border-gray-200 rounded-none bg-gray-50/30">
                                    <div className="w-10 h-10 bg-gray-100 rounded-none flex items-center justify-center text-gray-400 mx-auto mb-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                    </div>
                                    <p className="text-sm font-bold text-gray-900">No records found for this period</p>
                                    <p className="text-xs text-gray-400 mt-0.5">Try adjusting your date range, categories, or filters above.</p>
                                </div>
                            ) : (
                                <>
                                    {/* 1. TABLE VIEW (Desktop Only when viewMode === 'table') */}
                                    {viewMode === 'table' && (
                                        <div className="hidden lg:block bg-white overflow-hidden">
                                            <div className="overflow-x-auto custom-scrollbar">
                                                <table className="w-full text-left min-w-[1050px]">
                                                    <thead className="bg-gray-50/80 border-b border-gray-200/80 text-gray-500 uppercase text-[10px] font-black tracking-wider whitespace-nowrap">
                                                        {activeTab === 'sales' && (
                                                            <tr>
                                                                <th className="p-3.5 sm:p-4 cursor-pointer min-w-[130px]" onClick={() => handleSort('date')}>Date</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('orders_count')}>Orders</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('gross_sales')}>Gross Sales</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('discounts')}>Discounts</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('net_sales')}>Net Sales</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('aov')}>Avg Basket</th>
                                                                <th className="p-3.5 sm:p-4 text-right min-w-[170px]">Cash / Digital</th>
                                                                <th className="p-3.5 sm:p-4 text-center min-w-[90px]">Voids</th>
                                                            </tr>
                                                        )}

                                                        {activeTab === 'products' && (
                                                            <tr>
                                                                <th className="p-3.5 sm:p-4 cursor-pointer min-w-[220px]" onClick={() => handleSort('name')}>Product / SKU</th>
                                                                <th className="p-3.5 sm:p-4 min-w-[140px]">Category</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('units_sold')}>Units Sold</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('total_revenue')}>Total Revenue</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('total_profit')}>Gross Profit</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('margin_percent')}>Margin</th>
                                                                <th className="p-3.5 sm:p-4 text-center min-w-[110px]">Velocity</th>
                                                            </tr>
                                                        )}

                                                        {activeTab === 'inventory' && (
                                                            <tr>
                                                                <th className="p-3.5 sm:p-4 cursor-pointer min-w-[220px]" onClick={() => handleSort('name')}>Item Details / SKU</th>
                                                                <th className="p-3.5 sm:p-4 min-w-[140px]">Category</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('stock_quantity')}>In Stock</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('total_cost_value')}>Cost Value</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('total_retail_value')}>Retail Value</th>
                                                                <th className="p-3.5 sm:p-4 text-right cursor-pointer" onClick={() => handleSort('potential_profit')}>Unrealized Profit</th>
                                                                <th className="p-3.5 sm:p-4 text-center min-w-[120px]">Health Status</th>
                                                            </tr>
                                                        )}

                                                        {activeTab === 'shifts' && (
                                                            <tr>
                                                                <th className="p-3.5 sm:p-4 min-w-[140px]">Shift ID / Date</th>
                                                                <th className="p-3.5 sm:p-4 min-w-[150px]">Cashier</th>
                                                                <th className="p-3.5 sm:p-4 min-w-[160px]">Opening Time / End</th>
                                                                <th className="p-3.5 sm:p-4 text-right">Starting Cash</th>
                                                                <th className="p-3.5 sm:p-4 text-right">Cash Sales</th>
                                                                <th className="p-3.5 sm:p-4 text-right">Expected Drawer</th>
                                                                <th className="p-3.5 sm:p-4 text-right">Actual Counted</th>
                                                                <th className="p-3.5 sm:p-4 text-center min-w-[140px]">Variance (O/S)</th>
                                                            </tr>
                                                        )}

                                                    </thead>
                                                    <tbody className="divide-y divide-gray-100 whitespace-nowrap">
                                                        {paginatedData.map((item, idx) => (
                                                            <tr 
                                                                key={idx} 
                                                                onClick={() => {
                                                                    if (activeTab === 'sales') handleRowClick(item, 'date');
                                                                    else if (activeTab === 'products') handleRowClick(item, 'product');
                                                                    else if (activeTab === 'inventory') handleRowClick(item, 'inventory');
                                                                    else if (activeTab === 'shifts') handleRowClick(item, 'shift');
                                                                }}
                                                                className="hover:bg-gray-50/80 transition-colors cursor-pointer"
                                                            >
                                                                {/* Sales Row */}
                                                                {activeTab === 'sales' && (
                                                                    <>
                                                                        <td className="p-3.5 sm:p-4 font-bold text-gray-900 text-xs sm:text-sm">{item.date}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-gray-700">{formatNumber(item.orders_count)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-semibold text-xs sm:text-sm text-gray-800">{formatCurrency(item.gross_sales)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right text-xs sm:text-sm font-semibold text-amber-700">{formatCurrency(item.discounts)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-[#1B3A69]">{formatCurrency(item.net_sales)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right text-xs sm:text-sm font-medium text-gray-600">{formatCurrency(item.aov)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right text-xs">
                                                                            <span className="text-emerald-700 font-bold">{formatCurrency(item.cash_sales)}</span>
                                                                            <span className="text-gray-400 font-bold mx-1">/</span>
                                                                            <span className="text-indigo-700 font-bold">{formatCurrency(item.digital_sales)}</span>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 text-center">
                                                                            <span className={`px-2.5 py-0.5 rounded-none text-xs font-bold ${(item.void_count || item.voids_count || 0) > 0 ? 'bg-rose-50 text-rose-700' : 'bg-gray-50 text-gray-500'}`}>
                                                                                {item.void_count ?? item.voids_count ?? 0}
                                                                            </span>
                                                                        </td>
                                                                    </>
                                                                )}

                                                                {/* Products Row */}
                                                                {activeTab === 'products' && (
                                                                    <>
                                                                        <td className="p-3.5 sm:p-4">
                                                                            <div className="font-bold text-xs sm:text-sm text-gray-900">{item.name}</div>
                                                                            <div className="text-xs text-gray-400 font-mono">{item.sku || 'SKU-NONE'}</div>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4">
                                                                            <span className="px-2.5 py-0.5 rounded-none text-xs font-bold bg-blue-50 text-blue-700">
                                                                                {item.category_name}
                                                                            </span>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-gray-900">{formatRowQty(item, item.units_sold)}{rowUnit(item) && <span className="block text-[10px] font-semibold text-gray-500">{rowUnit(item)}</span>}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-[#1B3A69]">{formatCurrency(item.total_revenue)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-emerald-700">{formatCurrency(item.total_profit)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-gray-700">{item.margin_percent}%</td>
                                                                        <td className="p-3.5 sm:p-4 text-center">
                                                                            <span className={`px-2.5 py-0.5 rounded-none text-xs font-bold ${
                                                                                item.units_sold > 50 ? 'bg-emerald-50 text-emerald-700' :
                                                                                item.units_sold > 15 ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'
                                                                            }`}>
                                                                                {item.units_sold > 50 ? 'Fast Mover' : item.units_sold > 15 ? 'Moderate' : 'Slow'}
                                                                            </span>
                                                                        </td>
                                                                    </>
                                                                )}

                                                                {/* Inventory Row */}
                                                                {activeTab === 'inventory' && (
                                                                    <>
                                                                        <td className="p-3.5 sm:p-4">
                                                                            <div className="font-bold text-xs sm:text-sm text-gray-900">{item.name}</div>
                                                                            <div className="text-xs text-gray-400 font-mono">{item.sku || 'SKU-NONE'}</div>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4">
                                                                            <span className="px-2.5 py-0.5 rounded-none text-xs font-bold bg-purple-50 text-purple-700">
                                                                                {item.category_name}
                                                                            </span>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-gray-900">{formatRowQty(item, item.stock_quantity)}{rowUnit(item) && <span className="block text-[10px] font-semibold text-gray-500">{rowUnit(item)}</span>}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right text-xs sm:text-sm text-gray-600">{formatCurrency(item.total_cost_value)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-[#1B3A69]">{formatCurrency(item.total_retail_value)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-emerald-700">{formatCurrency(item.potential_profit)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-center">
                                                                            <span className={`px-2.5 py-0.5 rounded-none text-xs font-bold ${
                                                                                item.status === 'out_of_stock' ? 'bg-rose-50 text-rose-700' :
                                                                                item.status === 'low_stock' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                                                                            }`}>
                                                                                {item.status === 'out_of_stock' ? 'Out of Stock' : item.status === 'low_stock' ? 'Low Stock' : 'Optimal'}
                                                                            </span>
                                                                        </td>
                                                                    </>
                                                                )}

                                                                {/* Shifts Row */}
                                                                {activeTab === 'shifts' && (
                                                                    <>
                                                                        <td className="p-3.5 sm:p-4 font-bold text-xs sm:text-sm text-gray-900">
                                                                            Shift #{item.id}
                                                                            <div className="text-xs text-gray-400 font-normal">
                                                                                {item.start_time ? new Date(item.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (item.opened_at || '—')}
                                                                            </div>
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 font-bold text-xs sm:text-sm text-gray-800">{item.cashier_name}</td>
                                                                        <td className="p-3.5 sm:p-4 text-xs text-gray-500">
                                                                            {item.end_time ? new Date(item.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (item.closed_at || 'Currently Active')}
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 text-right text-xs sm:text-sm text-gray-600">{Number(item.starting_cash || item.opening_float || 0).toFixed(2)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-[#1B3A69]">{Number(item.cash_sales || 0).toFixed(2)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-semibold text-xs sm:text-sm text-gray-800">{Number(item.expected_cash || item.expected_drawer || 0).toFixed(2)}</td>
                                                                        <td className="p-3.5 sm:p-4 text-right font-bold text-xs sm:text-sm text-emerald-700">
                                                                            {item.actual_cash !== null && item.actual_cash !== undefined ? `${Number(item.actual_cash).toFixed(2)}` : (item.actual_counted !== null && item.actual_counted !== undefined ? `${Number(item.actual_counted).toFixed(2)}` : 'N/A')}
                                                                        </td>
                                                                        <td className="p-3.5 sm:p-4 text-center">
                                                                            {Number(item.difference || 0) > 0.01 ? (
                                                                                <span className="text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-none text-xs font-bold">
                                                                                    +{Number(item.difference).toFixed(2)} (Over)
                                                                                </span>
                                                                            ) : Number(item.difference || 0) < -0.01 ? (
                                                                                <span className="text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-none text-xs font-bold">
                                                                                    -{Math.abs(Number(item.difference)).toFixed(2)} (Short)
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-gray-400 font-semibold">Exact 0.00</span>
                                                                            )}
                                                                        </td>
                                                                    </>
                                                                )}

                                                                {/* Staff Row */}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {/* 2. CARD GRID VIEW (Shown on Mobile always, or on Desktop when viewMode === 'grid') */}
                                    <div className={`${viewMode === 'table' ? 'lg:hidden' : 'block'} p-3.5 sm:p-4 bg-gray-50/40 border-t lg:border-t-0 border-gray-100`}>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                                            {paginatedData.map((item, idx) => (
                                                <div key={idx} className="bg-white rounded-none border border-gray-200/80 shadow-2xs p-3.5 sm:p-4 flex flex-col justify-between gap-3 hover:shadow-md hover:border-[#1B3A69]/40 transition-all">
                                                    
                                                    {/* ========================================================= */}
                                                    {/* TAB 1: SALES & DAILY REVENUE AUDIT CARD                   */}
                                                    {/* ========================================================= */}
                                                    {activeTab === 'sales' && (
                                                        <>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-wider">AUDIT DATE</div>
                                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 leading-tight tracking-tight">
                                                                        {item.date}
                                                                    </h4>
                                                                </div>
                                                                <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-[#EFF4F9] text-[#1B3A69] border border-[#CBD7E6] shrink-0 leading-normal inline-flex items-center justify-center">
                                                                    {formatNumber(item.orders_count)} Orders
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-gray-100 text-xs">
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">GROSS SALES</span>
                                                                    <span className="font-semibold text-gray-800 text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.gross_sales)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">NET REVENUE</span>
                                                                    <span className="font-bold text-[#1B3A69] text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.net_sales)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">DISCOUNTS</span>
                                                                    <span className="font-semibold text-amber-700 text-xs font-mono">
                                                                        {formatCurrency(item.discounts)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">AVG TICKET</span>
                                                                    <span className="font-medium text-gray-600 text-xs font-mono">
                                                                        {formatCurrency(item.aov)}
                                                                    </span>
                                                                </div>
                                                            </div>

                                                            <div className="pt-2.5 border-t border-gray-100 flex items-center justify-between gap-2 text-xs">
                                                                <div className="text-[11px] font-semibold text-gray-600 font-mono">
                                                                    <span className="text-emerald-700 font-bold">{formatCurrency(item.cash_sales)}</span>
                                                                    <span className="text-gray-300 mx-1">/</span>
                                                                    <span className="text-indigo-700 font-bold">{formatCurrency(item.digital_sales)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    {(item.void_count || item.voids_count || 0) > 0 && (
                                                                        <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 shrink-0 leading-normal inline-flex items-center justify-center">
                                                                            {item.void_count ?? item.voids_count} void
                                                                        </span>
                                                                    )}
                                                                    <Link
                                                                        href={`/transactions?startDate=${item.date}&endDate=${item.date}`}
                                                                        className="px-2.5 py-1 bg-gray-100 hover:bg-[#1B3A69] hover:text-white rounded-none text-[11px] font-bold text-gray-700 transition-all cursor-pointer inline-flex items-center gap-1"
                                                                    >
                                                                        Audit →
                                                                    </Link>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* ========================================================= */}
                                                    {/* TAB 2: PRODUCT SALES & MARGIN VELOCITY CARD               */}
                                                    {/* ========================================================= */}
                                                    {activeTab === 'products' && (
                                                        <>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 shrink-0 leading-normal inline-flex items-center justify-center">
                                                                        {item.category_name}
                                                                    </span>
                                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 leading-tight tracking-tight mt-1 truncate" title={item.name}>
                                                                        {item.name}
                                                                    </h4>
                                                                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{item.sku || 'SKU-NONE'}</p>
                                                                </div>
                                                                <span className={`px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider shrink-0 leading-normal inline-flex items-center justify-center ${
                                                                    item.units_sold > 50 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                                                    item.units_sold > 15 ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-gray-100 text-gray-600 border border-gray-200'
                                                                }`}>
                                                                    {item.units_sold > 50 ? 'Fast Mover' : item.units_sold > 15 ? 'Moderate' : 'Slow'}
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-gray-100 text-xs">
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">UNITS SOLD</span>
                                                                    <span className="font-bold text-gray-900 text-xs sm:text-sm font-mono">
                                                                        {formatRowQty(item, item.units_sold)} {rowUnit(item) || 'pcs'}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">TOTAL REVENUE</span>
                                                                    <span className="font-bold text-[#1B3A69] text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.total_revenue)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">GROSS PROFIT</span>
                                                                    <span className="font-bold text-emerald-700 text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.total_profit)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">PROFIT MARGIN</span>
                                                                    <span className="font-bold text-gray-700 text-xs sm:text-sm font-mono">
                                                                        {item.margin_percent}%
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* ========================================================= */}
                                                    {/* TAB 3: REAL-TIME STOCK VALUATION CARD                     */}
                                                    {/* ========================================================= */}
                                                    {activeTab === 'inventory' && (
                                                        <>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200 shrink-0 leading-normal inline-flex items-center justify-center">
                                                                        {item.category_name}
                                                                    </span>
                                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 leading-tight tracking-tight mt-1 truncate" title={item.name}>
                                                                        {item.name}
                                                                    </h4>
                                                                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{item.sku || 'SKU-NONE'}</p>
                                                                </div>
                                                                <span className={`px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider shrink-0 leading-normal inline-flex items-center justify-center ${
                                                                    item.status === 'out_of_stock' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                                                                    item.status === 'low_stock' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                }`}>
                                                                    {item.status === 'out_of_stock' ? 'Out of Stock' : item.status === 'low_stock' ? 'Low Stock' : 'Optimal'}
                                                                </span>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-gray-100 text-xs">
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">CURRENT STOCK</span>
                                                                    <span className="font-bold text-gray-900 text-xs sm:text-sm font-mono">
                                                                        {formatRowQty(item, item.stock_quantity)}{rowUnit(item) ? ` ${rowUnit(item)}` : ''} in stock
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">COST VALUE</span>
                                                                    <span className="font-semibold text-gray-600 text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.total_cost_value)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">RETAIL VALUE</span>
                                                                    <span className="font-bold text-[#1B3A69] text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.total_retail_value)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block">POTENTIAL PROFIT</span>
                                                                    <span className="font-bold text-emerald-700 text-xs sm:text-sm font-mono">
                                                                        {formatCurrency(item.potential_profit)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* ========================================================= */}
                                                    {/* TAB 4: CASHIER SHIFT RECONCILIATION CARD                  */}
                                                    {/* ========================================================= */}
                                                    {activeTab === 'shifts' && (
                                                        <>
                                                            <div className="flex items-start justify-between gap-2">
                                                                <div className="min-w-0">
                                                                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                                                                        SHIFT #{item.id}
                                                                    </span>
                                                                    <h4 className="font-bold text-sm sm:text-base text-gray-900 leading-tight tracking-tight">
                                                                        {item.cashier_name}
                                                                    </h4>
                                                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                                                        {item.start_time ? new Date(item.start_time).toLocaleString() : (item.opened_at || '—')}
                                                                    </p>
                                                                </div>
                                                                <div className="shrink-0 text-right">
                                                                    {Number(item.difference || 0) > 0.01 ? (
                                                                        <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 leading-normal inline-flex items-center justify-center">
                                                                            +{Number(item.difference).toFixed(2)} (Over)
                                                                        </span>
                                                                    ) : Number(item.difference || 0) < -0.01 ? (
                                                                        <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 leading-normal inline-flex items-center justify-center">
                                                                            -{Math.abs(Number(item.difference)).toFixed(2)} (Short)
                                                                        </span>
                                                                    ) : (
                                                                        <span className="px-1.5 py-0.5 rounded-none text-[9px] font-bold uppercase tracking-wider bg-gray-100 text-gray-500 border border-gray-200 leading-normal inline-flex items-center justify-center">
                                                                            Exact 0.00
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            <div className="grid grid-cols-2 gap-2 pt-2.5 border-t border-gray-100 text-xs font-mono">
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block font-sans">STARTING CASH</span>
                                                                    <span className="font-semibold text-gray-600 text-xs">
                                                                        {Number(item.starting_cash || item.opening_float || 0).toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block font-sans">CASH SALES</span>
                                                                    <span className="font-bold text-[#1B3A69] text-xs sm:text-sm">
                                                                        {Number(item.cash_sales || 0).toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block font-sans">EXPECTED CASH</span>
                                                                    <span className="font-semibold text-gray-800 text-xs">
                                                                        {Number(item.expected_cash || item.expected_drawer || 0).toFixed(2)}
                                                                    </span>
                                                                </div>
                                                                <div>
                                                                    <span className="text-gray-400 text-[10px] font-black uppercase tracking-wider block font-sans">ACTUAL COUNTED</span>
                                                                    <span className="font-bold text-emerald-700 text-xs sm:text-sm">
                                                                        {item.actual_cash !== null && item.actual_cash !== undefined ? `${Number(item.actual_cash).toFixed(2)}` : (item.actual_counted !== null && item.actual_counted !== undefined ? `${Number(item.actual_counted).toFixed(2)}` : 'N/A')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}

                                                    {/* ========================================================= */}
                                                    {/* TAB 5: CASHIER ACCOUNTABILITY & PERFORMANCE CARD          */}
                                                    {/* ========================================================= */}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* SMOOTH HORIZONTAL PAGINATION WITH SMART PAGE DISPLAY (SEPARATED BELOW MAIN CARD) */}
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

                            const scrollToWorkspace = () => {
                                if (workspaceSectionRef.current) {
                                    workspaceSectionRef.current.scrollIntoView({ behavior: 'smooth' });
                                } else {
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }
                            };

                            return (
                                <div className="py-4 flex flex-col sm:flex-row justify-between items-center gap-4 pb-10 sm:pb-4 w-full overflow-visible">
                                    <span className="text-xs text-gray-500 font-bold uppercase tracking-wider shrink-0">
                                        Page <span className="text-gray-900 font-black">{currentPage}</span> of {totalPages}
                                    </span>

                                    <div className="w-full sm:w-auto overflow-x-auto no-scrollbar pb-2 sm:pb-0">
                                        <div className="flex gap-1.5 flex-nowrap w-max mx-auto sm:mx-0 px-1">
                                            <button
                                                disabled={currentPage === 1}
                                                onClick={() => {
                                                    setCurrentPage(p => Math.max(p - 1, 1));
                                                    scrollToWorkspace();
                                                }}
                                                className="px-3.5 py-2 min-h-9 rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex items-center shadow-2xs cursor-pointer"
                                            >
                                                &laquo; Prev
                                            </button>

                                            {getPageNumbers().map((num, idx) => (
                                                num === '...' ? (
                                                    <span key={`ellipsis-${idx}`} className="px-2 py-2 min-h-9 text-gray-400 font-bold flex items-center">...</span>
                                                ) : (
                                                    <button
                                                        key={num}
                                                        onClick={() => {
                                                            setCurrentPage(num);
                                                            scrollToWorkspace();
                                                        }}
                                                        className={`shrink-0 px-3.5 py-2 min-h-9 rounded-none text-xs font-bold border transition-all flex items-center justify-center shadow-2xs font-mono cursor-pointer
                                                            ${currentPage === num ? 'bg-[#1B3A69] text-white border-[#1B3A69] shadow-sm font-extrabold' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                                                    >
                                                        {num}
                                                    </button>
                                                )
                                            ))}

                                            <button
                                                disabled={currentPage === totalPages}
                                                onClick={() => {
                                                    setCurrentPage(p => Math.min(p + 1, totalPages));
                                                    scrollToWorkspace();
                                                }}
                                                className="px-3.5 py-2 min-h-9 rounded-none text-xs font-bold border transition-all bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap flex items-center shadow-2xs cursor-pointer"
                                            >
                                                Next &raquo;
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>

                    {/* ========================================================================= */}
                    {/* 6. DRILL-DOWN SLIDE-OVER DRAWER                                           */}
                    {/* ========================================================================= */}
                    {showDrawer && drawerItem && (
                        <div className="fixed inset-0 z-50 overflow-hidden">
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={() => setShowDrawer(false)}></div>
                            <div className="fixed inset-y-0 right-0 max-w-full flex pl-0 sm:pl-10">
                                <div className="w-screen max-w-md bg-white shadow-2xl p-4 sm:p-6 flex flex-col justify-between overflow-y-auto">
                                    <div className="space-y-4">
                                        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                                            <div>
                                                <h3 className="font-bold text-base sm:text-lg text-gray-900">Drill-Down Audit</h3>
                                                <p className="text-xs text-gray-500 font-medium mt-0.5">Detailed breakdown for selected record</p>
                                            </div>
                                            <button
                                                onClick={() => setShowDrawer(false)}
                                                className="p-1 rounded-none text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-pointer"
                                            >
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        </div>

                                        <div className="space-y-3 text-xs sm:text-sm">
                                            <div className="p-3.5 bg-gray-50 rounded-none space-y-2 border border-gray-100">
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500 font-medium">Record ID / Date:</span>
                                                    <span className="font-bold text-gray-900">{drawerItem.date || drawerItem.name || `#${drawerItem.id}`}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-gray-500 font-medium">Gross Volume / Sales:</span>
                                                    <span className="font-bold text-[#1B3A69] font-mono">
                                                        {formatCurrency(drawerItem.gross_sales || drawerItem.total_revenue || drawerItem.total_sales || (drawerItem.cash_sales * 100))}
                                                    </span>
                                                </div>
                                                {drawerItem.discounts !== undefined && (
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500 font-medium">Discounts Given:</span>
                                                        <span className="font-semibold text-amber-700 font-mono">{formatCurrency(drawerItem.discounts)}</span>
                                                    </div>
                                                )}
                                                {drawerItem.aov !== undefined && (
                                                    <div className="flex justify-between">
                                                        <span className="text-gray-500 font-medium">Average Order Value:</span>
                                                        <span className="font-semibold text-gray-700 font-mono">{formatCurrency(drawerItem.aov)}</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="p-3.5 bg-blue-50/50 rounded-none border border-blue-100 space-y-1">
                                                <span className="text-xs font-bold uppercase tracking-wider text-blue-700">Audit Compliance Note</span>
                                                <p className="text-xs text-blue-900 leading-relaxed">
                                                    All transactions, shifts, and inventory adjustments logged under this entry are synchronized with store audit records and system timestamps.
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="pt-4 border-t border-gray-100 flex gap-2">
                                        <button
                                            onClick={() => setShowDrawer(false)}
                                            className="w-full py-2.5 rounded-none bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs sm:text-sm shadow-xs active:scale-95 transition-all cursor-pointer"
                                        >
                                            Close Audit View
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </AuthenticatedLayout>
    );
}