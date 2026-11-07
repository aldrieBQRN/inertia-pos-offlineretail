import React, { useState, useEffect, useMemo, useRef } from 'react';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, router } from '@inertiajs/react';
import axios from 'axios';
import Swal from 'sweetalert2';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import usePrinterStore from '@/Stores/usePrinterStore';
import CashMovementModal from '@/Components/CashMovementModal';
import CashMovementHistoryModal from '@/Components/CashMovementHistoryModal';

export default function ShiftHistory({ auth, initial_shifts, initial_terminals, initial_settings, initial_active_shifts, initial_shift_details, initial_cash_movements }) {
    // 1. Data States
    const [allShifts, setAllShifts] = useState(() => initial_shifts || []);
    const [loading, setLoading] = useState(() => !Array.isArray(initial_shifts));
    const [settings, setSettings] = useState(() => initial_settings || null);
    const [activeShifts, setActiveShifts] = useState(() => initial_active_shifts || []);
    const [isExporting, setIsExporting] = useState(false);
    const [showDataMenu, setShowDataMenu] = useState(false);

    // Modal States & Instant Details Cache
    const shiftDetailsCacheRef = useRef(initial_shift_details || {});
    const [showDetails, setShowDetails] = useState(false);
    const [selectedShiftData, setSelectedShiftData] = useState(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const cashMovements = initial_cash_movements || [];
    const [modalTab, setModalTab] = useState('summary'); // 'summary' | 'movements'
    const [showCashMovementModal, setShowCashMovementModal] = useState(false);
    const [showCashMovementHistoryModal, setShowCashMovementHistoryModal] = useState(false);
    const [terminals, setTerminals] = useState(() => initial_terminals || []);

    // View Mode & Responsive Pagination
    const [viewMode, setViewMode] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('pos_shifts_view_mode') || 'table' : 'table'));
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        if (typeof window !== 'undefined') {
            const savedMode = localStorage.getItem('pos_shifts_view_mode');
            if (savedMode === 'grid') {
                return window.innerWidth >= 1280 ? 9 : 10;
            }
        }
        return 10;
    });

    // Filtering & Tab States
    const [statusTab, setStatusTab] = useState('all'); // 'all' | 'balanced' | 'shortage' | 'overage' | 'open'
    const [datePreset, setDatePreset] = useState('all'); // 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Helper for resolving full avatar URLs
    const getAvatarUrl = (path) => {
        if (!path) return null;
        if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/storage/')) {
            return path;
        }
        return `/storage/${path}`;
    };

    // Refs for Smooth Workspace Clearance
    const workspaceSectionRef = useRef(null);
    const pipelineTabsRef = useRef(null);

    // Global Printer Store Access
    const { printZRead } = usePrinterStore();

    // Helper: Clean currency formatting without currency symbols
    const formatCurrency = (val) => {
        return (parseFloat(val) || 0).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    };

    const formatDate = (dateString) => {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatTime = (dateString) => {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return '—';
        return new Date(dateString).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const calculateDuration = (startStr, endStr) => {
        if (!startStr) return '—';
        const start = new Date(startStr);
        const end = endStr ? new Date(endStr) : new Date();
        const diffMs = end - start;
        if (diffMs <= 0) return '0m';
        const totalMinutes = Math.floor(diffMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours === 0) return `${minutes}m`;
        return `${hours}h ${minutes}m`;
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

    // Handle Resize & Dynamic Balanced Page Size
    useEffect(() => {
        const handleResize = () => {
            if (viewMode === 'grid') {
                const balancedCount = window.innerWidth >= 1280 ? 9 : 10;
                setItemsPerPage((prev) => (prev !== balancedCount ? balancedCount : prev));
            } else {
                setItemsPerPage((prev) => (prev !== 10 ? 10 : prev));
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewMode]);

    // View Mode Switcher
    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        try {
            localStorage.setItem('pos_shifts_view_mode', mode);
        } catch (e) {}

        if (mode === 'grid') {
            const balancedCount = window.innerWidth >= 1280 ? 9 : 10;
            setItemsPerPage(balancedCount);
        } else {
            setItemsPerPage(10);
        }
        setCurrentPage(1);
    };

    // Tab Change Handler
    const handleStatusTabChange = (tabKey) => {
        setStatusTab(tabKey);
        setCurrentPage(1);
        scrollToWorkspace(tabKey);
    };

    // Smooth Workspace Scrolling with Sticky Header Clearance
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

    // Sync preloaded server-side props on navigation
    useEffect(() => {
        if (Array.isArray(initial_shifts)) {
            setAllShifts(initial_shifts);
            setLoading(false);
        }
    }, [initial_shifts]);

    useEffect(() => {
        if (Array.isArray(initial_terminals)) setTerminals(initial_terminals);
        if (initial_settings) setSettings(initial_settings);
        if (Array.isArray(initial_active_shifts)) setActiveShifts(initial_active_shifts);
        if (initial_shift_details) shiftDetailsCacheRef.current = initial_shift_details;
    }, [initial_terminals, initial_settings, initial_active_shifts, initial_shift_details]);

    // Initial Load & Background Polling Setup
    useEffect(() => {
        const hasInitialData = Array.isArray(initial_shifts);
        if (!hasInitialData) {
            fetchSettings();
            loadAllShifts(true);
        } else if (!initial_settings || !initial_terminals) {
            fetchSettings();
        }

        const interval = setInterval(() => {
            loadAllShifts(false);
        }, 6000);

        return () => clearInterval(interval);
    }, []);

    // Reset pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [startDate, endDate, searchQuery, statusTab]);

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
            const [setRes, termRes] = await Promise.all([
                axios.get('/api/settings'),
                axios.get('/api/terminals')
            ]);
            setSettings(setRes.data);
            setTerminals(termRes.data || []);
        } catch (e) {}
    };

    const loadAllShifts = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const response = await axios.get('/api/shifts', { params: { all: true } });
            const data = Array.isArray(response.data) ? response.data : (response.data.data || []);
            setAllShifts(data);
        } catch (error) {
            console.error("Critical error loading shifts:", error);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    // Quick Date Preset Handler
    const handleDatePreset = (preset) => {
        setDatePreset(preset);
        const now = new Date();
        const formatDateStr = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        if (preset === 'today') {
            const todayStr = formatDateStr(now);
            setStartDate(todayStr);
            setEndDate(todayStr);
        } else if (preset === 'yesterday') {
            const yest = new Date(now);
            yest.setDate(yest.getDate() - 1);
            const yestStr = formatDateStr(yest);
            setStartDate(yestStr);
            setEndDate(yestStr);
        } else if (preset === 'week') {
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 6);
            setStartDate(formatDateStr(weekAgo));
            setEndDate(formatDateStr(now));
        } else if (preset === 'month') {
            const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
            setStartDate(formatDateStr(firstDay));
            setEndDate(formatDateStr(now));
        } else if (preset === 'all') {
            setStartDate('');
            setEndDate('');
        }
        scrollToWorkspace();
    };

    // View Details / Z-Read Audit Modal
    const handleViewDetails = async (shift) => {
        const cachedDetails = shiftDetailsCacheRef.current[shift.id];
        
        setShowDetails(true);
        setModalTab('summary');

        if (cachedDetails) {
            setSelectedShiftData(cachedDetails);
            setIsLoadingDetails(false);
        } else {
            setIsLoadingDetails(true);
            setSelectedShiftData(null);
        }

        try {
            const res = await axios.get(`/api/pos/shift/data/${shift.id}`);
            const freshData = { ...res.data, id: shift.id, shift_record: shift };
            shiftDetailsCacheRef.current[shift.id] = freshData;
            setSelectedShiftData(freshData);
        } catch (err) {
            console.error("Failed to load shift details:", err);
            if (!cachedDetails) {
                Swal.fire("Error", "Failed to load shift details.", "error");
                setShowDetails(false);
            }
        } finally {
            setIsLoadingDetails(false);
        }
    };

    // Base Scoped Shifts: Scoped to logged in cashier if non-admin, or store-wide if Admin
    const baseShifts = useMemo(() => {
        if (auth.user?.is_admin) return allShifts;
        return allShifts.filter(shift => {
            const cashierId = shift.user_id || shift.user?.id;
            return String(cashierId) === String(auth.user?.id);
        });
    }, [allShifts, auth.user]);

    // Tab Counts (Computed from base master dataset)
    const tabCounts = useMemo(() => {
        let all = baseShifts.length;
        let balanced = 0;
        let shortage = 0;
        let overage = 0;
        let open = 0;

        baseShifts.forEach(shift => {
            if (shift.status === 'open' || !shift.end_time) {
                open++;
            } else {
                const diff = Number(shift.difference || 0);
                if (Math.abs(diff) < 0.01) {
                    balanced++;
                } else if (diff < -0.01) {
                    shortage++;
                } else {
                    overage++;
                }
            }
        });

        return { all, balanced, shortage, overage, open };
    }, [baseShifts]);

    // Master KPI Metrics (Computed from base master dataset so KPIs stay constant during filtering)
    const kpiMetrics = useMemo(() => {
        let totalCashSales = 0;
        let totalStartingCash = 0;
        let totalExpenses = 0;
        let totalExpectedCash = 0;
        let totalActualCash = 0;
        let totalVariance = 0;
        let totalClosedShifts = 0;
        let totalOpenShifts = 0;
        let shortageCount = 0;
        let overageCount = 0;
        let balancedCount = 0;

        baseShifts.forEach(shift => {
            const start = Number(shift.starting_cash || 0);
            const sales = Number(shift.cash_sales || 0);
            const exp = Number(shift.expenses || 0);
            const expected = Number(shift.expected_cash || 0);
            const actual = Number(shift.actual_cash || 0);
            const diff = Number(shift.difference || 0);

            totalStartingCash += start;
            totalCashSales += sales;
            totalExpenses += exp;
            totalExpectedCash += expected;

            if (shift.status === 'open' || !shift.end_time) {
                totalOpenShifts++;
            } else {
                totalClosedShifts++;
                totalActualCash += actual;
                totalVariance += diff;

                if (Math.abs(diff) < 0.01) {
                    balancedCount++;
                } else if (diff < -0.01) {
                    shortageCount++;
                } else {
                    overageCount++;
                }
            }
        });

        const avgSalesPerShift = totalClosedShifts > 0 ? (totalCashSales / totalClosedShifts) : 0;

        return {
            totalShifts: baseShifts.length,
            totalClosedShifts,
            totalOpenShifts,
            totalStartingCash,
            totalCashSales,
            totalExpenses,
            totalExpectedCash,
            totalActualCash,
            totalVariance,
            shortageCount,
            overageCount,
            balancedCount,
            avgSalesPerShift
        };
    }, [baseShifts]);

    // Scoped Shifts (Date Range, Cashier, and Search Filtered)
    const scopedShifts = useMemo(() => {
        return baseShifts.filter(shift => {
            // Search Query (Cashier name, Shift ID, User email)
            if (searchQuery) {
                const searchLower = searchQuery.toLowerCase().trim();
                const cashierName = (shift.user?.name || '').toLowerCase();
                const cashierEmail = (shift.user?.email || '').toLowerCase();
                const shiftId = String(shift.id || '');
                const matches = cashierName.includes(searchLower) || cashierEmail.includes(searchLower) || shiftId.includes(searchLower);
                if (!matches) return false;
            }



            // Date Range Filter
            if (startDate || endDate) {
                const shiftDateStr = shift.start_time ? shift.start_time.split('T')[0] : '';
                if (startDate && shiftDateStr < startDate) return false;
                if (endDate && shiftDateStr > endDate) return false;
            }

            return true;
        });
    }, [baseShifts, searchQuery, startDate, endDate, auth.user]);

    // Status Tab Filtered Shifts
    const filteredShifts = useMemo(() => {
        return scopedShifts.filter(shift => {
            const isOpen = shift.status === 'open' || !shift.end_time;
            const diff = Number(shift.difference || 0);

            if (statusTab === 'balanced') {
                if (isOpen || Math.abs(diff) >= 0.01) return false;
            } else if (statusTab === 'shortage') {
                if (isOpen || diff > -0.01) return false;
            } else if (statusTab === 'overage') {
                if (isOpen || diff < 0.01) return false;
            } else if (statusTab === 'open') {
                if (!isOpen) return false;
            }
            return true;
        });
    }, [scopedShifts, statusTab]);

    // Client-side pagination
    const totalPages = Math.ceil(filteredShifts.length / itemsPerPage) || 1;
    const paginatedShifts = filteredShifts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // ==========================================
    // EXCEL EXPORT (.xlsx)
    // ==========================================
    const exportExcel = async () => {
        setIsExporting(true);
        try {
            const exportData = filteredShifts;
            if (!exportData || exportData.length === 0) {
                Swal.fire('No Data', 'No shift records found to export.', 'info');
                setIsExporting(false);
                return;
            }

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'POS System';
            workbook.created = new Date();

            const worksheet = workbook.addWorksheet('Shift Accountability');

            // Set Page Properties
            worksheet.pageSetup = {
                orientation: 'landscape',
                fitToPage: true,
                fitToWidth: 1,
                fitToHeight: 0,
                paperSize: 9
            };

            const storeName = (settings?.store_name || 'POS Retail System').toUpperCase();
            const storeAddress = settings?.address || 'Retail Point of Sale System';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : (settings?.email ? `Email: ${settings.email}` : '');

            // Store Title Header Banner (Rows 1-5)
            worksheet.mergeCells('A1:I1');
            worksheet.getCell('A1').value = storeName;
            worksheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 14 };
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 24;

            worksheet.mergeCells('A2:I2');
            worksheet.getCell('A2').value = storeAddress;
            worksheet.getCell('A2').font = { color: { argb: '555555' }, size: 9 };
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 16;

            if (storeContact) {
                worksheet.mergeCells('A3:I3');
                worksheet.getCell('A3').value = storeContact;
                worksheet.getCell('A3').font = { color: { argb: '777777' }, size: 9, italic: true };
                worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
                worksheet.getRow(3).height = 16;
            }

            worksheet.mergeCells('A4:I4');
            worksheet.getCell('A4').value = 'CASHIER SHIFT AUDIT & CASH ACCOUNTABILITY REPORT';
            worksheet.getCell('A4').font = { bold: true, color: { argb: '1B3A69' }, size: 11 };
            worksheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(4).height = 20;

            const dateRangeLabel = startDate || endDate
                ? `Period: ${startDate ? formatDate(startDate) : 'Start'} to ${endDate ? formatDate(endDate) : 'Present'}`
                : 'Period: All Historical Records';
            worksheet.mergeCells('A5:I5');
            worksheet.getCell('A5').value = `${dateRangeLabel}  |  Generated: ${new Date().toLocaleString()}  |  Total Shifts: ${exportData.length}`;
            worksheet.getCell('A5').font = { color: { argb: '777777' }, size: 9 };
            worksheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(5).height = 18;

            worksheet.getRow(6).height = 10; // Spacing

            // Table Column Headers (Row 7)
            const headers = [
                'Cashier / Staff',
                'Shift Period',
                'Duration',
                'Starting Float',
                'Cash Sales',
                'Expenses',
                'Expected in Drawer',
                'Actual Count',
                'Variance (Short/Over)'
            ];

            headers.forEach((h, colIndex) => {
                const cell = worksheet.getRow(7).getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: '1B3A69' }
                };
                cell.alignment = {
                    vertical: 'middle',
                    horizontal: colIndex >= 3 ? 'right' : (colIndex === 2 ? 'center' : 'left'),
                    wrapText: true
                };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'medium', color: { argb: '0F172A' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            worksheet.getRow(7).height = 26;

            // Shift Rows (Row 8+)
            let totalStarting = 0;
            let totalSales = 0;
            let totalExp = 0;
            let totalExpected = 0;
            let totalActual = 0;
            let totalNetVariance = 0;

            exportData.forEach((shift, idx) => {
                const rowNum = idx + 8;
                const row = worksheet.getRow(rowNum);
                const isEven = idx % 2 === 0;

                const start = Number(shift.starting_cash || 0);
                const sales = Number(shift.cash_sales || 0);
                const exp = Number(shift.expenses || 0);
                const expected = Number(shift.expected_cash || 0);
                const actual = Number(shift.actual_cash || 0);
                const diff = Number(shift.difference || 0);

                totalStarting += start;
                totalSales += sales;
                totalExp += exp;
                totalExpected += expected;
                totalActual += actual;
                totalNetVariance += diff;

                const periodStr = `${formatDateTime(shift.start_time)} - ${shift.end_time ? formatDateTime(shift.end_time) : 'OPEN'}`;
                const durationStr = calculateDuration(shift.start_time, shift.end_time);

                row.getCell('A').value = shift.user?.name || 'Staff Member';
                row.getCell('B').value = periodStr;
                row.getCell('C').value = durationStr;
                row.getCell('D').value = start;
                row.getCell('E').value = sales;
                row.getCell('F').value = exp;
                row.getCell('G').value = expected;
                row.getCell('H').value = shift.actual_cash ? actual : 'N/A';
                row.getCell('I').value = diff;

                // Formatting
                row.getCell('A').alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell('B').alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell('C').alignment = { vertical: 'middle', horizontal: 'center' };
                row.getCell('D').alignment = { vertical: 'middle', horizontal: 'right' };
                row.getCell('E').alignment = { vertical: 'middle', horizontal: 'right' };
                row.getCell('F').alignment = { vertical: 'middle', horizontal: 'right' };
                row.getCell('G').alignment = { vertical: 'middle', horizontal: 'right' };
                row.getCell('H').alignment = { vertical: 'middle', horizontal: 'right' };
                row.getCell('I').alignment = { vertical: 'middle', horizontal: 'right' };

                row.getCell('D').numFmt = '#,##0.00';
                row.getCell('E').numFmt = '#,##0.00';
                row.getCell('F').numFmt = '#,##0.00';
                row.getCell('G').numFmt = '#,##0.00';
                if (shift.actual_cash) row.getCell('H').numFmt = '#,##0.00';
                row.getCell('I').numFmt = '+#,##0.00;-#,##0.00;0.00';

                // Variance font color
                if (diff < -0.01) {
                    row.getCell('I').font = { bold: true, color: { argb: 'DC2626' } };
                } else if (diff > 0.01) {
                    row.getCell('I').font = { bold: true, color: { argb: '16A34A' } };
                } else {
                    row.getCell('I').font = { bold: true, color: { argb: '475569' } };
                }

                // Row borders and alternating fills
                for (let c = 1; c <= 9; c++) {
                    const cell = row.getCell(c);
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

            // Column Widths
            worksheet.getColumn('A').width = 22;
            worksheet.getColumn('B').width = 38;
            worksheet.getColumn('C').width = 16;
            worksheet.getColumn('D').width = 18;
            worksheet.getColumn('E').width = 18;
            worksheet.getColumn('F').width = 16;
            worksheet.getColumn('G').width = 20;
            worksheet.getColumn('H').width = 18;
            worksheet.getColumn('I').width = 22;

            // ==============================================================
            // EXECUTIVE FINANCIAL RECONCILIATION SUMMARY FOOTER (EXCEL)
            // ==============================================================
            const startSummaryRow = exportData.length + 9;

            // Section Banner
            worksheet.mergeCells(`A${startSummaryRow}:I${startSummaryRow}`);
            const titleCell = worksheet.getCell(`A${startSummaryRow}`);
            titleCell.value = 'SHIFT FINANCIAL RECONCILIATION & DRAWER BALANCING SUMMARY';
            titleCell.font = { bold: true, color: { argb: '1B3A69' }, size: 10 };
            titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            titleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'F1F5F9' }
            };
            titleCell.border = {
                top: { style: 'medium', color: { argb: '1B3A69' } },
                bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                left: { style: 'thin', color: { argb: 'CBD5E1' } },
                right: { style: 'thin', color: { argb: 'CBD5E1' } }
            };
            worksheet.getRow(startSummaryRow).height = 24;

            // Metric Row 1: Counts and Float
            const r1 = startSummaryRow + 1;
            worksheet.getRow(r1).height = 22;
            worksheet.mergeCells(`A${r1}:B${r1}`);
            worksheet.getCell(`A${r1}`).value = `Total Recorded: ${exportData.length} Shifts`;
            worksheet.getCell(`A${r1}`).font = { bold: true, size: 9, color: { argb: '334155' } };

            worksheet.mergeCells(`C${r1}:D${r1}`);
            worksheet.getCell(`C${r1}`).value = `Starting Float: ${formatCurrency(totalStarting)}`;
            worksheet.getCell(`C${r1}`).font = { bold: true, size: 9, color: { argb: '334155' } };

            worksheet.mergeCells(`E${r1}:F${r1}`);
            worksheet.getCell(`E${r1}`).value = `Cash Sales: ${formatCurrency(totalSales)}`;
            worksheet.getCell(`E${r1}`).font = { bold: true, size: 9, color: { argb: '16A34A' } };

            worksheet.mergeCells(`G${r1}:I${r1}`);
            worksheet.getCell(`G${r1}`).value = `Expenses / Payouts: -${formatCurrency(totalExp)}`;
            worksheet.getCell(`G${r1}`).font = { bold: true, size: 9, color: { argb: 'DC2626' } };

            // Metric Row 2: Drawer Balancing & Net Variance
            const r2 = startSummaryRow + 2;
            worksheet.getRow(r2).height = 24;
            worksheet.mergeCells(`A${r2}:C${r2}`);
            worksheet.getCell(`A${r2}`).value = `Expected in Drawer: ${formatCurrency(totalExpected)}`;
            worksheet.getCell(`A${r2}`).font = { bold: true, size: 10, color: { argb: '1E293B' } };

            worksheet.mergeCells(`D${r2}:F${r2}`);
            worksheet.getCell(`D${r2}`).value = `Actual Count Collected: ${formatCurrency(totalActual)}`;
            worksheet.getCell(`D${r2}`).font = { bold: true, size: 10, color: { argb: '1B3A69' } };

            worksheet.mergeCells(`G${r2}:I${r2}`);
            const varColor = totalNetVariance < -0.01 ? 'DC2626' : (totalNetVariance > 0.01 ? '16A34A' : '0F172A');
            const varPrefix = totalNetVariance > 0.01 ? '+' : '';
            worksheet.getCell(`G${r2}`).value = `Net Cash Variance: ${varPrefix}${formatCurrency(totalNetVariance)}`;
            worksheet.getCell(`G${r2}`).font = { bold: true, size: 11, color: { argb: varColor } };

            // Style summary rows with borders and background
            [r1, r2].forEach(rNum => {
                for (let c = 1; c <= 9; c++) {
                    const cell = worksheet.getRow(rNum).getCell(c);
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F8FAFC' }
                    };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'E2E8F0' } },
                        bottom: { style: rNum === r2 ? 'medium' : 'thin', color: { argb: rNum === r2 ? '1B3A69' : 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'CBD5E1' } },
                        right: { style: 'thin', color: { argb: 'CBD5E1' } }
                    };
                }
            });

            // Generate and download
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            saveAs(blob, `Shift_Audit_Report_${startDate || 'All'}_to_${endDate || 'All'}.xlsx`);

            setShowDataMenu(false);
            Swal.fire({
                icon: 'success',
                title: 'Excel Report Exported!',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        } catch (error) {
            console.error("Excel generation error:", error);
            Swal.fire('Error', 'Failed to generate Excel report.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    // ==========================================
    // PDF EXPORT (.pdf)
    // ==========================================
    const exportPDF = async () => {
        setIsExporting(true);
        try {
            const exportData = filteredShifts;
            if (!exportData || exportData.length === 0) {
                Swal.fire('No Data', 'No shift records found to export.', 'info');
                setIsExporting(false);
                return;
            }

            const doc = new jsPDF('landscape');
            const pageWidth = doc.internal.pageSize.width;

            const storeName = (settings?.store_name || 'POS Retail System').toUpperCase();
            const storeAddress = settings?.address || 'Retail Point of Sale System';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : (settings?.email ? `Email: ${settings.email}` : '');

            let currentY = 18;

            // Branded Store Header
            doc.setFontSize(18);
            doc.setTextColor(27, 58, 105); // #1B3A69
            doc.setFont(undefined, 'bold');
            doc.text(storeName, 14, currentY);

            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.setFont(undefined, 'normal');

            if (storeAddress) {
                currentY += 5;
                doc.text(storeAddress, 14, currentY);
            }
            if (storeContact) {
                currentY += 4.5;
                doc.text(storeContact, 14, currentY);
            }

            currentY += 7;
            doc.setDrawColor(226, 232, 240);
            doc.setLineWidth(0.5);
            doc.line(14, currentY, pageWidth - 14, currentY);

            currentY += 8;
            doc.setFontSize(14);
            doc.setTextColor(15, 23, 42);
            doc.setFont(undefined, 'bold');
            doc.text('Cashier Shift Audit & Accountability Report', 14, currentY);

            currentY += 5.5;
            doc.setFontSize(9);
            doc.setTextColor(100, 116, 139);
            doc.setFont(undefined, 'normal');

            const dateLabel = startDate || endDate
                ? `Period: ${startDate ? formatDate(startDate) : 'Start'} to ${endDate ? formatDate(endDate) : 'Present'}`
                : 'Period: All Historical Records';
            doc.text(`${dateLabel}  |  Total Shifts: ${exportData.length}`, 14, currentY);

            const genText = `Generated: ${new Date().toLocaleString()}`;
            const genWidth = doc.getTextWidth(genText);
            doc.text(genText, pageWidth - 14 - genWidth, currentY);

            const tableStartY = currentY + 6;

            const tableColumns = [
                'Cashier',
                'Shift Period',
                'Duration',
                'Starting Float',
                'Cash Sales',
                'Expenses',
                'Expected',
                'Actual Count',
                'Variance'
            ];

            const tableRows = [];
            let totalStarting = 0;
            let totalSales = 0;
            let totalExp = 0;
            let totalExpected = 0;
            let totalActual = 0;
            let totalNetVariance = 0;

            exportData.forEach(shift => {
                const start = Number(shift.starting_cash || 0);
                const sales = Number(shift.cash_sales || 0);
                const exp = Number(shift.expenses || 0);
                const expected = Number(shift.expected_cash || 0);
                const actual = Number(shift.actual_cash || 0);
                const diff = Number(shift.difference || 0);

                totalStarting += start;
                totalSales += sales;
                totalExp += exp;
                totalExpected += expected;
                totalActual += actual;
                totalNetVariance += diff;

                const periodStr = `${formatDate(shift.start_time)}\n${formatTime(shift.start_time)} - ${shift.end_time ? formatTime(shift.end_time) : 'OPEN'}`;
                const durationStr = calculateDuration(shift.start_time, shift.end_time);

                tableRows.push([
                    shift.user?.name || 'Staff Member',
                    periodStr,
                    durationStr,
                    formatCurrency(start),
                    `+${formatCurrency(sales)}`,
                    `-${formatCurrency(exp)}`,
                    formatCurrency(expected),
                    shift.actual_cash ? formatCurrency(actual) : 'N/A',
                    `${diff > 0.01 ? '+' : ''}${formatCurrency(diff)}`
                ]);
            });

            autoTable(doc, {
                head: [tableColumns],
                body: tableRows,
                startY: tableStartY,
                theme: 'striped',
                headStyles: {
                    fillColor: '#1B3A69',
                    textColor: 255,
                    fontStyle: 'bold',
                    fontSize: 8.5,
                    halign: 'left'
                },
                columnStyles: {
                    0: { halign: 'left', cellWidth: 32 },
                    1: { halign: 'left', cellWidth: 42 },
                    2: { halign: 'center', cellWidth: 20 },
                    3: { halign: 'right', cellWidth: 26 },
                    4: { halign: 'right', cellWidth: 26 },
                    5: { halign: 'right', cellWidth: 24 },
                    6: { halign: 'right', cellWidth: 28 },
                    7: { halign: 'right', cellWidth: 28 },
                    8: { halign: 'right', cellWidth: 32 }
                },
                styles: {
                    fontSize: 8.5,
                    cellPadding: 3.5,
                    valign: 'middle'
                },
                didParseCell: function (data) {
                    if (data.section === 'body' && data.column.index === 8) {
                        const raw = String(data.cell.raw || '');
                        if (raw.startsWith('-') && !raw.includes('0.00')) {
                            data.cell.styles.textColor = [220, 38, 38];
                            data.cell.styles.fontStyle = 'bold';
                        } else if (raw.startsWith('+')) {
                            data.cell.styles.textColor = [22, 163, 74];
                            data.cell.styles.fontStyle = 'bold';
                        } else {
                            data.cell.styles.textColor = [71, 85, 105];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            });

            // ==============================================================
            // EXECUTIVE SUMMARY CONTAINER (PDF)
            // ==============================================================
            let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : tableStartY + 20;

            if (finalY > 150) {
                doc.addPage();
                finalY = 16;
            }

            const boxWidth = pageWidth - 28;
            const boxHeight = 44;

            doc.setFillColor(248, 250, 252); // #F8FAFC
            doc.setDrawColor(203, 213, 225); // #CBD5E1
            doc.setLineWidth(0.5);
            doc.roundedRect(14, finalY, boxWidth, boxHeight, 3, 3, 'FD');

            // Header Banner inside box
            doc.setFillColor(241, 245, 249);
            doc.roundedRect(14, finalY, boxWidth, 10, 3, 3, 'FD');
            doc.setFontSize(9.5);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(27, 58, 105);
            doc.text('SHIFT FINANCIAL RECONCILIATION SUMMARY', 20, finalY + 6.5);

            // 3-Column Content Breakdown
            const col1X = 20;
            const col2X = pageWidth / 3 + 10;
            const col3X = (pageWidth / 3) * 2 + 10;
            const contentY = finalY + 16;

            doc.setFontSize(8.5);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);

            // Col 1: Counts & Float
            doc.text(`Total Shifts Recorded:`, col1X, contentY);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text(`${exportData.length} shifts`, col1X + 42, contentY);

            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(`Total Starting Float:`, col1X, contentY + 7);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text(`${formatCurrency(totalStarting)}`, col1X + 42, contentY + 7);

            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(`Total Cash Sales:`, col1X, contentY + 14);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(22, 163, 74);
            doc.text(`+${formatCurrency(totalSales)}`, col1X + 42, contentY + 14);

            // Col 2: Drawer Math
            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(`Total Expenses:`, col2X, contentY);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(220, 38, 38);
            doc.text(`-${formatCurrency(totalExp)}`, col2X + 40, contentY);

            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(`Expected in Drawer:`, col2X, contentY + 7);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text(`${formatCurrency(totalExpected)}`, col2X + 40, contentY + 7);

            doc.setFont(undefined, 'normal');
            doc.setTextColor(71, 85, 105);
            doc.text(`Actual Count Collected:`, col2X, contentY + 14);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(27, 58, 105);
            doc.text(`${formatCurrency(totalActual)}`, col2X + 40, contentY + 14);

            // Col 3: Net Variance Box
            doc.setFont(undefined, 'bold');
            doc.setTextColor(15, 23, 42);
            doc.text(`Net Cash Discrepancy:`, col3X, contentY);

            const varColor = totalNetVariance < -0.01 ? [220, 38, 38] : (totalNetVariance > 0.01 ? [22, 163, 74] : [71, 85, 105]);
            const varPrefix = totalNetVariance > 0.01 ? '+' : '';
            doc.setFontSize(13);
            doc.setTextColor(...varColor);
            doc.text(`${varPrefix}${formatCurrency(totalNetVariance)}`, col3X, contentY + 10);

            doc.setFontSize(8);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(100, 116, 139);
            const statusLabel = Math.abs(totalNetVariance) < 0.01
                ? 'All Shifts Balanced'
                : (totalNetVariance < 0 ? 'Cash Shortage Detected' : 'Cash Overage Detected');
            doc.text(`Status: ${statusLabel}`, col3X, contentY + 17);

            doc.save(`Shift_Audit_Report_${startDate || 'All'}_to_${endDate || 'All'}.pdf`);

            setShowDataMenu(false);
            Swal.fire({
                icon: 'success',
                title: 'PDF Exported!',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 3000
            });
        } catch (error) {
            console.error("PDF Generation Error:", error);
            Swal.fire('Error', 'Failed to generate PDF report.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <AuthenticatedLayout
            user={auth.user}
            header={
                <div>
                    <h2 className="font-black text-xl text-gray-900 tracking-tight">Shift Accountability & History</h2>
                    <p className="text-xs font-semibold text-gray-500 mt-0.5">
                        {auth.user.is_admin
                            ? 'Monitor employee work shifts, cash drawer reconciliation, starting floats, and discrepancies'
                            : 'Review your register work sessions, cash drawer balancing, and shift summaries'}
                    </p>
                </div>
            }
        >
            <Head title="Shift History" />

            <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">

                    {/* ========================================================================= */}
                    {/* 1. EXECUTIVE SHIFT HEALTH KPI STRIP (Continuous Store Master Overview)      */}
                    {/* ========================================================================= */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">

                        {/* KPI 1: Total Shift Sales */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-wider truncate">
                                        {auth.user?.is_admin ? 'Total Shift Sales' : 'My Shift Sales'}
                                    </p>
                                    <h3 className="text-base sm:text-2xl font-black text-gray-900 tracking-tight truncate">
                                        {formatCurrency(kpiMetrics.totalCashSales)}
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none ring-1 ring-[#CBD7E6] shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                <span className="truncate">{auth.user?.is_admin ? 'Total Sessions' : 'My Sessions'}</span>
                                <span className="font-bold text-gray-700 truncate shrink-0">{kpiMetrics.totalShifts} shifts</span>
                            </div>
                        </div>

                        {/* KPI 2: Actual Cash Collected */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-emerald-700 uppercase tracking-wider truncate">
                                        {auth.user?.is_admin ? 'Cash Collected' : 'My Cash Collected'}
                                    </p>
                                    <h3 className="text-base sm:text-2xl font-black text-emerald-900 tracking-tight truncate">
                                        {formatCurrency(kpiMetrics.totalActualCash)}
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-emerald-100/70 text-emerald-700 rounded-none ring-1 ring-emerald-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6H2.25m0 0v8.25m0-8.25h19.5m0 0v8.25m0-8.25a.75.75 0 00-.75-.75h-.75V4.5m1.5 1.5v8.25a.75.75 0 01-.75.75h-.75M3.75 6h16.5m0 0v8.25m0 0a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V6m0 0v8.25" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-emerald-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-emerald-700 gap-1">
                                <span className="truncate">Starting Float Total</span>
                                <span className="font-bold text-emerald-800 truncate shrink-0">{formatCurrency(kpiMetrics.totalStartingCash)}</span>
                            </div>
                        </div>

                        {/* KPI 3: Net Cash Variance (Short / Over) */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className={`text-[10px] sm:text-[11px] font-black uppercase tracking-wider truncate ${kpiMetrics.totalVariance < -0.01 ? 'text-rose-700' : 'text-slate-700'}`}>
                                        Net Variance
                                    </p>
                                    <h3 className={`text-base sm:text-2xl font-black tracking-tight truncate ${kpiMetrics.totalVariance < -0.01 ? 'text-rose-900' : (kpiMetrics.totalVariance > 0.01 ? 'text-emerald-800' : 'text-slate-800')}`}>
                                        {kpiMetrics.totalVariance > 0.01 ? '+' : ''}{formatCurrency(kpiMetrics.totalVariance)}
                                    </h3>
                                </div>
                                <div className={`p-2 sm:p-2.5 rounded-none ring-1 shrink-0 ${kpiMetrics.totalVariance < -0.01 ? 'bg-rose-100/70 text-rose-700 ring-rose-200' : 'bg-slate-100 text-slate-700 ring-slate-200'}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-gray-600 gap-1">
                                <span className="truncate">{kpiMetrics.shortageCount} Short · {kpiMetrics.overageCount} Over</span>
                                <span className="font-bold text-gray-700 truncate shrink-0">Variance Summary</span>
                            </div>
                        </div>

                        {/* KPI 4: Operational Sessions & Balanced Count */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-blue-700 uppercase tracking-wider truncate">Balanced Shifts</p>
                                    <h3 className="text-base sm:text-2xl font-black text-blue-900 tracking-tight truncate">
                                        {kpiMetrics.balancedCount} <span className="text-xs font-semibold text-blue-600">sessions</span>
                                    </h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-blue-100/70 text-blue-700 rounded-none ring-1 ring-blue-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-blue-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-blue-700 gap-1">
                                <span className="truncate">Audit Status</span>
                                <span className="font-bold text-blue-800 truncate shrink-0">Zero Variance</span>
                            </div>
                        </div>
                    </div>

                    {/* ========================================================================= */}
                    {/* 2. SHIFTS WORKSPACE: CONNECTED TABS + MAIN CONTENT CARD                   */}
                    {/* ========================================================================= */}
                    <div ref={workspaceSectionRef} className="flex flex-col scroll-mt-4">

                        {/* Interactive Pipeline Status Tabs */}
                        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth -mb-px relative z-20 pt-1">
                            <div ref={pipelineTabsRef} className="flex flex-nowrap items-end gap-1 sm:gap-1.5 px-3 w-max min-w-full">

                                {/* All Shifts */}
                                <button
                                    data-tab="all"
                                    onClick={() => handleStatusTabChange('all')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'all'
                                            ? 'bg-white text-gray-900 font-black border-t-[#1B3B6A] border-x-gray-200/90 shadow-xs z-20'
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
                                    <span>All Shifts</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'all'
                                            ? 'bg-[#1B3B6A] text-white shadow-2xs'
                                            : 'bg-gray-200/80 text-gray-700 group-hover:bg-gray-300'
                                    }`}>
                                        {tabCounts.all}
                                    </span>
                                </button>

                                {/* Balanced Shifts (0.00) */}
                                <button
                                    data-tab="balanced"
                                    onClick={() => handleStatusTabChange('balanced')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'balanced'
                                            ? 'bg-white text-emerald-950 font-black border-t-emerald-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'balanced' && (
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
                                    <span>Balanced</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'balanced'
                                            ? 'bg-emerald-600 text-white shadow-2xs'
                                            : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                                    }`}>
                                        {tabCounts.balanced}
                                    </span>
                                </button>

                                {/* Shortages (-) */}
                                <button
                                    data-tab="shortage"
                                    onClick={() => handleStatusTabChange('shortage')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'shortage'
                                            ? 'bg-white text-rose-950 font-black border-t-rose-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'shortage' && (
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
                                    <span>Shortages</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'shortage'
                                            ? 'bg-rose-600 text-white shadow-2xs'
                                            : 'bg-rose-50 text-rose-700 group-hover:bg-rose-100'
                                    }`}>
                                        {tabCounts.shortage}
                                    </span>
                                </button>

                                {/* Overages (+) */}
                                <button
                                    data-tab="overage"
                                    onClick={() => handleStatusTabChange('overage')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'overage'
                                            ? 'bg-white text-indigo-950 font-black border-t-indigo-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'overage' && (
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
                                    <span>Overages</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'overage'
                                            ? 'bg-indigo-600 text-white shadow-2xs'
                                            : 'bg-indigo-50 text-indigo-700 group-hover:bg-indigo-100'
                                    }`}>
                                        {tabCounts.overage}
                                    </span>
                                </button>

                                {/* Open / Active Shifts */}
                                <button
                                    data-tab="open"
                                    onClick={() => handleStatusTabChange('open')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        statusTab === 'open'
                                            ? 'bg-white text-blue-950 font-black border-t-blue-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {statusTab === 'open' && (
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
                                    <span>Active / Open</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        statusTab === 'open'
                                            ? 'bg-blue-600 text-white shadow-2xs'
                                            : 'bg-blue-50 text-blue-700 group-hover:bg-blue-100'
                                    }`}>
                                        {tabCounts.open}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* MAIN CONTENT CARD: TOOLBAR + TABLE / CARDS + PAGINATION */}
                        <div className="bg-white rounded-none border border-gray-200/80 shadow-sm overflow-hidden flex flex-col relative z-10">

                            {/* 2-TIER RESPONSIVE OPERATIONAL TOOLBAR */}
                            <div className="p-3 sm:p-4 border-b border-gray-200/80 bg-white flex flex-col gap-3">

                                {/* Tier 1: Search, View Mode Toggle, Cashier Selector / Date Presets */}
                                <div className="flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-3 w-full">

                                    {/* Search Input */}
                                    <div className="relative flex-1 min-w-full sm:min-w-[220px] lg:min-w-[260px]">
                                        <input
                                            type="text"
                                            placeholder="Search by Cashier Name, Email, or Shift ID..."
                                            className="pl-11 pr-10 py-2.5 bg-gray-50/70 border border-gray-200 rounded-none w-full focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 focus:bg-white text-xs sm:text-sm font-medium transition-all shadow-2xs placeholder:text-gray-400"
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                        />
                                        <svg className="w-5 h-5 text-gray-400 absolute left-3.5 top-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                        </svg>
                                        {searchQuery && (
                                            <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 p-0.5 cursor-pointer">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    {/* Action Group: View Mode Toggle & Cashier / Date Selector */}
                                    <div className="flex items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0 justify-between sm:justify-end">

                                        {/* View Mode Toggle (Desktop only - List vs Cards) */}
                                        <div className="hidden lg:inline-flex rounded-none bg-gray-100 p-1 border border-gray-200 shrink-0">
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

                                    </div>
                                </div>

                                {/* Tier 2: Custom Date Range (From, To), Date Presets Dropdown & Data & Export Dropdown (Admin Only) */}
                                {auth.user?.is_admin && (
                                    <div className="pt-2.5 border-t border-gray-100 pb-0.5 relative z-20">
                                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 w-full">

                                            {/* Left Side: Section Label */}
                                            <div className="hidden lg:block">
                                                <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Shift Audit Actions</span>
                                            </div>

                                            {/* Right Side: From, To, Date Presets, Data & Export */}
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

                                                {/* Date Presets Dropdown */}
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

                                                {/* Cash Movement Button */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCashMovementModal(true)}
                                                    className="h-[38px] w-full lg:w-auto justify-center px-3.5 py-2 rounded-none font-bold text-xs sm:text-sm bg-[#1B3B6A] text-white hover:bg-[#142E54] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                                                    title="Record a general cash movement"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-white">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                                                    </svg>
                                                    <span>Cash In / Cash Out</span>
                                                </button>

                                                {/* Global Cash Movement History Button */}
                                                <button
                                                    type="button"
                                                    onClick={() => setShowCashMovementHistoryModal(true)}
                                                    className="h-[38px] w-full lg:w-auto justify-center px-3.5 py-2 rounded-none font-bold text-xs sm:text-sm bg-[#EFF4F9] text-[#1B3B6A] hover:bg-[#E2ECF6] border border-[#CBD7E6] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                                                    title="View the global cash movement history"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                                                    </svg>
                                                    <span>Cash Movement History</span>
                                                </button>

                                                {/* Data & Export Dropdown */}
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
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Cashier / Staff</th>
                                                    <th className="py-3.5 px-4 whitespace-nowrap">Shift Period</th>
                                                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Duration</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Starting Float</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Cash Sales</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Expenses</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Expected</th>
                                                    <th className="py-3.5 px-4 text-right whitespace-nowrap">Actual Count</th>
                                                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Variance</th>
                                                    <th className="py-3.5 px-4 text-center whitespace-nowrap">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {loading ? (
                                                    Array.from({ length: 6 }).map((_, index) => (
                                                        <tr key={`skel-${index}`} className="animate-pulse">
                                                            <td className="py-4 px-4"><div className="h-4 bg-gray-200 rounded-none w-28"></div></td>
                                                            <td className="py-4 px-4"><div className="h-4 bg-gray-200 rounded-none w-36 mb-1"></div><div className="h-3 bg-gray-200 rounded-none w-24"></div></td>
                                                            <td className="py-4 px-4 text-center"><div className="h-4 bg-gray-200 rounded-none w-14 mx-auto"></div></td>
                                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-gray-200 rounded-none w-16 ml-auto"></div></td>
                                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-gray-200 rounded-none w-16 ml-auto"></div></td>
                                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-gray-200 rounded-none w-14 ml-auto"></div></td>
                                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-gray-200 rounded-none w-18 ml-auto"></div></td>
                                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-gray-200 rounded-none w-18 ml-auto"></div></td>
                                                            <td className="py-4 px-4 text-center"><div className="h-6 bg-gray-200 rounded-none w-16 mx-auto"></div></td>
                                                            <td className="py-4 px-4 text-center"><div className="h-8 w-8 bg-gray-200 rounded-none mx-auto"></div></td>
                                                        </tr>
                                                    ))
                                                ) : paginatedShifts.length === 0 ? (
                                                    <tr>
                                                        <td colSpan={10} className="py-16 text-center text-gray-500">
                                                            <div className="flex flex-col items-center justify-center space-y-3">
                                                                <div className="w-14 h-14 bg-gray-100 text-gray-400 rounded-none flex items-center justify-center">
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-7 h-7">
                                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                                    </svg>
                                                                </div>
                                                                <p className="text-sm font-bold text-gray-700">No shift records found</p>
                                                                <p className="text-xs text-gray-400 max-w-sm">Try adjusting your date range, search criteria, or shift status tab.</p>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : (
                                                    paginatedShifts.map((shift) => {
                                                        const start = Number(shift.starting_cash || 0);
                                                        const sales = Number(shift.cash_sales || 0);
                                                        const exp = Number(shift.expenses || 0);
                                                        const expected = Number(shift.expected_cash || 0);
                                                        const actual = Number(shift.actual_cash || 0);
                                                        const diff = Number(shift.difference || 0);
                                                        const isOpen = shift.status === 'open' || !shift.end_time;

                                                        return (
                                                            <tr key={shift.id} className="hover:bg-gray-50/80 transition-colors group">
                                                                {/* Cashier / Staff */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className="flex items-center gap-2.5">
                                                                        {shift.user?.avatar_path ? (
                                                                            <img
                                                                                src={getAvatarUrl(shift.user.avatar_path)}
                                                                                alt={shift.user.name}
                                                                                className="w-9 h-9 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                            />
                                                                        ) : (
                                                                            <div className="w-9 h-9 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-gray-200 flex items-center justify-center font-black text-xs shrink-0 uppercase shadow-2xs">
                                                                                {(shift.user?.name || 'S').charAt(0)}
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <span className="font-black text-gray-900 text-sm block">
                                                                                {shift.user?.name || 'Staff Member'}
                                                                            </span>
                                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                                <span className="text-[10px] font-semibold text-gray-400">
                                                                                    Shift #{shift.id}
                                                                                </span>
                                                                                <span className="text-gray-300">·</span>
                                                                                <span className="text-[10px] font-bold text-[#1B3B6A] bg-[#EFF4F9] border border-[#CBD7E6]/60 px-1.5 py-0.5 rounded-none">
                                                                                    {shift.terminal?.name || 'Register 1'}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                {/* Shift Period */}
                                                                <td className="py-3.5 px-4 whitespace-nowrap">
                                                                    <div className="text-xs font-bold text-gray-900">
                                                                        {formatDate(shift.start_time)}
                                                                    </div>
                                                                    <div className="text-[10px] font-semibold text-gray-400 flex items-center gap-1 mt-0.5">
                                                                        <span>{formatTime(shift.start_time)}</span>
                                                                        <span>→</span>
                                                                        <span className={isOpen ? 'text-blue-600 font-bold' : ''}>
                                                                            {isOpen ? 'OPEN' : formatTime(shift.end_time)}
                                                                        </span>
                                                                    </div>
                                                                </td>

                                                                {/* Duration */}
                                                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-none text-[11px] font-bold bg-gray-100 text-gray-700">
                                                                        {calculateDuration(shift.start_time, shift.end_time)}
                                                                    </span>
                                                                </td>

                                                                {/* Starting Float */}
                                                                <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-gray-700 text-xs sm:text-sm">
                                                                    {formatCurrency(start)}
                                                                </td>

                                                                {/* Cash Sales */}
                                                                <td className="py-3.5 px-4 text-right whitespace-nowrap font-black text-emerald-600 text-xs sm:text-sm">
                                                                    +{formatCurrency(sales)}
                                                                </td>

                                                                {/* Expenses */}
                                                                <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-rose-500 text-xs sm:text-sm">
                                                                    {exp > 0 ? `-${formatCurrency(exp)}` : '0.00'}
                                                                </td>

                                                                {/* Expected in Drawer */}
                                                                <td className="py-3.5 px-4 text-right whitespace-nowrap font-bold text-gray-900 text-xs sm:text-sm">
                                                                    {formatCurrency(expected)}
                                                                </td>

                                                                {/* Actual Count */}
                                                                <td className="py-3.5 px-4 text-right whitespace-nowrap font-black text-[#1B3B6A] text-xs sm:text-sm">
                                                                    {shift.actual_cash ? formatCurrency(actual) : '—'}
                                                                </td>

                                                                {/* Variance Badge */}
                                                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                                                    {isOpen ? (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200/80">
                                                                            Active
                                                                        </span>
                                                                    ) : Math.abs(diff) < 0.01 ? (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                                                                            Balanced
                                                                        </span>
                                                                    ) : diff < -0.01 ? (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200/80">
                                                                            {formatCurrency(diff)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                                                                            +{formatCurrency(diff)}
                                                                        </span>
                                                                    )}
                                                                </td>

                                                                {/* Actions */}
                                                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleViewDetails(shift)}
                                                                        className="p-2 rounded-none text-[#1B3B6A] hover:bg-[#EFF4F9] hover:text-[#142E54] transition-all cursor-pointer inline-flex items-center justify-center border border-transparent hover:border-[#CBD7E6]"
                                                                        title="View Z-Read & Drawer Details"
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

                            {/* 4. CARDS GRID VIEW (Mobile & Responsive Grid Mode) */}
                            {(viewMode === 'grid' || window.innerWidth < 1024) && (
                                <div className={`${viewMode === 'table' ? 'lg:hidden' : ''} p-3.5 sm:p-4 bg-gray-50/50`}>
                                    {loading ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                            {Array.from({ length: 6 }).map((_, index) => (
                                                <div key={`mob-skel-${index}`} className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs animate-pulse space-y-3">
                                                    <div className="flex justify-between items-start">
                                                        <div className="h-4 bg-gray-200 rounded-none w-24"></div>
                                                        <div className="h-5 bg-gray-200 rounded-none w-16"></div>
                                                    </div>
                                                    <div className="h-3 bg-gray-200 rounded-none w-36"></div>
                                                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100">
                                                        <div className="h-4 bg-gray-200 rounded-none w-16"></div>
                                                        <div className="h-4 bg-gray-200 rounded-none w-16 ml-auto"></div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : paginatedShifts.length === 0 ? (
                                        <div className="bg-white rounded-none p-10 text-center border border-gray-200">
                                            <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-none flex items-center justify-center mx-auto mb-3">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            </div>
                                            <h3 className="text-sm font-bold text-gray-800">No shifts found</h3>
                                            <p className="text-xs text-gray-400 mt-1">Try changing your search query or status filter.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                            {paginatedShifts.map((shift) => {
                                                const start = Number(shift.starting_cash || 0);
                                                const sales = Number(shift.cash_sales || 0);
                                                const expected = Number(shift.expected_cash || 0);
                                                const actual = Number(shift.actual_cash || 0);
                                                const diff = Number(shift.difference || 0);
                                                const isOpen = shift.status === 'open' || !shift.end_time;

                                                return (
                                                    <div
                                                        key={shift.id}
                                                        onClick={() => handleViewDetails(shift)}
                                                        className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs hover:border-[#1B3B6A]/30 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                                                    >
                                                        <div className="space-y-3">
                                                            {/* Card Header: Cashier & Variance Badge */}
                                                            <div className="flex justify-between items-start gap-2">
                                                                <div className="flex items-center gap-2.5 min-w-0">
                                                                    {shift.user?.avatar_path ? (
                                                                        <img
                                                                            src={getAvatarUrl(shift.user.avatar_path)}
                                                                            alt={shift.user.name}
                                                                            className="w-9 h-9 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-9 h-9 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-[#CBD7E6] flex items-center justify-center font-black text-xs shrink-0 shadow-2xs">
                                                                            {(shift.user?.name || 'S').charAt(0).toUpperCase()}
                                                                        </div>
                                                                    )}
                                                                    <div className="min-w-0">
                                                                        <h4 className="font-black text-gray-900 text-sm truncate">
                                                                            {shift.user?.name || 'Staff Member'}
                                                                        </h4>
                                                                        <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-400 truncate">
                                                                            <span>Shift #{shift.id}</span>
                                                                            <span>·</span>
                                                                            <span className="text-[#1B3B6A] font-bold">{shift.terminal?.name || 'Register 1'}</span>
                                                                            <span>·</span>
                                                                            <span>{calculateDuration(shift.start_time, shift.end_time)}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Status / Variance Badge */}
                                                                {isOpen ? (
                                                                    <span className="px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                                                                        Active
                                                                    </span>
                                                                ) : Math.abs(diff) < 0.01 ? (
                                                                    <span className="px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                                                        Balanced
                                                                    </span>
                                                                ) : diff < -0.01 ? (
                                                                    <span className="px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
                                                                        {formatCurrency(diff)}
                                                                    </span>
                                                                ) : (
                                                                    <span className="px-2.5 py-1 rounded-none text-[10px] font-black uppercase tracking-wider bg-indigo-50 text-indigo-700 border border-indigo-200 shrink-0">
                                                                        +{formatCurrency(diff)}
                                                                    </span>
                                                                )}
                                                            </div>

                                                            {/* Shift Period */}
                                                            <div className="bg-gray-50/80 rounded-none p-2.5 text-xs flex justify-between items-center text-gray-600 border border-gray-100">
                                                                <span className="font-bold text-gray-500">{formatDate(shift.start_time)}</span>
                                                                <span className="font-medium text-gray-700">
                                                                    {formatTime(shift.start_time)} → {isOpen ? 'OPEN' : formatTime(shift.end_time)}
                                                                </span>
                                                            </div>

                                                            {/* Drawer Financial Summary */}
                                                            <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                                                                <div>
                                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Cash Sales</span>
                                                                    <span className="font-black text-emerald-600 text-sm">+{formatCurrency(sales)}</span>
                                                                </div>
                                                                <div className="text-right">
                                                                    <span className="text-gray-400 font-bold block text-[10px] uppercase">Actual Count</span>
                                                                    <span className="font-black text-[#1B3B6A] text-sm">
                                                                        {shift.actual_cash ? formatCurrency(actual) : '—'}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Card Footer: Starting & Expected */}
                                                        <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center text-[11px] text-gray-500 font-semibold">
                                                            <span>Float: {formatCurrency(start)}</span>
                                                            <span className="text-[#1B3B6A] font-bold flex items-center gap-1 group-hover:underline">
                                                                <span>View Z-Read</span>
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                                                </svg>
                                                            </span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 5. SEPARATE PAGINATION (Outside main card, matching Inventory & Transactions) */}
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
            {/* 6. SHIFT AUDIT & Z-READ DETAIL MODAL                                      */}
            {/* ========================================================================= */}
            {showDetails && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4 transition-opacity">
                    <div className="absolute inset-0" onClick={() => setShowDetails(false)}></div>

                    <div className="relative bg-white w-full max-w-lg rounded-none shadow-2xl overflow-hidden flex flex-col max-h-[90vh] z-10 animate-in zoom-in-95 duration-200 border border-gray-100">

                        {/* Top Pull Bar (Mobile) */}
                        <div className="sm:hidden flex justify-center pt-2.5 pb-1 bg-[#1B3B6A] w-full cursor-pointer" onClick={() => setShowDetails(false)}>
                            <div className="w-12 h-1.5 bg-white/30 rounded-none"></div>
                        </div>

                        {/* Modal Header */}
                        <div className="bg-[#1B3B6A] px-6 py-4 flex justify-between items-center text-white shrink-0 shadow-md">
                            <div className="flex items-center gap-3 min-w-0">
                                {selectedShiftData?.staff_avatar || selectedShiftData?.shift_record?.user?.avatar_path ? (
                                    <img
                                        src={getAvatarUrl(selectedShiftData.staff_avatar || selectedShiftData.shift_record?.user?.avatar_path)}
                                        alt={selectedShiftData.staff_name}
                                        className="w-10 h-10 rounded-none object-cover border border-white/30 shadow-sm shrink-0"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-none bg-white/10 text-white border border-white/20 flex items-center justify-center font-black text-sm shrink-0">
                                        {(selectedShiftData?.staff_name || 'S').charAt(0).toUpperCase()}
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <h3 className="text-lg font-black tracking-tight truncate">Shift Z-Read & Audit</h3>
                                    <p className="text-xs text-white/80 font-medium mt-0.5 flex items-center gap-1.5 truncate">
                                        <span>Shift #{selectedShiftData?.id || '—'}</span>
                                        <span>·</span>
                                        <span className="font-bold text-white truncate">{selectedShiftData?.staff_name || 'Staff Member'}</span>
                                        {selectedShiftData?.terminal?.name && (
                                            <>
                                                <span>·</span>
                                                <span className="bg-white/20 px-1.5 py-0.5 rounded-none text-[10px] font-bold shrink-0">
                                                    {selectedShiftData.terminal.name}
                                                </span>
                                            </>
                                        )}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowDetails(false)}
                                className="text-white/70 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-none cursor-pointer shrink-0 ml-2"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        {/* Sub-tab Switcher */}
                        {selectedShiftData && (
                            <div className="flex border-b border-gray-200 bg-gray-50/80 px-6 pt-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setModalTab('summary')}
                                    className={`pb-2.5 px-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer ${
                                        modalTab === 'summary'
                                            ? 'border-[#1B3B6A] text-[#1B3B6A]'
                                            : 'border-transparent text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    Z-Read Reconciliation
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setModalTab('movements')}
                                    className={`pb-2.5 px-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                                        modalTab === 'movements'
                                            ? 'border-[#1B3B6A] text-[#1B3B6A]'
                                            : 'border-transparent text-gray-500 hover:text-gray-800'
                                    }`}
                                >
                                    <span>Movements & Notes</span>
                                    {selectedShiftData.cash_movements?.length > 0 && (
                                        <span className="w-4 h-4 rounded-none bg-[#1B3B6A] text-white text-[10px] flex items-center justify-center font-bold">
                                            {selectedShiftData.cash_movements.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* Modal Content */}
                        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar space-y-4 bg-white">
                            {isLoadingDetails || !selectedShiftData ? (
                                <div className="py-12 flex flex-col items-center justify-center space-y-3">
                                    <div className="animate-spin rounded-none h-8 w-8 border-b-2 border-[#1B3B6A]"></div>
                                    <p className="text-xs font-bold text-gray-500">Loading shift audit data...</p>
                                </div>
                            ) : modalTab === 'summary' ? (
                                <div className="space-y-4">
                                    {/* Shift Timestamps Pill */}
                                    <div className="bg-gray-50/80 p-4 rounded-none border border-gray-100 flex justify-between items-center text-xs">
                                        <div>
                                            <span className="text-gray-400 font-bold block text-[10px] uppercase tracking-wider">Opened / Closed</span>
                                            <span className="font-semibold text-gray-700">
                                                {formatDateTime(selectedShiftData.start_time)} → {selectedShiftData.end_time ? formatDateTime(selectedShiftData.end_time) : 'ACTIVE'}
                                            </span>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <span className="text-gray-400 font-bold block text-[10px] uppercase tracking-wider">Duration</span>
                                            <span className="font-black text-gray-900">
                                                {calculateDuration(selectedShiftData.start_time, selectedShiftData.end_time)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Opening Handover Audit Banner (if discrepancy exists) */}
                                    {Math.abs(Number(selectedShiftData.opening_discrepancy || 0)) > 0.01 && (
                                        <div className={`p-3.5 rounded-none border text-xs space-y-1 ${
                                            Number(selectedShiftData.opening_discrepancy || 0) < 0 
                                                ? 'bg-amber-50 border-amber-200 text-amber-900' 
                                                : 'bg-indigo-50 border-indigo-200 text-indigo-900'
                                        }`}>
                                            <div className="flex justify-between items-center font-bold">
                                                <span className="text-[10px] uppercase tracking-wider">Opening Handover Variance:</span>
                                                <span className="font-black text-sm">
                                                    {Number(selectedShiftData.opening_discrepancy || 0) > 0 ? '+' : ''}
                                                    {formatCurrency(selectedShiftData.opening_discrepancy)}
                                                </span>
                                            </div>
                                            <div className="text-[11px] opacity-85 flex justify-between">
                                                <span>Expected: {formatCurrency(selectedShiftData.expected_opening_cash)}</span>
                                                <span>Counted Float: {formatCurrency(selectedShiftData.starting_cash)}</span>
                                            </div>
                                        </div>
                                    )}

                                    {/* Drawer Cash Math Box */}
                                    <div className="bg-gray-50 p-5 rounded-none space-y-3 border border-gray-100 text-xs sm:text-sm shadow-inner">
                                        <div className="text-[10px] uppercase font-black text-gray-400 tracking-widest pb-2 border-b border-gray-200/80">
                                            Cash Drawer Reconciliation
                                        </div>

                                        <div className="flex justify-between items-center text-gray-600">
                                            <span className="font-medium">Starting Cash Float</span>
                                            <span className="font-bold text-gray-800">{formatCurrency(selectedShiftData.starting_cash)}</span>
                                        </div>

                                        <div className="flex justify-between items-center text-emerald-600">
                                            <span className="font-medium">+ Cash Sales Collected</span>
                                            <span className="font-black">+{formatCurrency(selectedShiftData.cash_sales)}</span>
                                        </div>

                                        {Number(selectedShiftData.cash_in || 0) > 0 && (
                                            <div className="flex justify-between items-center text-emerald-600">
                                                <span className="font-medium">+ Cash In / Float Top-up</span>
                                                <span className="font-black">+{formatCurrency(selectedShiftData.cash_in)}</span>
                                            </div>
                                        )}

                                        {Number(selectedShiftData.cash_out || 0) > 0 && (
                                            <div className="flex justify-between items-center text-rose-500">
                                                <span className="font-medium">- Cash Out / Owner Draw</span>
                                                <span className="font-black">-{formatCurrency(selectedShiftData.cash_out)}</span>
                                            </div>
                                        )}

                                        {Number(selectedShiftData.expenses || 0) > 0 && (
                                            <div className="flex justify-between items-center text-rose-500">
                                                <span className="font-medium">- Store Expenses / Payouts</span>
                                                <span className="font-black">-{formatCurrency(selectedShiftData.expenses)}</span>
                                            </div>
                                        )}

                                        <div className="border-t border-dashed border-gray-300 my-2"></div>

                                        <div className="flex justify-between items-center font-bold text-gray-800">
                                            <span>Expected in Drawer</span>
                                            <span className="font-black text-gray-900">{formatCurrency(selectedShiftData.expected_cash)}</span>
                                        </div>

                                        <div className="flex justify-between items-center font-black text-[#1B3B6A]">
                                            <span>Actual Count Turnover</span>
                                            <span className="font-black text-base">{formatCurrency(selectedShiftData.actual_cash)}</span>
                                        </div>
                                    </div>

                                    {/* Discrepancy Status Hero Box */}
                                    <div className={`p-5 rounded-none text-center border shadow-xs ${
                                        Math.abs(Number(selectedShiftData.difference || 0)) < 0.01
                                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                            : Number(selectedShiftData.difference || 0) > 0
                                                ? 'bg-[#EFF4F9] text-[#1B3B6A] border-[#CBD7E6]'
                                                : 'bg-rose-50 text-rose-700 border-rose-200'
                                    }`}>
                                        <div className="text-[10px] font-black uppercase tracking-widest opacity-75 mb-1">
                                            {Math.abs(Number(selectedShiftData.difference || 0)) < 0.01
                                                ? 'Cash Drawer Status'
                                                : (Number(selectedShiftData.difference || 0) > 0 ? 'Cash Drawer Overage' : 'Cash Drawer Shortage')}
                                        </div>
                                        <div className="text-2xl sm:text-3xl font-black tracking-tight">
                                            {Math.abs(Number(selectedShiftData.difference || 0)) < 0.01
                                                ? 'BALANCED (0.00)'
                                                : `${Number(selectedShiftData.difference || 0) > 0 ? '+' : '-'}${formatCurrency(Math.abs(Number(selectedShiftData.difference || 0)))}`}
                                        </div>
                                    </div>

                                    {/* Gross Sales Breakdown Across Channels */}
                                    <div className="bg-gray-50 p-5 rounded-none space-y-3 border border-gray-100 text-xs sm:text-sm shadow-inner">
                                        <div className="flex justify-between items-center pb-2 border-b border-gray-200/80">
                                            <span className="text-[10px] uppercase font-black text-gray-400 tracking-widest">
                                                Gross Sales by Channel
                                            </span>
                                            <span className="text-[10px] font-bold text-gray-500">
                                                {selectedShiftData.transactions_count || 0} Checkouts
                                            </span>
                                        </div>

                                        <div className="space-y-2 pt-1">
                                            <div className="flex justify-between items-center">
                                                <span className="text-gray-500 font-medium">Cash Sales</span>
                                                <span className="font-bold text-gray-900">{formatCurrency(selectedShiftData.cash_sales)}</span>
                                            </div>

                                            {Number(selectedShiftData.gcash_sales || 0) > 0 && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-500 font-medium">GCash</span>
                                                    <span className="font-bold text-blue-600">+{formatCurrency(selectedShiftData.gcash_sales)}</span>
                                                </div>
                                            )}

                                            {Number(selectedShiftData.maya_sales || 0) > 0 && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-500 font-medium">Maya</span>
                                                    <span className="font-bold text-emerald-700">+{formatCurrency(selectedShiftData.maya_sales)}</span>
                                                </div>
                                            )}

                                            {Number(selectedShiftData.credit_card_sales || 0) > 0 && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-500 font-medium">Credit Card</span>
                                                    <span className="font-bold text-purple-600">+{formatCurrency(selectedShiftData.credit_card_sales)}</span>
                                                </div>
                                            )}

                                            {Number(selectedShiftData.debit_card_sales || 0) > 0 && (
                                                <div className="flex justify-between items-center">
                                                    <span className="text-gray-500 font-medium">Debit / BancNet</span>
                                                    <span className="font-bold text-indigo-600">+{formatCurrency(selectedShiftData.debit_card_sales)}</span>
                                                </div>
                                            )}

                                            {(!Number(selectedShiftData.gcash_sales || 0) && !Number(selectedShiftData.maya_sales || 0) && !Number(selectedShiftData.credit_card_sales || 0) && !Number(selectedShiftData.debit_card_sales || 0)) && (
                                                <div className="text-[11px] text-gray-400 italic">No non-cash sales in this shift.</div>
                                            )}
                                        </div>

                                        <div className="border-t border-dashed border-gray-300 my-2 pt-2 flex justify-between items-center font-black text-sm sm:text-base">
                                            <span className="text-gray-900">Total Gross Sales</span>
                                            <span className="text-gray-900">{formatCurrency(
                                                Number(selectedShiftData.cash_sales || 0) +
                                                Number(selectedShiftData.gcash_sales || 0) +
                                                Number(selectedShiftData.maya_sales || 0) +
                                                Number(selectedShiftData.credit_card_sales || 0) +
                                                Number(selectedShiftData.debit_card_sales || 0)
                                            )}</span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Tab 2: Cash Movements & Audit Notes */
                                <div className="space-y-4">
                                    {/* Shift Notes Banner */}
                                    {(selectedShiftData.opening_notes || selectedShiftData.closing_notes) && (
                                        <div className="bg-gray-50 p-4 rounded-none border border-gray-200/80 space-y-2.5 text-xs">
                                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-wider block">
                                                Shift Handover & Closing Comments
                                            </span>
                                            {selectedShiftData.opening_notes && (
                                                <div className="bg-white p-3 rounded-none border border-gray-100 space-y-1">
                                                    <span className="font-black text-[#1B3B6A] text-[10px] uppercase block">Opening Note:</span>
                                                    <p className="text-gray-700 italic">{selectedShiftData.opening_notes}</p>
                                                </div>
                                            )}
                                            {selectedShiftData.closing_notes && (
                                                <div className="bg-white p-3 rounded-none border border-gray-100 space-y-1">
                                                    <span className="font-black text-rose-600 text-[10px] uppercase block">Closing Note:</span>
                                                    <p className="text-gray-700 italic">{selectedShiftData.closing_notes}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Cash Movement Ledger */}
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">
                                                Drawer Cash Adjustments
                                            </span>
                                            <span className="text-[11px] font-bold text-gray-400">
                                                {selectedShiftData.cash_movements?.length || 0} Transactions
                                            </span>
                                        </div>

                                        {(!selectedShiftData.cash_movements || selectedShiftData.cash_movements.length === 0) ? (
                                            <div className="py-8 text-center bg-gray-50 rounded-none border border-gray-100 text-gray-400 text-xs font-semibold">
                                                No intermediate or mid-shift cash movements recorded for this shift.
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {selectedShiftData.cash_movements.map((movement) => {
                                                    const isOut = movement.type.includes('out') || movement.type === 'owner_draw' || movement.type === 'safe_drop' || movement.type === 'expense';
                                                    return (
                                                        <div key={movement.id} className="p-3 bg-gray-50 rounded-none border border-gray-200/80 flex items-center justify-between text-xs">
                                                            <div className="space-y-0.5">
                                                                <div className="flex items-center gap-2">
                                                                    <span className={`px-2 py-0.5 rounded-none font-black text-[9px] uppercase tracking-wider ${
                                                                        movement.type === 'owner_draw'
                                                                            ? 'bg-amber-100 text-amber-800'
                                                                            : movement.type === 'safe_drop'
                                                                                ? 'bg-indigo-100 text-indigo-800'
                                                                                : isOut
                                                                                    ? 'bg-rose-100 text-rose-800'
                                                                                    : 'bg-emerald-100 text-emerald-800'
                                                                    }`}>
                                                                        {movement.type.replace('_', ' ')}
                                                                    </span>
                                                                    <span className="font-bold text-gray-900">{movement.reason || 'Cash Adjustment'}</span>
                                                                </div>
                                                                <div className="text-[10px] text-gray-400">
                                                                    {movement.user?.name || 'Staff'} · {formatDateTime(movement.created_at)}
                                                                </div>
                                                            </div>
                                                            <div className={`font-black text-sm ${isOut ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                {isOut ? '-' : '+'}₱{formatCurrency(movement.amount)}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer: Print Thermal Z-Read */}
                        <div className="p-4 bg-gray-50 border-t border-gray-100 flex flex-col sm:flex-row justify-end gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowDetails(false)}
                                className="w-full sm:w-auto px-4 py-2.5 rounded-none border border-gray-200 font-bold text-xs sm:text-sm text-gray-700 hover:bg-gray-100 transition-all cursor-pointer text-center order-2 sm:order-1"
                            >
                                Close
                            </button>

                            {selectedShiftData && (
                                <button
                                    type="button"
                                    onClick={() => printZRead(selectedShiftData, settings)}
                                    className="w-full sm:w-auto px-5 py-2.5 rounded-none font-bold text-xs sm:text-sm bg-[#1B3B6A] text-white hover:bg-[#142E54] shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer order-1 sm:order-2"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24-1.04-.37-2.12-.37-3.229 0-6.075 4.925-11 11-11s11 4.925 11 11c0 1.109-.13 2.189-.37 3.229M3.75 19.5h16.5m-15-4.5h13.5m-13.5 0a3.375 3.375 0 01-3.375-3.375V6.75A3.375 3.375 0 015.625 3.375h12.75a3.375 3.375 0 013.375 3.375v4.875a3.375 3.375 0 01-3.375 3.375" />
                                    </svg>
                                    <span>Print Thermal Z-Read</span>
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Admin Cash Movement Modal (Owner Draw / Safe Drop / Cash In) */}
            <CashMovementModal
                isOpen={showCashMovementModal}
                settings={settings}
                user={auth.user}
                initialActiveShifts={activeShifts}
                initialTerminals={terminals}
                onClose={() => setShowCashMovementModal(false)}
                onMovementRecorded={() => {
                    loadAllShifts(false);
                    router.reload({ only: ['initial_cash_movements'] });
                }}
            />

            {/* Global, read-only Cash Movement History modal (all shifts + general movements) */}
            <CashMovementHistoryModal
                isOpen={showCashMovementHistoryModal}
                onClose={() => setShowCashMovementHistoryModal(false)}
                cashMovements={cashMovements}
            />

        </AuthenticatedLayout>
    );
}