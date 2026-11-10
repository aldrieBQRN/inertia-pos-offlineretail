import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import AuthenticatedLayout from '@/Layouts/AuthenticatedLayout';
import { Head, Link, usePage } from '@inertiajs/react';
import Barcode from '@/Components/Barcode';
import MobileScanner from '@/Components/MobileScanner';
import CategoryManager from '@/Components/CategoryManager';
import Swal from 'sweetalert2';
import { printLabels, downloadLabelImage } from '@/Utils/printLabels';
import { formatQty, formatProductQty, productQtyDecimals, defaultQuantityDecimals, repeatingFactorHint } from '@/Utils/quantity';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

/** A LOG-00011 reference links to that entry in System Activity Logs; other references stay plain text. */
const LogRef = ({ value }) => {
    const match = /^LOG-(\d+)$/.exec(String(value || ''));
    if (!match) return <>{value}</>;
    return (
        <Link
            href={route('activity-logs.index', { log: Number(match[1]) })}
            className="underline decoration-dotted underline-offset-2 hover:text-[#1B3B6A] hover:decoration-solid"
            title="Open in System Activity Logs"
        >
            {value}
        </Link>
    );
};

// ---------------------------------------------------------------------------
// Excel template / export / import layout
// Rows 1-5 hold the store header (name, address, contact, title, spacer),
// row 6 holds the column headers and data starts on row 7. Import locates the
// header row by its contents, so older files (header on row 1, 7 columns) and
// newer files (10 columns + Product Units sheet) both keep working.
// ---------------------------------------------------------------------------
const XLSX_HEADER_ROW = 6;
const XLSX_FIRST_DATA_ROW = 7;
// Grey italic sample rows shipped in the templates; skipped on import.
const TEMPLATE_EXAMPLE_SKUS = new Set(['88010020', 'CEMENT-001', 'WIRE-001']);

const PRODUCT_HEADER_RULES = [
    [/wholesale/, 'wholesale_price'],
    [/cost/, 'cost_price'],
    [/retail|^price$|^srp$/, 'price'],
    [/method/, 'selling_method'],
    [/base unit/, 'base_unit'],
    [/default unit/, 'default_unit'],
    [/stock|qty|quantity/, 'stock_quantity'],
    [/category/, 'category_name'],
    [/sku|barcode/, 'sku'],
    [/name/, 'name'],
];
const PRODUCT_DEFAULT_COLUMNS = {
    sku: 1, name: 2, category_name: 3, price: 4, wholesale_price: 5, cost_price: 6,
    stock_quantity: 7, selling_method: 8, base_unit: 9, default_unit: 10,
};

const UNIT_HEADER_RULES = [
    [/wholesale/, 'wholesale_price'],
    [/retail|^price$/, 'retail_price'],
    [/conversion|factor/, 'conversion_factor'],
    [/default/, 'is_default'],
    [/sort|order/, 'sort_order'],
    [/sku|barcode/, 'sku'],
    [/unit|name/, 'unit_name'],
];
const UNIT_DEFAULT_COLUMNS = {
    sku: 1, unit_name: 2, conversion_factor: 3, retail_price: 4, wholesale_price: 5, is_default: 6, sort_order: 7,
};

const normalizeHeader = (text) => String(text ?? '').toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

const matchHeader = (rules, text) => {
    const h = normalizeHeader(text);
    if (!h) return null;
    const rule = rules.find(([pattern]) => pattern.test(h));
    return rule ? rule[1] : null;
};

/** Plain text of an ExcelJS cell (handles rich text, hyperlinks and formula results). */
const xlsxCellText = (cell) => {
    const v = cell?.value;
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
        if (v.text !== undefined) return String(v.text);
        if (v.result !== undefined && v.result !== null) return String(v.result);
        return '';
    }
    return String(v);
};

/** Numeric value of a cell/raw value, or null when blank / not a number. */
const parseImportNumber = (val) => {
    if (val === null || val === undefined) return null;
    if (typeof val === 'number') return Number.isFinite(val) ? val : null;
    if (typeof val === 'object') {
        if (typeof val.result === 'number') return val.result;
        val = val.text ?? val.result ?? (Array.isArray(val.richText) ? val.richText.map(t => t.text).join('') : '');
    }
    let s = String(val).trim();
    if (!s) return null;
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(/,/g, '.');
    s = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

/**
 * Find the column-header row (first row whose column A looks like SKU/Barcode and
 * whose column B matches `secondColumn`) and build a field -> column map from it.
 * Store-header rows above it are ignored. Falls back to row 1 + default positions.
 */
const locateXlsxHeader = (sheet, secondColumn, rules, defaults) => {
    let headerRow = 1;
    const maxScan = Math.min(sheet.rowCount || 0, 30);
    for (let r = 1; r <= maxScan; r++) {
        const row = sheet.getRow(r);
        const a = normalizeHeader(xlsxCellText(row.getCell(1)));
        const b = normalizeHeader(xlsxCellText(row.getCell(2)));
        // a !== b skips merged store-header rows (every merged cell reports the same text)
        if (a && a !== b && /sku|barcode/.test(a) && secondColumn.test(b)) {
            headerRow = r;
            break;
        }
    }

    const columns = { ...defaults };
    const seen = new Set();
    sheet.getRow(headerRow).eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const field = matchHeader(rules, xlsxCellText(cell));
        if (field && !seen.has(field)) {
            seen.add(field);
            columns[field] = colNumber;
        }
    });
    return { headerRow, columns };
};

/** "N/A" / "NA" / "-" placeholders in export/template cells mean "blank" on import. */
const notApplicableToBlank = (value) => {
    const s = String(value ?? '').trim();
    return /^(n\/?a|-)$/i.test(s) ? '' : s;
};

const isTemplateExampleRow = (row, skuColumn, sku) =>
    !!row.getCell(skuColumn).font?.italic && TEMPLATE_EXAMPLE_SKUS.has(sku);

/** Split one CSV line, honouring double-quoted fields. */
const splitCsvLine = (line) =>
    line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, '').replace(/""/g, '"').trim());

export default function Inventory({ auth, initial_products, initial_categories, initial_recent_activity, initial_stock_histories, initial_settings }) {
    const { auth: pageAuth } = usePage().props;
const currentAuth = auth || pageAuth;
    const user = currentAuth?.user;
    // Standalone POS: the single Admin account can use every inventory action
    const isAdmin = true;
    const [settings] = useState(() => initial_settings || {});
    const [products, setProducts] = useState(() => initial_products || []);
    const [categories, setCategories] = useState(() => initial_categories || []);

    const COMMON_UNITS = [
        'pcs', 'piece', 'pieces', 'set', 'kit',
        'm', 'meter', 'meters', 'cm', 'centimeter', 'mm', 'millimeter',
        'km', 'kilometer',
        'kg', 'kilogram', 'g', 'gram', 'mg', 'milligram',
        'L', 'liter', 'liters', 'ml', 'milliliter',
        'roll', 'rolls', 'pack', 'packs', 'box', 'boxes',
        'bag', 'bags', 'case', 'cases', 'crate', 'crates',
        'sheet', 'sheets', 'pad', 'pads', 'ream', 'reams',
        'dozen', 'gross', 'pair', 'pairs',
        'ft', 'foot', 'feet', 'in', 'inch', 'yd', 'yard',
        'lb', 'pound', 'oz', 'ounce',
        'gal', 'gallon', 'qt', 'quart', 'pt', 'pint', 'cup',
        'tbsp', 'tablespoon', 'tsp', 'teaspoon',
    ];

    // Custom unit suggestion dropdown states
    const [baseUnitSuggestionsOpen, setBaseUnitSuggestionsOpen] = useState(false);
    const [baseUnitHighlightedIndex, setBaseUnitHighlightedIndex] = useState(-1);
    const [unitNameSuggestionsOpen, setUnitNameSuggestionsOpen] = useState({});
    const [unitNameHighlightedIndex, setUnitNameHighlightedIndex] = useState({});

    const [currentPage, setCurrentPage] = useState(1);
    const [viewMode, setViewMode] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('pos_inv_view_mode') || 'table' : 'table'));
    const [itemsPerPage, setItemsPerPage] = useState(() => {
        if (typeof window !== 'undefined') {
            const savedMode = localStorage.getItem('pos_inv_view_mode');
            if (savedMode === 'grid') {
                return window.innerWidth >= 1280 ? 9 : 10;
            }
        }
        return 10;
    });
    const [stockTab, setStockTab] = useState('all'); // 'all', 'in_stock', 'low_stock', 'out_of_stock', 'archived'
    const [sortBy, setSortBy] = useState('newest'); // 'newest', 'created_desc', 'created_asc', 'name_asc', 'name_desc', 'stock_desc', 'stock_asc', 'price_desc', 'price_asc', 'margin_desc'
    const [selectedIds, setSelectedIds] = useState([]);
    const [showDataMenu, setShowDataMenu] = useState(false);

    // Stock Movement History & Global Activity States
    const historyTimelineRef = useRef(null);
    const workspaceSectionRef = useRef(null);
    const historyCacheRef = useRef(initial_stock_histories || {}); // Instant preloaded stock movement ledger per product ID
    const [historyModal, setHistoryModal] = useState({
        isOpen: false,
        product: null,
        loading: false,
        data: null,
        filter: 'all', // 'all', 'sale', 'restock', 'adjustment'
        search: ''
    });

    const [activityDrawer, setActivityDrawer] = useState({
        isOpen: false,
        loading: false,
        logs: initial_recent_activity || [],
        filter: 'all', // 'all', 'restocks', 'created', 'updated'
        search: ''
    });

    const [isExporting, setIsExporting] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showScanner, setShowScanner] = useState(false);
    const [showCategoryManager, setShowCategoryManager] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [loading, setLoading] = useState(() => !Array.isArray(initial_products));
    const [isCheckingSku, setIsCheckingSku] = useState(false);

    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [activeDropdownId, setActiveDropdownId] = useState(null);

    // Product whose selling units are shown in the "View Selling Units" modal (null = closed)
    const [unitsViewProduct, setUnitsViewProduct] = useState(null);
    // "Download Template" type chooser
    const [showTemplateChooser, setShowTemplateChooser] = useState(false);
    // Parsed import file awaiting confirmation (null = preview closed)
    const [importPreview, setImportPreview] = useState(null);
    const [printState, setPrintState] = useState({
        isOpen: false,
        product: null,
        quantity: 1,
        mode: 'thermal' // 'thermal' or 'a4'
    });

    // Lock background page scroll when drawers or modals are open
    useEffect(() => {
        const isModalOpen = activityDrawer.isOpen || historyModal.isOpen || printState.isOpen || showModal || showCategoryManager || showScanner;
        if (typeof document !== 'undefined') {
            if (isModalOpen) {
                document.body.style.overflow = 'hidden';
            } else {
                document.body.style.overflow = 'unset';
            }
        }
        return () => {
            if (typeof document !== 'undefined') {
                document.body.style.overflow = 'unset';
            }
        };
    }, [activityDrawer.isOpen, historyModal.isOpen, printState.isOpen, showModal, showCategoryManager, showScanner]);

    const lastKeyTimeRef = useRef(0);
    const isScanningRef = useRef(false);
    const pipelineTabsRef = useRef(null);

    // Smoothly center the active pipeline filter tab in the visible area
    useEffect(() => {
        if (pipelineTabsRef.current) {
            const activeBtn = pipelineTabsRef.current.querySelector(`[data-tab="${stockTab}"]`);
            if (activeBtn) {
                activeBtn.scrollIntoView({
                    behavior: 'smooth',
                    block: 'nearest',
                    inline: 'center'
                });
            }
        }
    }, [stockTab]);

    // Close Data & Export menu on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (showDataMenu && !e.target.closest('.data-menu-container')) {
                setShowDataMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showDataMenu]);

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    const formatDateTime = (dateStr) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            return d.toLocaleString('en-US', { 
                month: 'short', 
                day: 'numeric', 
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch {
            return dateStr;
        }
    };

    // Helper for resolving full avatar URLs
    const getAvatarUrl = (path) => {
        if (!path) return null;
        if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/storage/')) {
            return path;
        }
        return `/storage/${path}`;
    };

    const isNewProduct = (dateStr) => {
        if (!dateStr) return false;
        try {
            const d = new Date(dateStr);
            const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
            return diffDays <= 7;
        } catch {
            return false;
        }
    };

    const scrollToWorkspace = (tabKey) => {
        // Wait a frame for React to update the filtered list
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

    const handleStockTabChange = (tab) => {
        setStockTab(tab);
        setCurrentPage(1);
        scrollToWorkspace(tab);
    };

    const openStockHistory = async (product, showLoading = true) => {
        const cached = historyCacheRef.current[product.id];
        
        // If we have cached data or can synthesize instant initial registration data, show immediately!
        const initialData = cached || {
            product: product,
            timeline: [
                {
                    id: 'initial-reg-' + product.id,
                    type: 'creation',
                    action: 'created',
                    quantity_change: product.stock_quantity,
                    reference_no: product.sku || ('PRD-' + String(product.id).padStart(5, '0')),
                    invoice_number: product.sku || ('PRD-' + String(product.id).padStart(5, '0')),
                    user_name: 'Store Admin',
                    description: `Initial catalog registration for ${product.name} (SKU: ${product.sku || 'N/A'})`,
                    created_at: product.created_at || new Date().toISOString()
                }
            ],
            stats: {
                total_sold_units: 0,
                total_added_units: product.stock_quantity,
                current_stock: product.stock_quantity,
                total_revenue: 0,
                transaction_count: 0
            }
        };

        setHistoryModal({
            isOpen: true,
            product,
            loading: !cached, // If cached, NO loading skeleton!
            data: initialData,
            filter: 'all',
            search: ''
        });

        try {
            const response = await axios.get(`/api/products/${product.id}/history`);
            historyCacheRef.current[product.id] = response.data; // Cache for next instant open
            setHistoryModal(prev => ({
                ...prev,
                isOpen: true,
                product: response.data.product ? { ...product, ...response.data.product } : product,
                loading: false,
                data: response.data
            }));

            // Scroll container to top smoothly after the new activity ledger row is rendered
            setTimeout(() => {
                if (historyTimelineRef.current) {
                    historyTimelineRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }, 80);
        } catch (e) {
            if (!cached) {
                Swal.fire('Error', 'Failed to load stock movement history.', 'error');
                setHistoryModal(prev => ({ ...prev, loading: false }));
            }
        }
    };

    const exportProductLedgerExcel = async () => {
        const product = historyModal.product;
        const timeline = historyModal.data?.timeline || [];
        if (!product || timeline.length === 0) {
            Swal.fire('Notice', 'No stock movement ledger records available to export.', 'info');
            return;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Stock Movement Ledger', {
                views: [{ showGridLines: true }]
            });

            // Column Widths
            worksheet.getColumn('A').width = 24; // Date & Time
            worksheet.getColumn('B').width = 18; // Movement Type
            worksheet.getColumn('C').width = 16; // Qty Change
            worksheet.getColumn('D').width = 22; // Recorded By / Staff
            worksheet.getColumn('E').width = 20; // Reference / Invoice
            worksheet.getColumn('F').width = 50; // Description

            // Store Header
            const storeName = settings?.store_name || 'POS Store System';
            const storeAddress = settings?.address || '';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

            worksheet.mergeCells('A1:F1');
            worksheet.getCell('A1').value = storeName.toUpperCase();
            worksheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 14 };
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 24;

            worksheet.mergeCells('A2:F2');
            worksheet.getCell('A2').value = storeAddress;
            worksheet.getCell('A2').font = { color: { argb: '555555' }, size: 9 };
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 16;

            worksheet.mergeCells('A3:F3');
            worksheet.getCell('A3').value = storeContact;
            worksheet.getCell('A3').font = { color: { argb: '555555' }, size: 9, italic: true };
            worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(3).height = 16;

            worksheet.mergeCells('A4:F4');
            worksheet.getCell('A4').value = `STOCK MOVEMENT & AUDIT LEDGER — ${product.name.toUpperCase()}`;
            worksheet.getCell('A4').font = { bold: true, color: { argb: '333333' }, size: 10 };
            worksheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(4).height = 18;

            worksheet.mergeCells('A5:F5');
            worksheet.getCell('A5').value = `SKU: ${product.sku || 'N/A'} | Current Stock: ${fmtLedgerQty(historyModal.data?.stats?.current_stock ?? product.stock_quantity)} ${ledgerUnit()} | Generated: ${new Date().toLocaleString()}`;
            worksheet.getCell('A5').font = { color: { argb: '777777' }, size: 9 };
            worksheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(5).height = 16;

            worksheet.getRow(6).height = 10; // Spacing

            // Table Headers (Row 7)
            const headers = ['Date & Time', 'Movement Type', 'Qty Change', 'Staff / User', 'Reference', 'Description'];
            headers.forEach((h, colIndex) => {
                const cell = worksheet.getRow(7).getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: '1B3A69' }
                };
                cell.alignment = { vertical: 'middle', horizontal: colIndex === 2 ? 'center' : (colIndex === 0 || colIndex === 1 ? 'center' : 'left') };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'medium', color: { argb: '0F172A' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            worksheet.getRow(7).height = 25;

            // Rows (Row 8+)
            let totalSold = 0;
            let totalAdded = 0;
            let totalInitial = 0;
            let totalAdjusted = 0;
            const unitLabel = ledgerUnit();

            timeline.forEach((row, idx) => {
                const rowNum = idx + 8;
                const excelRow = worksheet.getRow(rowNum);

                let typeLabel = 'Adjustment';
                let typeColor = 'D97706'; // Amber
                if (row.type === 'sale') {
                    typeLabel = 'POS Sale';
                    typeColor = 'DC2626'; // Rose
                    totalSold += Math.abs(row.quantity_change || 0);
                } else if (row.type === 'restock') {
                    typeLabel = 'Restock';
                    typeColor = '16A34A'; // Emerald
                    totalAdded += Math.abs(row.quantity_change || 0);
                } else if (row.type === 'creation') {
                    typeLabel = 'Initial Catalog';
                    typeColor = '2563EB'; // Blue
                    totalInitial += Math.abs(row.quantity_change || 0);
                } else {
                    totalAdjusted += Number(row.quantity_change || 0); // signed (e.g. lower physical count / void return)
                    if (row.subtype === 'void_return') typeLabel = 'Void Return';
                }

                // Date
                excelRow.getCell('A').value = formatDateTime(row.created_at);
                excelRow.getCell('A').alignment = { vertical: 'middle', horizontal: 'center' };
                excelRow.getCell('A').font = { size: 9 };

                // Type
                excelRow.getCell('B').value = typeLabel;
                excelRow.getCell('B').alignment = { vertical: 'middle', horizontal: 'center' };
                excelRow.getCell('B').font = { bold: true, color: { argb: typeColor }, size: 9 };

                // Qty Change
                const qtyVal = Number(row.quantity_change || 0);
                const sellingUnit = ledgerSellingUnit(row);
                excelRow.getCell('C').value = `${ledgerQtyText(row)}${sellingUnit ? ` (${sellingUnit})` : ''}`;
                excelRow.getCell('C').alignment = { vertical: 'middle', horizontal: 'center' };
                excelRow.getCell('C').font = { bold: true, color: { argb: qtyVal < 0 ? 'DC2626' : (qtyVal > 0 ? '16A34A' : '64748B') }, size: 9 };

                // Staff
                excelRow.getCell('D').value = row.user_name || 'System';
                excelRow.getCell('D').alignment = { vertical: 'middle', horizontal: 'left' };
                excelRow.getCell('D').font = { bold: true, size: 9, color: { argb: '1E293B' } };

                // Ref / Inv
                const refNo = row.reference_no || (row.invoice_number && row.invoice_number !== 'N/A' ? row.invoice_number : (row.type === 'creation' ? (product.sku || `PRD-${product.id}`) : `LOG-${(row.id || '').replace(/\D/g, '')}`));
                excelRow.getCell('E').value = refNo || '—';
                excelRow.getCell('E').alignment = { vertical: 'middle', horizontal: 'left' };
                excelRow.getCell('E').font = { size: 9, color: { argb: '64748B' } };

                // Description
                excelRow.getCell('F').value = row.description || '—';
                excelRow.getCell('F').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                excelRow.getCell('F').font = { size: 9 };

                const isEven = idx % 2 === 0;
                ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
                    const cell = excelRow.getCell(col);
                    if (!isEven) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'F8FAFC' }
                        };
                    }
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'E2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                        right: { style: 'thin', color: { argb: 'E2E8F0' } }
                    };
                });

                excelRow.height = 22;
            });

            // Summary Footer Box
            const summaryStartRow = timeline.length + 9;
            worksheet.getRow(summaryStartRow).height = 10;

            worksheet.mergeCells(`A${summaryStartRow + 1}:F${summaryStartRow + 1}`);
            const summaryTitleCell = worksheet.getCell(`A${summaryStartRow + 1}`);
            summaryTitleCell.value = 'PRODUCT STOCK LEDGER RECONCILIATION SUMMARY';
            summaryTitleCell.font = { bold: true, color: { argb: '1E293B' }, size: 10 };
            summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            summaryTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F1F5F9' } };
            worksheet.getRow(summaryStartRow + 1).height = 20;

            const summaryRow = worksheet.getRow(summaryStartRow + 2);
            summaryRow.getCell('A').value = `Total Recorded: ${timeline.length}`;
            summaryRow.getCell('B').value = `Total Sold: -${fmtLedgerQty(totalSold)} ${unitLabel}`;
            summaryRow.getCell('C').value = `Total Restocked: +${fmtLedgerQty(totalAdded)} (Initial: +${fmtLedgerQty(totalInitial)})${totalAdjusted ? ` | Adjusted: ${totalAdjusted > 0 ? '+' : ''}${fmtLedgerQty(totalAdjusted)}` : ''}`;
            summaryRow.getCell('D').value = `Current Stock: ${fmtLedgerQty(historyModal.data?.stats?.current_stock ?? product.stock_quantity)} ${unitLabel}`;
            summaryRow.getCell('E').value = `Total Revenue: ${formatCurrency(historyModal.data?.stats?.total_revenue || 0)}`;
            const netFlow = totalInitial + totalAdded + totalAdjusted - totalSold;
            summaryRow.getCell('F').value = `Net Flow: ${netFlow > 0 ? '+' : ''}${fmtLedgerQty(netFlow)} ${unitLabel}`;

            ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
                const cell = summaryRow.getCell(col);
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
            summaryRow.height = 22;

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const safeProdName = (product.name || 'Product').replace(/[^a-zA-Z0-9_-]/g, '_');
            const dateStr = new Date().toISOString().split('T')[0];
            saveAs(blob, `${safeProdName}_Stock_Ledger_${dateStr}.xlsx`);
            auditExport({ type: 'stock_ledger_excel', count: timeline.length, product_id: product.id, file_name: `${safeProdName}_Stock_Ledger_${dateStr}.xlsx` });

            Swal.fire({
                icon: 'success',
                title: 'Ledger Exported!',
                text: 'Product stock ledger downloaded as Excel.',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500
            });
        } catch (error) {
            console.error("Product Ledger Excel Export Error:", error);
            Swal.fire('Error', 'Failed to generate product stock ledger Excel.', 'error');
        }
    };

    // Single source of truth for Activity Feed classification (tab counts, tab filters, badges, export).
    // Audit logs use action "create" (ActivityService::logCreate); catalog registration entries use "created".
    const getActivityType = (log) => {
        const action = (log.action || '').toLowerCase();
        const desc = (log.description || '').toLowerCase();
        const model = (log.model_type || '').toLowerCase();
        if (model === 'category') return 'category';
        if (['import', 'import_failed', 'export'].includes(action)) return 'file';
        if (action.includes('sale') || desc.includes('sold')) return 'sale';
        if (action.includes('restock') || desc.includes('restock') || action.includes('stock')) return 'stock';
        if (desc.includes('registered new') || ((action === 'create' || action === 'created') && model === 'product')) return 'create';
        return 'update';
    };

    const formatRelativeTime = (dateStr) => {
        if (!dateStr) return 'N/A';
        try {
            const d = new Date(dateStr);
            const now = new Date();
            const diffMs = now - d;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffDays = Math.floor(diffHours / 24);

            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays === 1) return 'Yesterday';
            if (diffDays < 7) return `${diffDays}d ago`;
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch {
            return dateStr;
        }
    };

    const loadRecentActivity = async (showLoading = false) => {
        if (showLoading && (!activityDrawer.logs || activityDrawer.logs.length === 0)) {
            setActivityDrawer(prev => ({ ...prev, loading: true }));
        }
        try {
            const response = await axios.get('/api/inventory/recent-activity');
            setActivityDrawer(prev => ({
                ...prev,
                loading: false,
                logs: response.data.data || []
            }));
        } catch (e) {
            if (showLoading && (!activityDrawer.logs || activityDrawer.logs.length === 0)) {
                Swal.fire('Error', 'Failed to load inventory activity logs.', 'error');
            }
            setActivityDrawer(prev => ({ ...prev, loading: false }));
        }
    };

    const openRecentActivity = () => {
        const hasExistingLogs = Boolean(activityDrawer.logs && activityDrawer.logs.length > 0);
        setActivityDrawer(prev => ({
            ...prev,
            isOpen: true,
            loading: !hasExistingLogs
        }));
        loadRecentActivity(!hasExistingLogs);
    };

    // Background auto-refresh for activity feed while modal is open (silent poll every 5s)
    useEffect(() => {
        if (!activityDrawer.isOpen) return;

        const interval = setInterval(() => {
            loadRecentActivity(false);
        }, 5000);

        return () => clearInterval(interval);
    }, [activityDrawer.isOpen]);

    const exportActivityExcel = async () => {
        const logs = activityDrawer.logs || [];
        if (logs.length === 0) {
            Swal.fire('Notice', 'No activity logs available to export.', 'info');
            return;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const worksheet = workbook.addWorksheet('Activity Audit Log', {
                views: [{ showGridLines: true }]
            });

            // Set column widths
            worksheet.getColumn('A').width = 24; // Date & Time
            worksheet.getColumn('B').width = 18; // Movement Type
            worksheet.getColumn('C').width = 22; // Staff / Performed By
            worksheet.getColumn('D').width = 52; // Description & Movement Details
            worksheet.getColumn('E').width = 20; // Reference / Invoice

            // Store Header (Rows 1 to 4)
            const storeName = settings?.store_name || 'POS Store System';
            const storeAddress = settings?.address || '';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

            // 1. Store Name
            worksheet.mergeCells('A1:E1');
            worksheet.getCell('A1').value = storeName.toUpperCase();
            worksheet.getCell('A1').font = { bold: true, color: { argb: '1B3A69' }, size: 14 };
            worksheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(1).height = 24;

            // 2. Address
            worksheet.mergeCells('A2:E2');
            worksheet.getCell('A2').value = storeAddress;
            worksheet.getCell('A2').font = { color: { argb: '555555' }, size: 9 };
            worksheet.getCell('A2').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(2).height = 16;

            // 3. Contact
            worksheet.mergeCells('A3:E3');
            worksheet.getCell('A3').value = storeContact;
            worksheet.getCell('A3').font = { color: { argb: '555555' }, size: 9, italic: true };
            worksheet.getCell('A3').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(3).height = 16;

            // 4. Report Title
            worksheet.mergeCells('A4:E4');
            worksheet.getCell('A4').value = 'STORE INVENTORY ACTIVITY & AUDIT TRAIL REPORT';
            worksheet.getCell('A4').font = { bold: true, color: { argb: '333333' }, size: 10 };
            worksheet.getCell('A4').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(4).height = 18;

            // 5. Metadata Sub-info
            worksheet.mergeCells('A5:E5');
            worksheet.getCell('A5').value = `Generated: ${new Date().toLocaleString()} | Total Recorded Movements: ${logs.length}`;
            worksheet.getCell('A5').font = { color: { argb: '777777' }, size: 9 };
            worksheet.getCell('A5').alignment = { vertical: 'middle', horizontal: 'center' };
            worksheet.getRow(5).height = 16;

            // Empty spacing row
            worksheet.getRow(6).height = 10;

            // 6. Header Row (Row 7)
            const headers = ['Date & Time', 'Movement Type', 'Staff / User', 'Description & Movement Details', 'Reference'];
            headers.forEach((h, colIndex) => {
                const cell = worksheet.getRow(7).getCell(colIndex + 1);
                cell.value = h;
                cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: '1B3A69' }
                };
                cell.alignment = { vertical: 'middle', horizontal: colIndex === 0 || colIndex === 1 ? 'center' : 'left' };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'medium', color: { argb: '0F172A' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            worksheet.getRow(7).height = 25;

            // 7. Add Data Rows (Row 8+)
            let salesCount = 0;
            let restockCount = 0;
            let createCount = 0;

            logs.forEach((log, idx) => {
                const rowNum = idx + 8;
                const row = worksheet.getRow(rowNum);

                const activityType = getActivityType(log);
                let typeLabel = 'Adjustment';
                let typeColor = 'D97706'; // Amber

                if (activityType === 'sale') {
                    typeLabel = 'POS Sale';
                    typeColor = 'DC2626'; // Rose
                    salesCount++;
                } else if (activityType === 'stock') {
                    typeLabel = log.action === 'stock_void_return' ? 'Void Return' : 'Restock';
                    typeColor = '16A34A'; // Green
                    restockCount++;
                } else if (activityType === 'create') {
                    typeLabel = 'New Product';
                    typeColor = '2563EB'; // Blue
                    createCount++;
                } else if (activityType === 'category') {
                    typeLabel = 'Category';
                    typeColor = '7C3AED'; // Violet
                } else if (activityType === 'file') {
                    typeLabel = log.action === 'export' ? 'Export' : (log.action === 'import_failed' ? 'Import Rejected' : 'Import');
                    typeColor = '0369A1'; // Sky
                }

                // Col A: Date & Time
                row.getCell('A').value = formatDateTime(log.created_at);
                row.getCell('A').alignment = { vertical: 'middle', horizontal: 'center' };
                row.getCell('A').font = { size: 9 };

                // Col B: Movement Type
                row.getCell('B').value = typeLabel;
                row.getCell('B').alignment = { vertical: 'middle', horizontal: 'center' };
                row.getCell('B').font = { bold: true, color: { argb: typeColor }, size: 9 };

                // Col C: Staff
                row.getCell('C').value = log.user_name || 'System';
                row.getCell('C').alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell('C').font = { bold: true, size: 9, color: { argb: '1E293B' } };

                // Col D: Description
                row.getCell('D').value = log.description || '—';
                row.getCell('D').alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                row.getCell('D').font = { size: 9 };

                // Col E: Reference (Full resolution for all movement types)
                let refVal = log.reference_no;
                if (!refVal) {
                    if (log.invoice_number) {
                        refVal = log.invoice_number;
                    } else if (log.sku) {
                        refVal = `SKU: ${log.sku}`;
                    } else if (log.description && log.description.includes('SKU:')) {
                        const match = log.description.match(/SKU:\s*([^)\s]+)/i);
                        if (match) refVal = `SKU: ${match[1]}`;
                    } else if (log.description && log.description.includes('Inv:')) {
                        const match = log.description.match(/Inv:\s*([A-Za-z0-9-]+)/i);
                        if (match) refVal = match[1];
                    } else if (log.model_type && log.model_id) {
                        refVal = `${log.model_type} #${log.model_id}`;
                    } else if (log.id) {
                        refVal = String(log.id).toUpperCase();
                    } else {
                        refVal = '—';
                    }
                }
                row.getCell('E').value = refVal;
                row.getCell('E').alignment = { vertical: 'middle', horizontal: 'left' };
                row.getCell('E').font = { size: 9, color: { argb: '475569' }, bold: true };

                // Zebra row fill & borders
                const isEven = idx % 2 === 0;
                ['A', 'B', 'C', 'D', 'E'].forEach(col => {
                    const cell = row.getCell(col);
                    if (!isEven) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'F8FAFC' }
                        };
                    }
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'E2E8F0' } },
                        left: { style: 'thin', color: { argb: 'E2E8F0' } },
                        bottom: { style: 'thin', color: { argb: 'E2E8F0' } },
                        right: { style: 'thin', color: { argb: 'E2E8F0' } }
                    };
                });

                row.height = 22;
            });

            // 8. Summary Footer Box
            const summaryStartRow = logs.length + 9;
            worksheet.getRow(summaryStartRow).height = 10; // Spacing

            worksheet.mergeCells(`A${summaryStartRow + 1}:E${summaryStartRow + 1}`);
            const summaryTitleCell = worksheet.getCell(`A${summaryStartRow + 1}`);
            summaryTitleCell.value = 'AUDIT SUMMARY BREAKDOWN';
            summaryTitleCell.font = { bold: true, color: { argb: '1E293B' }, size: 10 };
            summaryTitleCell.alignment = { vertical: 'middle', horizontal: 'center' };
            summaryTitleCell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'F1F5F9' }
            };
            worksheet.getRow(summaryStartRow + 1).height = 20;

            const summaryRow = worksheet.getRow(summaryStartRow + 2);
            summaryRow.getCell('A').value = `Total Events: ${logs.length}`;
            summaryRow.getCell('B').value = `POS Sales: ${salesCount}`;
            summaryRow.getCell('C').value = `Restocks: ${restockCount}`;
            summaryRow.getCell('D').value = `New Products: ${createCount}`;
            summaryRow.getCell('E').value = `Other Adjustments: ${logs.length - salesCount - restockCount - createCount}`;

            ['A', 'B', 'C', 'D', 'E'].forEach(col => {
                const cell = summaryRow.getCell(col);
                cell.font = { bold: true, size: 9, color: { argb: '334155' } };
                cell.alignment = { vertical: 'middle', horizontal: 'center' };
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'F8FAFC' }
                };
                cell.border = {
                    top: { style: 'thin', color: { argb: 'CBD5E1' } },
                    bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
                    left: { style: 'thin', color: { argb: 'CBD5E1' } },
                    right: { style: 'thin', color: { argb: 'CBD5E1' } }
                };
            });
            summaryRow.height = 22;

            // Generate buffer & trigger download
            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const safeStorePrefix = (settings?.store_name || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            const dateStr = new Date().toISOString().split('T')[0];
            saveAs(blob, `${safeStorePrefix}_Inventory_Activity_${dateStr}.xlsx`);
            auditExport({ type: 'activity_excel', count: logs.length, file_name: `${safeStorePrefix}_Inventory_Activity_${dateStr}.xlsx` });

            Swal.fire({
                icon: 'success',
                title: 'Excel Exported!',
                text: 'Professional audit log downloaded.',
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2500
            });

        } catch (error) {
            console.error("Activity Excel Export Error:", error);
            Swal.fire('Error', 'Failed to generate Excel audit report.', 'error');
        }
    };

    useEffect(() => {
        if (!showModal) return;

        const handleGlobalKeyDown = (e) => {
            const now = Date.now();
            const timeDiff = now - lastKeyTimeRef.current;
            lastKeyTimeRef.current = now;

            // Detect if sequence is typed extremely fast (< 45ms key-to-key)
            if (timeDiff < 45) {
                isScanningRef.current = true;
            }

            // If we are currently in scanning mode (scanner is typing the barcode)
            if (isScanningRef.current) {
                // If the user's cursor is NOT inside the SKU / Barcode input field
                if (document.activeElement && document.activeElement.name !== 'sku') {
                    // Stop character from being input
                    e.preventDefault();

                    // Clean the first character which typed before the speed threshold triggered
                    const activeEl = document.activeElement;
                    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                        if (timeDiff < 45 && !activeEl.dataset.scanCleaned) {
                            activeEl.value = activeEl.value.slice(0, -1);
                            const event = new Event('input', { bubbles: true });
                            activeEl.dispatchEvent(event);
                            activeEl.dataset.scanCleaned = 'true';
                        }
                    }
                }
            }

            // Reset scanner state when key interval is slow (> 100ms)
            if (timeDiff >= 100) {
                isScanningRef.current = false;
                if (document.activeElement) {
                    delete document.activeElement.dataset.scanCleaned;
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleGlobalKeyDown, true);
        };
    }, [showModal]);

    const emptyUnitRow = (isDefault = false) => ({
        name: '',
        conversion_factor: '',
        price: '',
        wholesale_price: '',
        is_default: isDefault,
    });

    const [formData, setFormData] = useState({
        name: '', category_id: '', price: '', cost_price: '', wholesale_price: '', stock_quantity: '', sku: '', image: null,
        selling_method: 'standard', base_unit: '', quantity_decimals: '', units: [],
    });

    // Stock movement ledger quantities are in the product's base unit (Multiple UOM) or plain units
    const ledgerUnit = () => {
        const p = historyModal.data?.product || historyModal.product;
        return p?.selling_method === 'multiple' && p?.base_unit ? p.base_unit : 'units';
    };
    const fmtLedgerQty = (n) => formatQty(n, productQtyDecimals(historyModal.data?.product || historyModal.product));
    const ledgerQtyText = (row) => {
        const q = Number(row.quantity_change || 0);
        return `${q > 0 ? '+' : ''}${fmtLedgerQty(q)} ${ledgerUnit()}`;
    };
    /** "1 Roll" for sales rung up in a selling unit other than the base unit. */
    const ledgerSellingUnit = (row) => (
        row.type === 'sale' && row.unit_name && row.base_quantity !== undefined
        && (Number(row.quantity) !== Number(row.base_quantity) || row.unit_name !== ledgerUnit())
    ) ? `${fmtLedgerQty(row.quantity)} ${row.unit_name}` : null;

    /** Record an export in the audit trail (fire-and-forget; never blocks the download). */
    const auditExport = (payload) => {
        axios.post('/api/inventory/export-log', payload).catch(() => {});
    };

    const formatCurrency = (cents) => {
        return ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    /** Multiple-UOM products are priced by their default selling unit (falls back to the first unit). */
    const productDefaultUnit = (product) => {
        if (product?.selling_method !== 'multiple' || !product.units?.length) return null;
        return product.units.find(u => u.is_default) || product.units[0];
    };

    const productRetailPrice = (product) => {
        const unit = productDefaultUnit(product);
        if (unit) return Number(unit.price) || 0;
        return product?.selling_method === 'multiple' ? 0 : (product?.price || 0);
    };

    const productWholesalePrice = (product) => {
        const unit = productDefaultUnit(product);
        if (unit) return Number(unit.wholesale_price) || 0;
        return product?.selling_method === 'multiple' ? 0 : (product?.wholesale_price || 0);
    };

    /** " / Roll" suffix for multiple-UOM prices so it is clear which unit the price is for. */
    const productPriceUnitSuffix = (product) => {
        const unit = productDefaultUnit(product);
        return unit ? ` / ${unit.name}` : '';
    };

    const productUnitLabel = (product) => {
        if (product?.selling_method === 'multiple') {
            return product.base_unit || 'base unit';
        }
        return '';
    };

    // Sync preloaded server-side props on navigation
    useEffect(() => {
        if (Array.isArray(initial_products)) {
            setProducts(initial_products);
            setLoading(false);
        }
    }, [initial_products]);

    useEffect(() => {
        if (Array.isArray(initial_categories)) {
            setCategories(initial_categories);
        }
    }, [initial_categories]);

    useEffect(() => {
        if (initial_stock_histories) {
            historyCacheRef.current = initial_stock_histories;
        }
    }, [initial_stock_histories]);

    useEffect(() => {
        if (Array.isArray(initial_recent_activity)) {
            setActivityDrawer((prev) => ({ ...prev, logs: initial_recent_activity }));
        }
    }, [initial_recent_activity]);

    useEffect(() => {
        const hasInitialData = Array.isArray(initial_products);
        if (!hasInitialData) {
            loadCategories();
            loadAllProducts(true);
        }

        const interval = setInterval(() => {
            loadAllProducts(false);
        }, 6000);

        const handleOutsideClick = (e) => {
            if (!e.target.closest('.action-dropdown-container')) {
                setActiveDropdownId(null);
            }
            if (!e.target.closest('.data-menu-container')) {
                setShowDataMenu(false);
            }
        };
        window.addEventListener('click', handleOutsideClick);

        return () => {
            clearInterval(interval);
            window.removeEventListener('click', handleOutsideClick);
        };
    }, []);

    useEffect(() => {
        setActiveDropdownId(null);
    }, [currentPage]);

    useEffect(() => {
        setCurrentPage(1);
        setActiveDropdownId(null);
        setSelectedIds([]);
    }, [searchTerm, filterCategory, stockTab, sortBy]);

    const loadAllProducts = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            const response = await axios.get('/api/products', { params: { all: true } });
            const data = Array.isArray(response.data) ? response.data : (response.data.data || []);
            setProducts(data);
        } catch (error) {
            console.error("Critical error loading inventory:", error);
        } finally {
            if (showLoading) setLoading(false);
        }
    };

    const loadCategories = async () => {
        try {
            const response = await axios.get('/api/categories');
            setCategories(response.data);
        } catch (e) {
            console.error("Category load failed:", e);
        }
    };

    const handleCategoryUpdate = () => {
        loadCategories();
        loadAllProducts(false);
    };

    // Real-time Executive Inventory Analytics
    const stats = useMemo(() => {
        let totalStockUnits = 0;
        let totalInventoryCost = 0;
        let totalRetailValue = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;
        let healthyStockCount = 0;
        let activeCount = 0;
        let archivedCount = 0;

        products.forEach(p => {
            const qty = Number(p.stock_quantity) || 0;
            const cost = Number(p.cost_price) || 0;
            const price = Number(p.price) || 0;

            if (p.is_active) {
                activeCount++;
                totalStockUnits += qty;
                totalInventoryCost += (cost * qty);
                totalRetailValue += (price * qty);

                if (qty <= 0) {
                    outOfStockCount++;
                } else if (qty <= 10) {
                    lowStockCount++;
                } else {
                    healthyStockCount++;
                }
            } else {
                archivedCount++;
            }
        });

        const estimatedGrossMargin = totalRetailValue > 0 
            ? (((totalRetailValue - totalInventoryCost) / totalRetailValue) * 100).toFixed(1)
            : '0.0';

        return {
            totalProducts: products.length,
            activeCount,
            archivedCount,
            totalStockUnits,
            totalInventoryCost,
            totalRetailValue,
            lowStockCount,
            outOfStockCount,
            healthyStockCount,
            estimatedGrossMargin
        };
    }, [products]);

    // Enhanced Multi-Criteria Filtering & Sorting
    const filteredProducts = useMemo(() => {
        const searchLower = searchTerm.toLowerCase().trim();
        let result = products.filter(p => {
            const matchesSearch = !searchLower || 
                (p.name && p.name.toLowerCase().includes(searchLower)) ||
                (p.sku && p.sku.toLowerCase().includes(searchLower));

            const matchesCategory = filterCategory ? p.category_id?.toString() === filterCategory.toString() : true;

            let matchesTab = true;
            const qty = Number(p.stock_quantity) || 0;

            if (stockTab === 'in_stock') {
                matchesTab = Boolean(p.is_active) && qty > 10;
            } else if (stockTab === 'low_stock') {
                matchesTab = Boolean(p.is_active) && qty > 0 && qty <= 10;
            } else if (stockTab === 'out_of_stock') {
                matchesTab = Boolean(p.is_active) && qty <= 0;
            } else if (stockTab === 'archived') {
                matchesTab = !p.is_active;
            } else { // 'all'
                matchesTab = true;
            }

            return matchesSearch && matchesCategory && matchesTab;
        });

        result.sort((a, b) => {
            if (sortBy === 'created_desc') return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            if (sortBy === 'created_asc') return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            if (sortBy === 'name_asc') return (a.name || '').localeCompare(b.name || '');
            if (sortBy === 'name_desc') return (b.name || '').localeCompare(a.name || '');
            if (sortBy === 'stock_desc') return (Number(b.stock_quantity) || 0) - (Number(a.stock_quantity) || 0);
            if (sortBy === 'stock_asc') return (Number(a.stock_quantity) || 0) - (Number(b.stock_quantity) || 0);
            if (sortBy === 'price_desc') return (Number(b.price) || 0) - (Number(a.price) || 0);
            if (sortBy === 'price_asc') return (Number(a.price) || 0) - (Number(b.price) || 0);
            if (sortBy === 'margin_desc') {
                const marginA = a.price ? ((a.price - (a.cost_price || 0)) / a.price) : 0;
                const marginB = b.price ? ((b.price - (b.cost_price || 0)) / b.price) : 0;
                return marginB - marginA;
            }
            return (b.id || 0) - (a.id || 0);
        });

        return result;
    }, [products, searchTerm, filterCategory, stockTab, sortBy]);

    const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
    const paginatedProducts = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    // Handle View Mode toggle (9 cards for 3-column grid, 10 cards for 2-column grid, 10 items for list)
    const handleViewModeChange = (mode) => {
        setViewMode(mode);
        if (typeof window !== 'undefined') {
            localStorage.setItem('pos_inv_view_mode', mode);
        }
        setCurrentPage(1);
        if (mode === 'grid') {
            const balancedCount = typeof window !== 'undefined' && window.innerWidth >= 1280 ? 9 : 10;
            setItemsPerPage(balancedCount);
        } else {
            setItemsPerPage(10);
        }
    };

    // Dynamically balance cards per page on screen resize (9 cards for 3-column xl+, 10 cards for 2-column)
    useEffect(() => {
        if (viewMode !== 'grid') return;

        const handleResize = () => {
            const balancedCount = window.innerWidth >= 1280 ? 9 : 10;
            setItemsPerPage((prev) => (prev !== balancedCount ? balancedCount : prev));
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [viewMode]);

    // Reset Pagination when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, filterCategory, stockTab, sortBy]);

    // Bulk Action Handlers
    const handleToggleSelect = (id) => {
        setSelectedIds(prev => 
            prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        const paginatedIds = paginatedProducts.map(p => p.id);
        const allSelected = paginatedIds.every(id => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds(prev => prev.filter(id => !paginatedIds.includes(id)));
        } else {
            setSelectedIds(prev => Array.from(new Set([...prev, ...paginatedIds])));
        }
    };

    const handleBulkArchive = async () => {
        if (!selectedIds.length) return;
        const result = await Swal.fire({
            title: `Archive/Restore ${selectedIds.length} Products?`,
            text: 'This will toggle the active visibility status for all selected items.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#1B3B6A',
            confirmButtonText: 'Yes, Proceed'
        });

        if (result.isConfirmed) {
            try {
                for (const id of selectedIds) {
                    await axios.patch(`/api/products/${id}/toggle-active`);
                }
                Swal.fire('Updated!', 'Selected products updated.', 'success');
                setSelectedIds([]);
                loadAllProducts(false);
            } catch (e) {
                Swal.fire('Error', 'Failed to update some products.', 'error');
            }
        }
    };

    const handleQuickAdd = async (product) => {
        const isMultiple = product.selling_method === 'multiple' || !!product.is_multi_unit;
        const units = product.units || [];
        const baseUnit = product.base_unit || 'unit';
        const costPriceText = product.cost_price ? `${formatCurrency(product.cost_price)} / ${baseUnit}` : '—';

        const unitOptions = isMultiple
            ? [
                `<option value="">${baseUnit} (base unit)</option>`,
                ...units.map((unit) => `<option value="${unit.id}">${unit.name}</option>`),
            ].join('')
            : '';

        const { value: payload } = await Swal.fire({
            title: `Restock: ${product.name}`,
            html: `
                <div class="text-left bg-gray-50 p-4 rounded-lg border border-gray-200 mb-2">
                    <div class="flex justify-between text-sm py-1.5">
                        <span class="text-gray-500 font-bold">Cost Price:</span>
                        <span class="text-gray-900 font-black">${costPriceText}</span>
                    </div>
                    <div class="flex justify-between text-sm py-1.5 border-t border-dashed border-gray-200 mt-1">
                        <span class="text-gray-500 font-bold">Current Stock:</span>
                        <span class="text-gray-900 font-black">${product.stock_quantity} ${baseUnit}</span>
                    </div>
                    ${isMultiple ? `
                    <div class="mt-3 text-left">
                        <label class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Receive as</label>
                        <select id="swal-restock-unit" class="swal2-select w-full mt-1" style="display:flex;margin:0;width:100%;max-width:100%;">
                            ${unitOptions}
                        </select>
                    </div>` : ''}
                    <div class="mt-3 text-left">
                        <label class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Quantity to add</label>
                        <input id="swal-restock-qty" type="number" step="0.00000001" min="0.00000001" class="swal2-input w-full mt-1" style="display:flex;margin:0;width:100%;max-width:100%;" placeholder="Enter amount..." />
                    </div>
                    <div class="flex justify-between text-sm py-1.5 border-t border-dashed border-gray-200 mt-3">
                        <span class="text-indigo-600 font-bold">Total Restock Cost:</span>
                        <span class="text-indigo-600 font-black text-base" id="swal-total-cost">0.00</span>
                    </div>
                    ${isMultiple ? `
                    <div class="flex justify-between text-sm py-1.5 border-t border-dashed border-gray-200 mt-1">
                        <span class="text-slate-500 font-bold">Equivalent Base Quantity:</span>
                        <span class="text-slate-900 font-black text-base" id="swal-base-qty">0 ${baseUnit}</span>
                    </div>` : ''}
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Update Stock',
            confirmButtonColor: '#3085d6',
            focusConfirm: false,
            preConfirm: () => {
                const quantityInput = document.getElementById('swal-restock-qty');
                const unitSelect = document.getElementById('swal-restock-unit');
                const quantity = parseFloat(quantityInput?.value || '0');

                if (!quantity || quantity <= 0) {
                    Swal.showValidationMessage('Please enter a valid positive quantity.');
                    return false;
                }

                return { quantity, unit_id: unitSelect?.value || null };
            },
            didOpen: () => {
                const quantityInput = document.getElementById('swal-restock-qty');
                const unitSelect = document.getElementById('swal-restock-unit');
                const totalCostEl = document.getElementById('swal-total-cost');

                const getFactor = () => {
                    if (!isMultiple || !unitSelect?.value) return 1;
                    const selectedUnit = units.find((unit) => String(unit.id) === String(unitSelect.value));
                    return selectedUnit ? Number(selectedUnit.conversion_factor) || 1 : 1;
                };

                const updateTotal = () => {
                    const qty = parseFloat(quantityInput?.value || '0') || 0;
                    const factor = getFactor();
                    const costPrice = product.cost_price ? product.cost_price / 100 : 0;
                    const totalCost = qty * factor * costPrice;
                    if (totalCostEl) {
                        totalCostEl.textContent = totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    }
                    const baseQtyEl = document.getElementById('swal-base-qty');
                    if (baseQtyEl) {
                        baseQtyEl.textContent = `${(qty * factor).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })} ${baseUnit}`;
                    }
                };

                quantityInput?.addEventListener('input', updateTotal);
                unitSelect?.addEventListener('change', updateTotal);
            }
        });

        if (payload?.quantity) {
            try {
                const requestBody = { quantity: payload.quantity };
                if (payload.unit_id) requestBody.unit_id = payload.unit_id;

                await axios.post(`/api/products/${product.id}/stock`, requestBody);
                Swal.fire({ icon: 'success', title: 'Stock Updated', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });

                const factor = payload.unit_id
                    ? Number(units.find((unit) => String(unit.id) === String(payload.unit_id))?.conversion_factor) || 1
                    : 1;
                const baseAdded = payload.quantity * factor;

                setProducts(prevProducts =>
                    prevProducts.map(p => p.id === product.id ? { ...p, stock_quantity: Number(p.stock_quantity) + baseAdded } : p)
                );

                if (historyModal.isOpen && String(historyModal.product?.id) === String(product.id)) {
                    await openStockHistory(product, false);
                }
            } catch (error) {
                Swal.fire('Error', error?.response?.data?.error || 'Failed to update stock levels.', 'error');
            }
        }
    };

    const executePrint = () => {
        const { product, quantity, mode } = printState;
        printLabels(product, settings?.store_name || 'POS STORE', quantity, mode);
        setPrintState({ ...printState, isOpen: false });
    };

    const exportPDF = async () => {
        setIsExporting(true);

        try {
            const exportData = filteredProducts;

            if (!exportData || exportData.length === 0) {
                Swal.fire('No Data', 'No records found to export.', 'info');
                setIsExporting(false);
                return;
            }

            const doc = new jsPDF('landscape');
            const pageWidth = doc.internal.pageSize.width;

            const storeName = settings?.store_name || 'POS Store System';
            const storeAddress = settings?.address || '';
            const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

            let currentY = 20;

            doc.setFontSize(22);
            doc.setTextColor(31, 41, 55);
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
            doc.text('Inventory Status Report', 14, currentY);

            currentY += 6;
            doc.setFontSize(10);
            doc.setTextColor(107, 114, 128);
            doc.setFont(undefined, 'normal');

            let filterParts = [];
            if (searchTerm) filterParts.push(`Search: "${searchTerm}"`);
            if (filterCategory) {
                const catName = categories.find(c => c.id.toString() === filterCategory.toString())?.name || 'Filtered Category';
                filterParts.push(`Category: ${catName}`);
            }
            if (stockTab === 'low_stock') filterParts.push('Low Stock Only');
            if (stockTab === 'out_of_stock') filterParts.push('Out of Stock Only');
            if (stockTab === 'in_stock') filterParts.push('In Stock Only');

            const filterText = filterParts.length > 0 ? `Filters: ${filterParts.join(' | ')}` : 'Filter: All Inventory Items';
            doc.text(filterText, 14, currentY);

            const generatedText = `Generated: ${new Date().toLocaleString()}`;
            const textWidth = doc.getTextWidth(generatedText);
            doc.text(generatedText, pageWidth - 14 - textWidth, currentY);

            const tableStartY = currentY + 8;
            const tableColumns = ["SKU / Barcode", "Product Name", "Category", "Cost Price", "Wholesale Price", "Retail Price", "Stock", "Status"];
            const tableRows = [];
            let totalRetailValue = 0;
            let totalWholesaleValue = 0;
            let totalCostValue = 0;
            let totalItemsCount = 0;
            let multiUomCount = 0;
            let lowStockCount = 0;

            const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const qtyText = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
            const ROW_FILLS = [[255, 255, 255], [245, 247, 250]];
            const UNIT_ROW_FILL = [238, 242, 255];

            exportData.forEach((p, idx) => {
                const qty = Number(p.stock_quantity) || 0;
                const isLow = qty <= 10;
                if (isLow) lowStockCount++;
                const status = isLow ? 'Low Stock' : 'In Stock';
                const cost = (p.cost_price || 0) / 100; // per base unit for Multiple UOM
                const fill = ROW_FILLS[idx % 2];
                const cell = (content, extra = {}) => ({ content, styles: { fillColor: fill, ...extra } });

                totalCostValue += cost * qty;

                const isMulti = p.selling_method === 'multiple' || p.is_multi_unit;
                if (!isMulti) {
                    const wholesale = (p.wholesale_price || 0) / 100;
                    const retail = (p.price || 0) / 100;
                    totalWholesaleValue += wholesale * qty;
                    totalRetailValue += retail * qty;
                    totalItemsCount += qty;

                    tableRows.push([
                        cell(p.sku || 'N/A'),
                        cell(p.name || 'Unknown Product'),
                        cell(p.category?.name || 'Uncategorized'),
                        cell(money(cost)),
                        cell(money(wholesale)),
                        cell(money(retail)),
                        cell(qtyText(qty)),
                        cell(status),
                    ]);
                    return;
                }

                // Multiple UOM: prices shown for the default selling unit, stock & cost in base units
                multiUomCount++;
                const baseUnit = p.base_unit || 'unit';
                const units = [...(p.units || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                const def = units.find(u => u.is_default) || units[0] || null;
                const defFactor = Number(def?.conversion_factor) || 0;
                const defRetail = (def?.price || 0) / 100;
                const defWholesale = (def?.wholesale_price || 0) / 100;

                // Valuation per base unit = default unit price / its conversion factor
                if (defFactor > 0) {
                    totalRetailValue += (defRetail / defFactor) * qty;
                    totalWholesaleValue += (defWholesale / defFactor) * qty;
                }

                tableRows.push([
                    cell(p.sku || 'N/A'),
                    cell(p.name || 'Unknown Product'),
                    cell(p.category?.name || 'Uncategorized'),
                    cell(`${money(cost)} / ${baseUnit}`),
                    cell(def ? `${money(defWholesale)} / ${def.name}` : 'N/A'),
                    cell(def ? `${money(defRetail)} / ${def.name}` : 'N/A'),
                    cell(`${formatProductQty(p, qty)} ${baseUnit}`),
                    cell(status),
                ]);

                const unitsText = units.length
                    ? units.map(u =>
                        `${u.name}${u.is_default ? ' (default)' : ''} = ${qtyText(u.conversion_factor)} ${baseUnit}: ` +
                        `Retail ${money((u.price || 0) / 100)}, WS ${money((u.wholesale_price || 0) / 100)}`
                    ).join('   |   ')
                    : 'No selling units configured';

                tableRows.push([
                    { content: '' , styles: { fillColor: UNIT_ROW_FILL } },
                    {
                        content: `Selling units: ${unitsText}`,
                        colSpan: 7,
                        styles: { fillColor: UNIT_ROW_FILL, fontSize: 7.5, textColor: [55, 65, 81], cellPadding: { top: 2, bottom: 3, left: 4, right: 4 } }
                    },
                ]);
            });

            autoTable(doc, {
                head: [tableColumns],
                body: tableRows,
                startY: tableStartY,
                theme: 'plain',
                headStyles: { fillColor: '#1B3A69', textColor: 255, fontStyle: 'bold' },
                styles: { fontSize: 9, cellPadding: 4, valign: 'middle' },
                columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
                didParseCell: function(data) {
                    // Selling-unit detail rows span columns; keep them left-aligned
                    if (data.section === 'body' && data.cell.colSpan > 1) {
                        data.cell.styles.halign = 'left';
                        return;
                    }
                    if (data.section === 'body' && data.column.index === 7) {
                        if (data.cell.raw === 'Low Stock') {
                            data.cell.styles.textColor = [220, 38, 38];
                            data.cell.styles.fontStyle = 'bold';
                        } else {
                            data.cell.styles.textColor = [22, 163, 74];
                            data.cell.styles.fontStyle = 'bold';
                        }
                    }
                }
            });

            let finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 15 : tableStartY + 20;

            // If the table went too far down, add a new page for the summary so it doesn't cut off
            if (finalY > 150) {
                doc.addPage();
                finalY = 20;
            }

            // Draw Summary Box Background
            doc.setFillColor(249, 250, 251); // bg-gray-50
            doc.setDrawColor(229, 231, 235); // border-gray-200
            doc.rect(14, finalY, pageWidth - 28, 48, 'FD');

            // Summary Box Title
            doc.setFontSize(12);
            doc.setTextColor(31, 41, 55);
            doc.setFont(undefined, 'bold');
            doc.text('Inventory Valuation & Summary Report', 20, finalY + 8);

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(75, 85, 99);

            // Left Column: Items Stats
            doc.text(`Total Unique Items: ${exportData.length}`, 20, finalY + 18);
            // Multiple UOM stock is in different base units (meter, kg...), so it is not added here
            doc.text(`Total Stock Quantity (Standard): ${qtyText(totalItemsCount)}`, 20, finalY + 25);
            doc.text(`Multiple UOM Products: ${multiUomCount}`, 20, finalY + 32);
            doc.text(`Low Stock Alerts: ${lowStockCount}`, 20, finalY + 39);

            // Middle Column: Valuation (Cost & Wholesale)
            doc.text(`Total Cost: ${totalCostValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth / 2 - 40, finalY + 18);
            doc.text(`Total Wholesale Value: ${totalWholesaleValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth / 2 - 40, finalY + 25);
            doc.text(`Total Retail Valuation: ${totalRetailValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, pageWidth / 2 - 40, finalY + 32);

            const dateStr = new Date().toISOString().split('T')[0];
            const safeStorePrefix = (settings?.store_name || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            doc.save(`${safeStorePrefix}_Inventory_Report_${dateStr}.pdf`);
            auditExport({ type: 'inventory_pdf', count: exportData.length, filters: filterText, file_name: `${safeStorePrefix}_Inventory_Report_${dateStr}.pdf` });
            Swal.fire({ icon: 'success', title: 'PDF Exported!', toast: true, position: 'top-end', showConfirmButton: false, timer: 3000 });

        } catch (error) {
            console.error("PDF Generation Error:", error);
            Swal.fire('Error', 'Failed to generate PDF report.', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    /** Rows 1-5: store name, address, contact, title, spacer (same layout as before Multiple UOM). */
    const writeStoreHeader = (sheet, lastCol, title) => {
        const storeName = settings?.store_name || 'POS Store';
        const storeAddress = settings?.address || '';
        const storeContact = settings?.phone ? `Contact: ${settings.phone}` : '';

        const lines = [
            { value: storeName.toUpperCase(), font: { bold: true, color: { argb: '1B3A69' }, size: 16 }, height: 28 },
            { value: storeAddress, font: { color: { argb: '555555' }, size: 9 }, height: 16 },
            { value: storeContact, font: { color: { argb: '555555' }, size: 9, italic: true }, height: 16 },
            { value: title, font: { bold: true, color: { argb: '333333' }, size: 11 }, height: 20 },
        ];
        lines.forEach((line, i) => {
            const r = i + 1;
            sheet.mergeCells(`A${r}:${lastCol}${r}`);
            const cell = sheet.getCell(`A${r}`);
            cell.value = line.value;
            cell.font = line.font;
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.getRow(r).height = line.height;
        });
        sheet.getRow(5).height = 10;
    };

    /** Row 6: navy column headers. `rightCols` = 0-based indexes of numeric (right-aligned) columns. */
    const writeColumnHeaders = (sheet, headers, rightCols) => {
        const row = sheet.getRow(XLSX_HEADER_ROW);
        headers.forEach((h, colIndex) => {
            const cell = row.getCell(colIndex + 1);
            cell.value = h;
            cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 10 };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1B3A69' } };
            cell.alignment = { vertical: 'middle', horizontal: rightCols.includes(colIndex) ? 'right' : 'left' };
        });
        row.height = 25;
    };

    const PRODUCT_COLUMN_HEADERS = [
        'SKU / Barcode', 'Product Name', 'Category Name', 'Retail Price', 'Wholesale Price',
        'Cost Price', 'Stock Quantity', 'Selling Method', 'Base Unit', 'Default Unit'
    ];
    const PRODUCT_NUMERIC_COLS = [3, 4, 5, 6]; // Retail, Wholesale, Cost, Stock
    const UNIT_NUMERIC_COLS = [2, 3, 4];       // Conversion Factor, Retail, Wholesale
    const UNIT_COLUMN_HEADERS = ['SKU / Barcode', 'Unit Name', 'Conversion Factor', 'Retail Price', 'Wholesale Price', 'Is Default', 'Sort Order'];

    const styleProductRow = (row, numCols) => {
        const align = ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left', 'left', 'left'];
        for (let c = 1; c <= numCols; c++) row.getCell(c).alignment = { horizontal: align[c - 1] };
        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).numFmt = 'General';
    };

    /** Whole numbers as #,##0; fractional quantities/factors keep their decimals. */
    const quantityFormat = (n) => (Number.isInteger(Number(n)) ? '#,##0' : '#,##0.########');
    /** Stock cell format: product precision (value stays exact for re-import). */
    const stockCellFormat = (product, n) => {
        const d = productQtyDecimals(product);
        return Number.isInteger(Number(n)) || d === 0 ? '#,##0' : `#,##0.${'0'.repeat(d)}`;
    };

    const styleUnitRow = (row) => {
        const align = ['left', 'left', 'right', 'right', 'right', 'center', 'center'];
        for (let c = 1; c <= 7; c++) row.getCell(c).alignment = { horizontal: align[c - 1] };
        row.getCell(3).numFmt = 'General';
        row.getCell(4).numFmt = '#,##0.00';
        row.getCell(5).numFmt = '#,##0.00';
    };

    const applyExampleStyle = (row, numCols) => {
        for (let c = 1; c <= numCols; c++) {
            row.getCell(c).font = { italic: true, color: { argb: '6B7280' } };
            row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } };
        }
    };

    const downloadTemplate = () => setShowTemplateChooser(true);

    const generateTemplate = async (isComplete) => {
        setShowTemplateChooser(false);
        const numCols = isComplete ? 10 : 7;
        const lastCol = isComplete ? 'J' : 'G';
        const lastDataRow = XLSX_FIRST_DATA_ROW + 199; // 200 entry rows

        try {
            const workbook = new ExcelJS.Workbook();

            // ============================================================
            // WORKSHEET 1: Products (always present)
            // ============================================================
            const productsSheet = workbook.addWorksheet('Products', {
                views: [{ showGridLines: true, state: 'frozen', ySplit: XLSX_HEADER_ROW }]
            });

            const widths = isComplete ? [22, 35, 25, 18, 18, 18, 16, 18, 15, 18] : [20, 30, 25, 15, 18, 15, 15];
            widths.forEach((w, i) => { productsSheet.getColumn(i + 1).width = w; });

            writeStoreHeader(productsSheet, lastCol, isComplete ? 'COMPLETE PRODUCT IMPORT TEMPLATE' : 'PRODUCT DATA IMPORT TEMPLATE');
            writeColumnHeaders(productsSheet, isComplete ? PRODUCT_COLUMN_HEADERS : PRODUCT_COLUMN_HEADERS.slice(0, 7), PRODUCT_NUMERIC_COLS);
            productsSheet.autoFilter = { from: { row: XLSX_HEADER_ROW, column: 1 }, to: { row: XLSX_HEADER_ROW, column: numCols } };

            const catNames = categories.map(c => c.name).filter(Boolean);
            const listSource = catNames.length > 0 ? catNames : ['Clothing & Apparel', 'Electronics', 'Home & Garden', 'Sports & Outdoors', 'Accessories'];

            // Example rows (grey italic - skipped automatically on import)
            const examples = isComplete
                ? [
                    ['CEMENT-001', 'Portland Cement', 'Construction', 220, 200, 180, 50, 'Standard', 'N/A', 'N/A'],
                    ['WIRE-001', 'Electrical Wire', 'Electrical', 8.00, 7.00, 5.00, 1000, 'Multiple UOM', 'Meter', 'Meter'],
                ]
                : [['88010020', 'Sample Product A', listSource[0], 150.00, 130.00, 100.00, 50]];

            const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };

            for (let i = XLSX_FIRST_DATA_ROW; i <= lastDataRow; i++) {
                const row = productsSheet.getRow(i);
                styleProductRow(row, numCols);
                if ((i - XLSX_FIRST_DATA_ROW) % 2 === 1) {
                    for (let c = 1; c <= numCols; c++) row.getCell(c).fill = altFill;
                }
                row.getCell(3).dataValidation = {
                    type: 'list',
                    allowBlank: false,
                    formulae: [`CategoryList!$A$1:$A$${listSource.length}`],
                    showErrorMessage: true,
                    errorTitle: 'Field Required',
                    error: 'Category Name is required. Please choose one from the dropdown menu.',
                    promptTitle: 'Select Category',
                    prompt: 'Choose a category to ensure correct import matching.'
                };
                if (isComplete) {
                    row.getCell(8).dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: ['"Standard,Multiple UOM"'],
                        showErrorMessage: true,
                        errorTitle: 'Invalid Selling Method',
                        error: 'Choose "Standard" or "Multiple UOM".'
                    };
                }
            }

            examples.forEach((values, idx) => {
                const row = productsSheet.getRow(XLSX_FIRST_DATA_ROW + idx);
                values.forEach((v, c) => { row.getCell(c + 1).value = v; });
                applyExampleStyle(row, numCols);
            });

            // Hidden category list for the dropdown
            const categoriesSheet = workbook.addWorksheet('CategoryList');
            categoriesSheet.state = 'hidden';
            listSource.forEach((name, index) => {
                categoriesSheet.getCell(`A${index + 1}`).value = name;
            });

            // ============================================================
            // WORKSHEET 2: Product Units (only in Complete template)
            // ============================================================
            if (isComplete) {
                const unitsSheet = workbook.addWorksheet('Product Units', {
                    views: [{ showGridLines: true, state: 'frozen', ySplit: XLSX_HEADER_ROW }]
                });
                [22, 25, 20, 18, 18, 12, 12].forEach((w, i) => { unitsSheet.getColumn(i + 1).width = w; });

                writeStoreHeader(unitsSheet, 'G', 'PRODUCT UNITS (MULTIPLE UOM)');
                writeColumnHeaders(unitsSheet, UNIT_COLUMN_HEADERS, UNIT_NUMERIC_COLS);
                unitsSheet.autoFilter = { from: { row: XLSX_HEADER_ROW, column: 1 }, to: { row: XLSX_HEADER_ROW, column: 7 } };

                for (let i = XLSX_FIRST_DATA_ROW; i <= lastDataRow; i++) {
                    const row = unitsSheet.getRow(i);
                    styleUnitRow(row);
                    if ((i - XLSX_FIRST_DATA_ROW) % 2 === 1) {
                        for (let c = 1; c <= 7; c++) row.getCell(c).fill = altFill;
                    }
                    row.getCell(6).dataValidation = {
                        type: 'list',
                        allowBlank: true,
                        formulae: ['"Yes,No"'],
                        showErrorMessage: true,
                        errorTitle: 'Invalid Value',
                        error: 'Choose "Yes" or "No".'
                    };
                }

                const exampleUnits = [
                    ['WIRE-001', 'Meter', 1, 8.00, 7.00, 'Yes', 1],
                    ['WIRE-001', 'Feet', 0.3048, 2.50, 2.20, 'No', 2],
                    ['WIRE-001', 'Roll', 100, 700.00, 650.00, 'No', 3],
                ];
                exampleUnits.forEach((values, idx) => {
                    const row = unitsSheet.getRow(XLSX_FIRST_DATA_ROW + idx);
                    values.forEach((v, c) => { row.getCell(c + 1).value = v; });
                    applyExampleStyle(row, 7);
                });

                // Instructions sheet
                const instructionsSheet = workbook.addWorksheet('Instructions');
                instructionsSheet.getColumn('A').width = 100;
                const instructions = [
                    'COMPLETE PRODUCT IMPORT TEMPLATE - INSTRUCTIONS',
                    '',
                    'This workbook contains two worksheets:',
                    '1. Products - Main product information (10 columns)',
                    '2. Product Units - Selling units for Multiple UOM products (7 columns)',
                    '',
                    'Rows 1-5 are the store header and row 6 holds the column headers. Enter data from row 7.',
                    'The header rows are skipped automatically on import.',
                    '',
                    '=== PRODUCTS WORKSHEET ===',
                    'Columns:',
                    'A: SKU / Barcode - Unique identifier (REQUIRED)',
                    'B: Product Name - Product display name (REQUIRED)',
                    'C: Category Name - Must match existing category or will be created (REQUIRED)',
                    'D: Retail Price - For Multiple UOM: default unit price for reference only (may be blank / N/A)',
                    'E: Wholesale Price - For Multiple UOM: default unit price for reference only (may be blank / N/A)',
                    'F: Cost Price - Cost per BASE UNIT (REQUIRED for Multiple UOM)',
                    'G: Stock Quantity - Quantity in BASE UNIT for Multiple UOM products',
                    'H: Selling Method - "Standard" or "Multiple UOM" (blank = Standard)',
                    'I: Base Unit - Base inventory unit (e.g., Meter, Piece) - REQUIRED for Multiple UOM',
                    'J: Default Unit - Default selling unit name - REQUIRED for Multiple UOM',
                    '',
                    'Rules:',
                    '- Standard products: Fill D, E, F, G. H=Standard, I and J = N/A (or blank).',
                    '- Multiple UOM products: D and E are ignored on import (unit prices come from Product Units). Fill F (cost per base unit), G (stock in base units), H=Multiple UOM, I (base unit), J (default unit name).',
                    '- The grey italic example rows (CEMENT-001, WIRE-001) are ignored on import. Delete or overwrite them.',
                    '',
                    '=== PRODUCT UNITS WORKSHEET ===',
                    'Columns:',
                    'A: SKU / Barcode - Must match a product in Products worksheet (REQUIRED)',
                    'B: Unit Name - Selling unit name, e.g., Roll, Feet, Box (REQUIRED)',
                    'C: Conversion Factor - How many base units in one selling unit (REQUIRED, >0)',
                    'D: Retail Price - Selling price for this unit (REQUIRED)',
                    'E: Wholesale Price - Wholesale price for this unit (REQUIRED)',
                    'F: Is Default - "Yes" for exactly ONE unit per product, "No" for others (REQUIRED)',
                    'G: Sort Order - Display order number',
                    '',
                    'Rules:',
                    '- Each Multiple UOM product must have at least one row in Product Units.',
                    '- Exactly ONE unit per product must have Is Default = Yes.',
                    '- Unit names must be unique per product.',
                    '- Conversion Factor must be > 0.',
                    '',
                    '=== IMPORT NOTES ===',
                    '- Import as ONE .xlsx file (both worksheets together).',
                    '- CSV import only supports Standard products (7 columns).',
                    '- An Inventory Export file can be edited and imported back directly.',
                    '- Existing products matched by SKU will be updated (stock NOT overwritten).',
                    '- Historical transactions are preserved - unit snapshots remain unchanged.',
                ];
                instructions.forEach((line, i) => {
                    const cell = instructionsSheet.getRow(i + 1).getCell(1);
                    cell.value = line;
                    if (i === 0) cell.font = { bold: true, size: 12, color: { argb: '1B3A69' } };
                    else if (line.startsWith('===')) cell.font = { bold: true, size: 11, color: { argb: '374151' } };
                    else if (line.startsWith('-')) cell.font = { size: 10 };
                });
            }

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const safeStorePrefix = (settings?.store_name || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            const fileName = isComplete
                ? `${safeStorePrefix}_Complete_Products_Template.xlsx`
                : `${safeStorePrefix}_Standard_Products_Template.xlsx`;
            saveAs(blob, fileName);
            Swal.fire({ icon: 'success', title: 'Template Downloaded!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Failed to download template.', 'error');
        }
    };

    const exportExcel = async () => {
        try {
            const workbook = new ExcelJS.Workbook();
            const altFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
            const generatedAt = new Date().toLocaleString();
            const isMultiProduct = (p) => p.selling_method === 'multiple' || p.is_multi_unit;
            const centsToAmount = (v) => (v === null || v === undefined || v === '') ? 0 : Number(v) / 100;

            // ============================================================
            // WORKSHEET 1: Products
            // ============================================================
            const productsSheet = workbook.addWorksheet('Products', {
                views: [{ showGridLines: true, state: 'frozen', ySplit: XLSX_HEADER_ROW }]
            });
            [22, 35, 25, 18, 18, 18, 16, 18, 15, 18].forEach((w, i) => { productsSheet.getColumn(i + 1).width = w; });

            writeStoreHeader(productsSheet, 'J', `INVENTORY EXPORT (Generated: ${generatedAt})`);
            writeColumnHeaders(productsSheet, PRODUCT_COLUMN_HEADERS, PRODUCT_NUMERIC_COLS);

            products.forEach((p, idx) => {
                const row = productsSheet.getRow(XLSX_FIRST_DATA_ROW + idx);
                const isMulti = isMultiProduct(p);
                const defaultUnitRow = isMulti ? (p.units?.find(u => u.is_default) || p.units?.[0] || null) : null;
                const defaultUnit = defaultUnitRow?.name || '';

                row.getCell(1).value = p.sku || '';
                row.getCell(2).value = p.name || '';
                row.getCell(3).value = p.category?.name || 'Uncategorized';
                // Multiple UOM prices live on the Product Units sheet
                // Multiple UOM: show the default unit's prices (reference only - unit prices are
                // imported from the Product Units sheet). Standard: the product's own prices.
                row.getCell(4).value = isMulti ? (defaultUnitRow ? centsToAmount(defaultUnitRow.price) : 'N/A') : centsToAmount(p.price);
                row.getCell(5).value = isMulti ? (defaultUnitRow ? centsToAmount(defaultUnitRow.wholesale_price) : 'N/A') : centsToAmount(p.wholesale_price);
                if (isMulti && defaultUnitRow) {
                    const note = `Price of the default unit (${defaultUnit}). To change it, edit the Product Units sheet.`;
                    row.getCell(4).note = note;
                    row.getCell(5).note = note;
                }
                row.getCell(6).value = centsToAmount(p.cost_price);
                row.getCell(7).value = Number(p.stock_quantity) || 0;
                row.getCell(8).value = isMulti ? 'Multiple UOM' : 'Standard';
                row.getCell(9).value = isMulti ? (p.base_unit || '') : 'N/A';
                row.getCell(10).value = isMulti ? defaultUnit : 'N/A';

                styleProductRow(row, 10);
                row.getCell(7).numFmt = stockCellFormat(p, row.getCell(7).value);
                if (idx % 2 === 1) {
                    for (let c = 1; c <= 10; c++) row.getCell(c).fill = altFill;
                }
            });

            productsSheet.autoFilter = {
                from: { row: XLSX_HEADER_ROW, column: 1 },
                to: { row: XLSX_HEADER_ROW + products.length, column: 10 }
            };

            // ============================================================
            // WORKSHEET 2: Product Units
            // ============================================================
            const unitsSheet = workbook.addWorksheet('Product Units', {
                views: [{ showGridLines: true, state: 'frozen', ySplit: XLSX_HEADER_ROW }]
            });
            [22, 25, 20, 18, 18, 12, 12].forEach((w, i) => { unitsSheet.getColumn(i + 1).width = w; });

            writeStoreHeader(unitsSheet, 'G', `PRODUCT UNITS EXPORT (Generated: ${generatedAt})`);
            writeColumnHeaders(unitsSheet, UNIT_COLUMN_HEADERS, UNIT_NUMERIC_COLS);

            const allUnits = [];
            products.forEach(p => {
                if (isMultiProduct(p) && p.units && p.units.length > 0) {
                    p.units.forEach((u, sortIndex) => {
                        allUnits.push({
                            sku: p.sku || '',
                            unit_name: u.name,
                            conversion_factor: Number(u.conversion_factor),
                            retail_price: centsToAmount(u.price),
                            wholesale_price: centsToAmount(u.wholesale_price),
                            is_default: u.is_default ? 'Yes' : 'No',
                            sort_order: u.sort_order ?? sortIndex + 1
                        });
                    });
                }
            });

            allUnits.sort((a, b) => (a.sku !== b.sku ? a.sku.localeCompare(b.sku) : a.sort_order - b.sort_order));

            allUnits.forEach((u, idx) => {
                const row = unitsSheet.getRow(XLSX_FIRST_DATA_ROW + idx);
                row.getCell(1).value = u.sku;
                row.getCell(2).value = u.unit_name;
                row.getCell(3).value = u.conversion_factor;
                row.getCell(4).value = u.retail_price;
                row.getCell(5).value = u.wholesale_price;
                row.getCell(6).value = u.is_default;
                row.getCell(7).value = u.sort_order;

                styleUnitRow(row);
                row.getCell(3).numFmt = quantityFormat(u.conversion_factor);
                if (idx % 2 === 1) {
                    for (let c = 1; c <= 7; c++) row.getCell(c).fill = altFill;
                }
            });

            unitsSheet.autoFilter = {
                from: { row: XLSX_HEADER_ROW, column: 1 },
                to: { row: XLSX_HEADER_ROW + allUnits.length, column: 7 }
            };

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const dateStr = new Date().toISOString().split('T')[0];
            const safeStorePrefix = (settings?.store_name || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
            saveAs(blob, `${safeStorePrefix}_Inventory_Export_${dateStr}.xlsx`);
            auditExport({ type: 'inventory_excel', count: products.length, units_count: allUnits.length, file_name: `${safeStorePrefix}_Inventory_Export_${dateStr}.xlsx` });
            Swal.fire({ icon: 'success', title: 'Export Completed!', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
        } catch (e) {
            console.error(e);
            Swal.fire('Error', 'Failed to export inventory data.', 'error');
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Swal.fire({
            title: 'Processing File...',
            text: 'Please wait while we analyze your file.',
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        try {
            const isCsv = file.name.endsWith('.csv');
            const reader = new FileReader();

            reader.onload = async (evt) => {
                try {
                    let previewData = {
                        products: [],
                        units: [],
                        summary: {
                            totalProducts: 0,
                            newProducts: 0,
                            existingProducts: 0,
                            standardProducts: 0,
                            multipleUomProducts: 0,
                            totalUnits: 0,
                            duplicateSkus: 0
                        },
                        errors: [],
                        warnings: [],
                        fileName: file.name
                    };

                    const addProductRow = (rowNum, values) => {
                        const sku = String(values.sku ?? '').trim();
                        const name = String(values.name ?? '').trim();
                        const category_name = String(values.category_name ?? '').trim();
                        if (!sku && !name && !category_name) return;

                        const method = String(values.selling_method ?? '').trim().toLowerCase();
                        const isMulti = method === 'multiple uom' || method === 'multiple';
                        const existing = products.find(p => p.sku === sku);

                        previewData.products.push({
                            rowNum,
                            sku, name, category_name,
                            price: parseImportNumber(values.price),
                            wholesale_price: parseImportNumber(values.wholesale_price),
                            cost_price: parseImportNumber(values.cost_price),
                            stock_quantity: parseImportNumber(values.stock_quantity),
                            // Blank stock never changes an existing product's stock
                            stock_provided: parseImportNumber(values.stock_quantity) !== null,
                            selling_method_raw: method,
                            selling_method: isMulti ? 'multiple' : 'standard',
                            base_unit: isMulti ? notApplicableToBlank(values.base_unit) : '',
                            default_unit: isMulti ? notApplicableToBlank(values.default_unit) : '',
                            isNew: !existing,
                            existingProduct: existing
                        });
                        previewData.summary.totalProducts++;
                        if (isMulti) previewData.summary.multipleUomProducts++;
                        else previewData.summary.standardProducts++;
                        if (existing) previewData.summary.existingProducts++;
                        else previewData.summary.newProducts++;
                    };

                    if (isCsv) {
                        // CSV - Standard products only. First line is the header row
                        // (template/old exports); columns are matched by name, else by position.
                        const csvContent = new TextDecoder('utf-8').decode(evt.target.result).replace(/^﻿/, '');
                        const lines = csvContent.split(/\r?\n/);

                        if (lines.length < 2) {
                            Swal.fire('No Data', 'CSV file is empty.', 'warning');
                            return;
                        }

                        const columns = { ...PRODUCT_DEFAULT_COLUMNS };
                        const seen = new Set();
                        splitCsvLine(lines[0]).forEach((h, i) => {
                            const field = matchHeader(PRODUCT_HEADER_RULES, h);
                            if (field && !seen.has(field)) {
                                seen.add(field);
                                columns[field] = i + 1;
                            }
                        });

                        for (let i = 1; i < lines.length; i++) {
                            if (!lines[i].trim()) continue;
                            const cells = splitCsvLine(lines[i]);
                            const get = (field) => cells[columns[field] - 1] ?? '';
                            if (TEMPLATE_EXAMPLE_SKUS.has(get('sku')) && get('name').startsWith('Sample Product')) continue;
                            addProductRow(i + 1, {
                                sku: get('sku'), name: get('name'), category_name: get('category_name'),
                                price: get('price'), wholesale_price: get('wholesale_price'),
                                cost_price: get('cost_price'), stock_quantity: get('stock_quantity'),
                                selling_method: '', // CSV supports Standard only
                            });
                        }
                    } else {
                        // XLSX - supports both Standard and Multiple UOM
                        const workbook = new ExcelJS.Workbook();
                        await workbook.xlsx.load(evt.target.result);

                        // Products sheet (old files used "Products Template" / "Inventory Report" as first sheet)
                        const productsSheet = workbook.getWorksheet('Products') || workbook.worksheets.find(ws => ws.state !== 'hidden') || workbook.worksheets[0];
                        const productHeader = locateXlsxHeader(productsSheet, /product|name/, PRODUCT_HEADER_RULES, PRODUCT_DEFAULT_COLUMNS);
                        const pc = productHeader.columns;

                        productsSheet.eachRow((row, rowNumber) => {
                            if (rowNumber <= productHeader.headerRow) return;
                            const text = (field) => xlsxCellText(row.getCell(pc[field])).trim();
                            const sku = text('sku');
                            if (isTemplateExampleRow(row, pc.sku, sku)) return;

                            addProductRow(rowNumber, {
                                sku,
                                name: text('name'),
                                category_name: text('category_name'),
                                price: row.getCell(pc.price).value,
                                wholesale_price: row.getCell(pc.wholesale_price).value,
                                cost_price: row.getCell(pc.cost_price).value,
                                stock_quantity: row.getCell(pc.stock_quantity).value,
                                selling_method: text('selling_method'),
                                base_unit: text('base_unit'),
                                default_unit: text('default_unit'),
                            });
                        });

                        // Product Units sheet (optional)
                        const unitsSheet = workbook.getWorksheet('Product Units');
                        if (unitsSheet) {
                            const unitHeader = locateXlsxHeader(unitsSheet, /unit|name/, UNIT_HEADER_RULES, UNIT_DEFAULT_COLUMNS);
                            const uc = unitHeader.columns;

                            unitsSheet.eachRow((row, rowNumber) => {
                                if (rowNumber <= unitHeader.headerRow) return;
                                const text = (field) => xlsxCellText(row.getCell(uc[field])).trim();
                                const sku = text('sku');
                                const unit_name = text('unit_name');
                                if (!sku && !unit_name) return;
                                if (isTemplateExampleRow(row, uc.sku, sku)) return;

                                previewData.units.push({
                                    rowNum: rowNumber,
                                    sku, unit_name,
                                    conversion_factor: parseImportNumber(row.getCell(uc.conversion_factor).value),
                                    retail_price: parseImportNumber(row.getCell(uc.retail_price).value),
                                    wholesale_price: parseImportNumber(row.getCell(uc.wholesale_price).value),
                                    is_default: text('is_default').toLowerCase(),
                                    sort_order: parseImportNumber(row.getCell(uc.sort_order).value)
                                });
                                previewData.summary.totalUnits++;
                            });
                        }
                    }

                    // Calculate duplicates
                    const skuCounts = {};
                    previewData.products.forEach(p => {
                        skuCounts[p.sku] = (skuCounts[p.sku] || 0) + 1;
                    });
                    previewData.summary.duplicateSkus = Object.values(skuCounts).filter(c => c > 1).length;

                    // Check for units referencing unknown SKUs
                    const productSkus = new Set(previewData.products.map(p => p.sku));
                    previewData.units.forEach(u => {
                        if (!productSkus.has(u.sku)) {
                            previewData.errors.push(`Row ${u.rowNum} (Product Units): SKU "${u.sku}" not found in Products sheet`);
                        }
                    });

                    // Validate each product
                    previewData.products.forEach(p => {
                        if (!p.sku) previewData.errors.push(`Row ${p.rowNum}: SKU is empty`);
                        if (!p.name) previewData.errors.push(`Row ${p.rowNum}: Product Name is empty`);
                        if (!p.category_name) previewData.errors.push(`Row ${p.rowNum}: Category Name is empty`);
                        
                        if (p.selling_method === 'multiple') {
                            if (!p.base_unit) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Base Unit required for Multiple UOM`);
                            if (!p.default_unit) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Default Unit required for Multiple UOM`);
                            if (p.cost_price === null || p.cost_price < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Cost Price required for Multiple UOM`);
                            if (p.stock_quantity === null || p.stock_quantity < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Stock Quantity required for Multiple UOM`);
                            
                            // Check units
                            const productUnits = previewData.units.filter(u => u.sku === p.sku);
                            if (productUnits.length === 0) {
                                previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Multiple UOM product must have units in Product Units sheet`);
                            } else {
                                let hasDefault = false;
                                const unitNames = new Set();
                                productUnits.forEach(u => {
                                    if (!u.unit_name) previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Unit name is empty`);
                                    if (unitNames.has(u.unit_name.toLowerCase())) {
                                        previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Duplicate unit name "${u.unit_name}"`);
                                    }
                                    unitNames.add(u.unit_name.toLowerCase());
                                    if (u.conversion_factor === null || u.conversion_factor <= 0) {
                                        previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Conversion factor must be > 0 for "${u.unit_name}"`);
                                    } else {
                                        const hint = repeatingFactorHint(u.conversion_factor, p.base_unit, u.unit_name);
                                        if (hint) previewData.warnings.push(`Row ${u.rowNum} (Product Units, ${p.sku}, ${u.unit_name}): ${hint}`);
                                    }
                                    if (u.retail_price === null || u.retail_price < 0) {
                                        previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Retail price required for "${u.unit_name}"`);
                                    }
                                    if (u.wholesale_price === null || u.wholesale_price < 0) {
                                        previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Wholesale price required for "${u.unit_name}"`);
                                    }
                                    if (u.is_default === 'yes') {
                                        if (hasDefault) {
                                            previewData.errors.push(`Row ${u.rowNum} (Product Units, ${p.sku}): Multiple default units`);
                                        }
                                        hasDefault = true;
                                    }
                                });
                                if (!hasDefault) {
                                    previewData.errors.push(`Product ${p.sku}: Must have exactly one default unit (Is Default = Yes)`);
                                }
                            }
                        } else {
                            // Standard product. Blank Selling Method = Standard (old 7-column files);
                            // blank wholesale/cost/stock default to 0 like before.
                            if (!['', 'standard'].includes(p.selling_method_raw)) {
                                previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Selling Method must be "Standard" or "Multiple UOM"`);
                            }
                            p.wholesale_price = p.wholesale_price ?? 0;
                            p.cost_price = p.cost_price ?? 0;
                            p.stock_quantity = p.stock_quantity ?? 0;
                            if (p.price === null || p.price < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Retail Price required`);
                            if (p.wholesale_price < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Wholesale Price cannot be negative`);
                            if (p.cost_price < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Cost Price cannot be negative`);
                            if (p.stock_quantity < 0) previewData.errors.push(`Row ${p.rowNum} (${p.sku}): Stock Quantity cannot be negative`);
                        }
                    });

                    if (previewData.products.length === 0) {
                        Swal.fire('No Data', 'No valid products found in file.', 'warning');
                        return;
                    }

                    // Show the React preview modal; submitImport() sends it
                    Swal.close();
                    setImportPreview({ ...previewData, overwrite: true, updateStock: false, submitting: false, serverErrors: [] });
                } catch (err) {
                    // File could not be parsed (corrupt / not a valid .xlsx or .csv)
                    console.error(err);
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Read File',
                        text: err.message || 'The file could not be read. Make sure it is a valid .xlsx or .csv file.',
                        customClass: { popup: 'rounded-none' }
                    });
                }
            };

            reader.readAsArrayBuffer(file);
        } catch (err) {
            Swal.fire('Error', 'Could not read the uploaded file.', 'error');
        } finally {
            e.target.value = '';
        }
    };

    const submitImport = async () => {
        if (!importPreview || importPreview.submitting || importPreview.errors.length > 0) return;
        const { products: rows, units, overwrite, updateStock } = importPreview;
        setImportPreview(prev => ({ ...prev, submitting: true, serverErrors: [] }));

        try {
            // Duplicate SKUs: last occurrence wins
            const uniqueProducts = Array.from(rows.reduce((map, p) => map.set(p.sku, p), new Map()).values())
                .map(({ existingProduct, isNew, selling_method_raw, stock_provided, ...row }) => ({
                    ...row,
                    // Multiple UOM prices come from the Product Units sheet; D/E are reference only
                    ...(row.selling_method === 'multiple' ? { price: null, wholesale_price: null } : {}),
                    stock_quantity: stock_provided ? row.stock_quantity : null,
                }));

            const response = await axios.post('/api/products/import', {
                products: uniqueProducts,
                units,
                file_name: importPreview.fileName,
                overwrite,
                update_stock: overwrite && updateStock,
            });
            if (!response.data.success) throw new Error(response.data.message);

            setImportPreview(null);
            loadAllProducts(false);

            const { imported_count = 0, updated_count = 0, stock_updated_count = 0, skipped_count = 0, skipped_skus = [], warnings = [] } = response.data;
            let htmlContent = `<div class="text-left font-sans text-sm p-1">`;
            if (imported_count > 0) {
                htmlContent += `<p class="font-bold text-gray-800">Imported <span class="text-green-600 font-semibold">${imported_count}</span> new product(s).</p>`;
            }
            if (updated_count > 0) {
                htmlContent += `<p class="font-bold text-gray-800 mt-2">Updated <span class="text-blue-600 font-semibold">${updated_count}</span> existing product(s)${stock_updated_count > 0 ? `, stock changed on <span class="text-amber-600 font-semibold">${stock_updated_count}</span>` : ''}.</p>`;
            }
            if (skipped_count > 0) {
                htmlContent += `
                    <p class="mt-3 text-amber-700 font-semibold">Skipped <span class="font-bold">${skipped_count}</span> existing product(s):</p>
                    <div class="mt-2 max-h-32 overflow-y-auto bg-amber-50 p-2 border border-amber-200 font-mono text-xs text-amber-800 select-all">${skipped_skus.join('<br>')}</div>`;
            }
            if (warnings.length > 0) {
                htmlContent += `
                    <p class="mt-3 text-indigo-700 font-semibold">Warnings:</p>
                    <div class="mt-2 max-h-32 overflow-y-auto bg-indigo-50 p-2 border border-indigo-200 font-mono text-xs text-indigo-800 select-all">${warnings.join('<br>')}</div>`;
            }
            htmlContent += `</div>`;
            Swal.fire({ icon: 'success', title: 'Import Completed!', html: htmlContent, confirmButtonColor: '#1B3A69' });
        } catch (err) {
            console.error(err);
            const data = err.response?.data;
            const serverErrors = Array.isArray(data?.errors) && data.errors.length
                ? data.errors
                : [data?.message || err.message || 'An error occurred during import.'];
            setImportPreview(prev => prev && ({ ...prev, submitting: false, serverErrors }));
        }
    };

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
    const handleFileChange = (e) => setFormData({ ...formData, image: e.target.files[0] });

    const handleSellingMethodChange = (method) => {
        setFormData((prev) => ({
            ...prev,
            selling_method: method,
            units: method === 'multiple' && prev.units.length === 0
                ? [emptyUnitRow(true)]
                : prev.units,
        }));
    };

    const handleUnitChange = (index, field, value) => {
        setFormData((prev) => {
            const units = [...prev.units];
            units[index] = { ...units[index], [field]: value };

            if (field === 'is_default' && value) {
                units.forEach((unit, unitIndex) => {
                    units[unitIndex] = { ...unit, is_default: unitIndex === index };
                });
            }

            return { ...prev, units };
        });
    };

    const addUnitRow = () => {
        setFormData((prev) => ({
            ...prev,
            units: [...prev.units, emptyUnitRow(prev.units.length === 0)],
        }));
    };

    const removeUnitRow = (index) => {
        setFormData((prev) => {
            const units = prev.units.filter((_, unitIndex) => unitIndex !== index);

            if (units.length > 0 && !units.some((unit) => unit.is_default)) {
                units[0] = { ...units[0], is_default: true };
            }

            return { ...prev, units };
        });
    };

    // Base Unit Suggestion Handlers
    const filteredBaseUnits = COMMON_UNITS.filter(u =>
        !formData.base_unit.trim() || u.toLowerCase().includes(formData.base_unit.toLowerCase().trim())
    );

    const handleBaseUnitKeyDown = (e) => {
        if (!baseUnitSuggestionsOpen || filteredBaseUnits.length === 0) {
            if (e.key === 'ArrowDown') {
                setBaseUnitSuggestionsOpen(true);
                setBaseUnitHighlightedIndex(0);
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setBaseUnitHighlightedIndex(prev => prev < filteredBaseUnits.length - 1 ? prev + 1 : 0);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setBaseUnitHighlightedIndex(prev => prev > 0 ? prev - 1 : filteredBaseUnits.length - 1);
        } else if (e.key === 'Enter') {
            if (baseUnitHighlightedIndex >= 0 && baseUnitHighlightedIndex < filteredBaseUnits.length) {
                e.preventDefault();
                setFormData(prev => ({ ...prev, base_unit: filteredBaseUnits[baseUnitHighlightedIndex] }));
                setBaseUnitSuggestionsOpen(false);
                setBaseUnitHighlightedIndex(-1);
            }
        } else if (e.key === 'Escape') {
            setBaseUnitSuggestionsOpen(false);
            setBaseUnitHighlightedIndex(-1);
            e.preventDefault();
        }
    };

    // Selling Unit Name Suggestion Handlers
    const getFilteredUnitNames = (unitName) => COMMON_UNITS.filter(u =>
        !unitName.trim() || u.toLowerCase().includes(unitName.toLowerCase().trim())
    );

    const handleUnitNameKeyDown = (index, e) => {
        const unitName = formData.units[index]?.name || '';
        const filtered = getFilteredUnitNames(unitName);
        const openKey = `open_${index}`;
        const highlightKey = `highlight_${index}`;

        if (!unitNameSuggestionsOpen[openKey] || filtered.length === 0) {
            if (e.key === 'ArrowDown') {
                setUnitNameSuggestionsOpen(prev => ({ ...prev, [openKey]: true }));
                setUnitNameHighlightedIndex(prev => ({ ...prev, [highlightKey]: 0 }));
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setUnitNameHighlightedIndex(prev => ({ ...prev, [highlightKey]: prev[highlightKey] < filtered.length - 1 ? prev[highlightKey] + 1 : 0 }));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setUnitNameHighlightedIndex(prev => ({ ...prev, [highlightKey]: prev[highlightKey] > 0 ? prev[highlightKey] - 1 : filtered.length - 1 }));
        } else if (e.key === 'Enter') {
            if (unitNameHighlightedIndex[highlightKey] >= 0 && unitNameHighlightedIndex[highlightKey] < filtered.length) {
                e.preventDefault();
                handleUnitChange(index, 'name', filtered[unitNameHighlightedIndex[highlightKey]]);
                setUnitNameSuggestionsOpen(prev => ({ ...prev, [openKey]: false }));
                setUnitNameHighlightedIndex(prev => ({ ...prev, [highlightKey]: -1 }));
            }
        } else if (e.key === 'Escape') {
            setUnitNameSuggestionsOpen(prev => ({ ...prev, [openKey]: false }));
            setUnitNameHighlightedIndex(prev => ({ ...prev, [highlightKey]: -1 }));
            e.preventDefault();
        }
    };

    const checkSkuExists = (skuToCheck) => {
        return products.some(p => p.sku === skuToCheck && p.id !== editingId);
    };

    const checkNameExists = (nameToCheck) => {
        return products.some(p => p.name.toLowerCase() === nameToCheck.toLowerCase() && p.id !== editingId);
    };

    const generateSKU = async () => {
        setIsCheckingSku(true);
        try {
            const response = await axios.get('/api/products/next-sku');
            if (response.data.success && response.data.next_sku) {
                setFormData(prev => ({ ...prev, sku: response.data.next_sku }));
            } else {
                throw new Error("Invalid next SKU response");
            }
        } catch (error) {
            console.error("SKU generation failed:", error);
            Swal.fire('Error', 'Could not generate next sequential SKU.', 'error');
        } finally {
            setIsCheckingSku(false);
        }
    };

    const handleScan = (data) => {
        setShowScanner(false);

        if (checkSkuExists(data)) {
            Swal.fire({ icon: 'warning', title: 'Duplicate Barcode', text: `The barcode "${data}" is already registered!`, confirmButtonColor: '#3085d6' });
        } else {
            setFormData(p => ({ ...p, sku: data }));
            setShowModal(true);
        }
    };

    const openAddModal = () => {
        setEditMode(false);
        setEditingId(null);
        setFormData({
            name: '', category_id: '', price: '', cost_price: '', wholesale_price: '', stock_quantity: '',
            sku: '', image: null, is_active: true, selling_method: 'standard', base_unit: '', quantity_decimals: '', units: [],
        });
        setShowModal(true);
    };

    const openEditModal = (p) => {
        setEditMode(true);
        setEditingId(p.id);
        const isMultiple = p.selling_method === 'multiple';

        setFormData({
            name: p.name,
            category_id: p.category_id || '',
            price: p.price !== null && p.price !== undefined ? (p.price / 100).toFixed(2) : '',
            cost_price: p.cost_price ? (p.cost_price / 100).toFixed(2) : '',
            wholesale_price: p.wholesale_price !== null && p.wholesale_price !== undefined ? (p.wholesale_price / 100).toFixed(2) : '',
            stock_quantity: p.stock_quantity,
            sku: p.sku,
            image: null,
            is_active: p.is_active !== undefined ? !!p.is_active : true,
            selling_method: isMultiple ? 'multiple' : 'standard',
            base_unit: p.base_unit || '',
            quantity_decimals: p.quantity_decimals ?? '',
            units: (p.units || []).map((unit) => ({
                name: unit.name,
                conversion_factor: String(Number(unit.conversion_factor)),
                price: (unit.price / 100).toFixed(2),
                wholesale_price: (unit.wholesale_price / 100).toFixed(2),
                is_default: !!unit.is_default,
            })),
        });
        setShowModal(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSaving(true);

        try {
            const cleanName = formData.name.trim();
            const cleanSku = formData.sku.trim();

            if (checkNameExists(cleanName)) {
                setIsSaving(false);
                return Swal.fire({ icon: 'warning', title: 'Name Already Exists', text: `A product named "${cleanName}" is already in your inventory.`, confirmButtonColor: '#3085d6' });
            }

            if (checkSkuExists(cleanSku)) {
                setIsSaving(false);
                return Swal.fire({ icon: 'warning', title: 'Duplicate Barcode', text: `The barcode "${cleanSku}" is already assigned.`, confirmButtonColor: '#3085d6' });
            }

            if (formData.selling_method === 'multiple') {
                if (!formData.base_unit.trim()) {
                    setIsSaving(false);
                    return Swal.fire({ icon: 'warning', title: 'Base Unit Required', text: 'Please enter the base inventory unit (e.g. meter, piece, gram).', confirmButtonColor: '#3085d6' });
                }

                if (formData.units.length === 0) {
                    setIsSaving(false);
                    return Swal.fire({ icon: 'warning', title: 'Selling Unit Required', text: 'Add at least one selling unit for this product.', confirmButtonColor: '#3085d6' });
                }

                const invalidUnit = formData.units.find((unit) => !unit.name.trim() || Number(unit.conversion_factor) <= 0);
                if (invalidUnit) {
                    setIsSaving(false);
                    return Swal.fire({ icon: 'warning', title: 'Invalid Selling Unit', text: 'Every unit needs a name and a conversion factor greater than zero.', confirmButtonColor: '#3085d6' });
                }

                if (!formData.units.some((unit) => unit.is_default)) {
                    setIsSaving(false);
                    return Swal.fire({ icon: 'warning', title: 'Default Unit Required', text: 'Select which selling unit should be used by default.', confirmButtonColor: '#3085d6' });
                }
            }

            const data = new FormData();
            data.append('name', cleanName);
            data.append('category_id', formData.category_id);
            data.append('cost_price', formData.cost_price);
            data.append('stock_quantity', formData.stock_quantity);
            data.append('sku', cleanSku);
            data.append('is_active', formData.is_active ? '1' : '0');
            data.append('selling_method', formData.selling_method);

            if (formData.selling_method === 'multiple') {
                data.append('base_unit', formData.base_unit);
                data.append('quantity_decimals', formData.quantity_decimals ?? ''); // '' = auto from base unit
                data.append('units', JSON.stringify(formData.units.map((unit) => ({
                    name: unit.name,
                    conversion_factor: unit.conversion_factor,
                    price: unit.price,
                    wholesale_price: unit.wholesale_price,
                    is_default: !!unit.is_default,
                }))));
            } else {
                data.append('price', formData.price);
                data.append('wholesale_price', formData.wholesale_price);
            }

            if(formData.image) data.append('image', formData.image);

            if(editMode) {
                data.append('_method', 'PUT');
                await axios.post(`/api/products/${editingId}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
            } else {
                await axios.post('/api/products', data, { headers: { 'Content-Type': 'multipart/form-data' } });
            }

            setShowModal(false);
            loadAllProducts(false); // Silent reload
            Swal.fire({ icon: 'success', title: 'Saved!', showConfirmButton: false, timer: 1500 });

        } catch(err) {
            // Show the server's reason (e.g. validation errors) instead of a generic message
            const data = err.response?.data;
            const messages = data?.errors
                ? [...new Set(Object.values(data.errors).flat())]
                : [data?.error || data?.message || 'An error occurred while saving the product.'];
            Swal.fire({
                icon: 'error',
                title: 'Could Not Save Product',
                html: `<div class="text-left text-sm">${messages.map(m => `<div class="py-0.5">• ${String(m).replace(/</g, '&lt;')}</div>`).join('')}</div>`,
                confirmButtonColor: '#1B3A69',
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleActive = async (product) => {
        const action = product.is_active ? 'Archive' : 'Restore';
        const actionPast = product.is_active ? 'archived' : 'restored';
        
        const result = await Swal.fire({
            title: `${action} this product?`,
            text: product.is_active 
                ? `Archiving "${product.name}" will hide it from the POS sales screen, but keep its sales logs.`
                : `Restoring "${product.name}" will make it available again on the POS sales screen.`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#1B3A69',
            cancelButtonColor: '#d33',
            confirmButtonText: `Yes, ${action}!`
        });

        if (result.isConfirmed) {
            try {
                const res = await axios.patch(`/api/products/${product.id}/toggle-active`);
                if (res.data.success) {
                    Swal.fire('Updated!', `Product has been successfully ${actionPast}.`, 'success');
                    loadAllProducts(false);
                }
            } catch (err) {
                console.error(err);
                Swal.fire('Error', `Failed to ${action.toLowerCase()} the product.`, 'error');
            }
        }
    };

    const handleDelete = async (product) => {
        const id = product.id;
        const result = await Swal.fire({
            title: 'Delete this product?',
            text: "This action will remove the item from the inventory. Note: Items with sales history cannot be deleted.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#1B3A69',
            cancelButtonColor: '#d33',
            confirmButtonText: 'Confirm Delete'
        });

        if (result.isConfirmed) {
            try {
                await axios.delete(`/api/products/${id}`);
                loadAllProducts(false); // Silent reload
                Swal.fire('Deleted!', 'Product successfully removed.', 'success');
            } catch (error) {
                const isLinked = error.response?.data?.error === 'linked_to_transactions';
                const serverMessage = error.response?.data?.message || error.response?.data?.error;
                
                if (isLinked) {
                    if (!product.is_active) {
                        Swal.fire({
                            title: 'Cannot Delete Product',
                            text: 'This product has sales history and is already archived. It cannot be permanently deleted for auditing purposes.',
                            icon: 'info',
                            confirmButtonColor: '#1B3A69'
                        });
                    } else {
                        const archiveResult = await Swal.fire({
                            title: 'Cannot Delete Product',
                            text: 'This product has sales history and cannot be permanently deleted. Would you like to Archive it instead to hide it from the POS terminal?',
                            icon: 'info',
                            showCancelButton: true,
                            confirmButtonColor: '#1B3A69',
                            cancelButtonColor: '#d33',
                            confirmButtonText: 'Yes, Archive it!',
                            cancelButtonText: 'No'
                        });

                        if (archiveResult.isConfirmed) {
                            try {
                                const res = await axios.patch(`/api/products/${id}/toggle-active`);
                                if (res.data.success) {
                                    Swal.fire('Archived!', 'The product has been archived successfully.', 'success');
                                    loadAllProducts(false);
                                }
                            } catch (e) {
                                Swal.fire('Error', 'Failed to archive the product.', 'error');
                            }
                        }
                    }
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Deletion Restricted',
                        text: serverMessage || "This product is linked to sales records and cannot be deleted for auditing purposes.",
                        footer: '<b>Solution:</b> Set stock to 0 or archive the product instead.'
                    });
                }
            }
        }
    };

    return (
        <AuthenticatedLayout user={user} header={
            <div>
                <h2 className="font-black text-xl text-gray-900 tracking-tight">Inventory Management</h2>
                <p className="text-xs font-semibold text-gray-500 mt-0.5">
                    {isAdmin
                        ? 'Manage stock levels, product valuations, and barcode tracking'
                        : 'Monitor stock levels, availability, and barcode tracking'}
                </p>
            </div>
        }>
            <Head title="Inventory Management" />

            <div className="py-3 sm:py-6 bg-gray-50/80 min-h-0 sm:min-h-[calc(100vh-140px)] max-w-full overflow-x-clip">
                <div className="w-full max-w-full px-3.5 sm:px-6 lg:px-8 space-y-4 sm:space-y-6">

                    {/* 1. EXECUTIVE INVENTORY HEALTH KPI STRIP */}
                    <div className={`grid ${isAdmin ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-3 lg:grid-cols-3'} gap-2.5 sm:gap-4`}>
                        {/* KPI 1: Inventory Valuation (Admin Only) */}
                        {isAdmin && (
                            <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                        <p className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-wider truncate">Retail Value</p>
                                        <h3 className="text-base sm:text-2xl font-black text-gray-900 tracking-tight truncate">{formatCurrency(stats.totalRetailValue)}</h3>
                                    </div>
                                    <div className="p-2 sm:p-2.5 bg-[#EFF4F9] text-[#1B3B6A] rounded-none ring-1 ring-[#CBD7E6] shrink-0">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                    </div>
                                </div>
                                <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                    <span className="truncate">Total Cost</span>
                                    <span className="font-bold text-gray-700 truncate shrink-0">{formatCurrency(stats.totalInventoryCost)}</span>
                                </div>
                            </div>
                        )}

                        {/* KPI 2: Stock Units Volume */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-gray-500 uppercase tracking-wider truncate">Total In Stock</p>
                                    <h3 className="text-base sm:text-2xl font-black text-gray-900 tracking-tight truncate">{stats.totalStockUnits.toLocaleString()} <span className="text-xs font-semibold text-gray-400">units</span></h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-blue-50 text-blue-600 rounded-none ring-1 ring-blue-100 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100 flex items-center justify-between text-[10px] sm:text-xs text-gray-500 font-semibold gap-1">
                                <span className="truncate">Active Products</span>
                                <span className="font-bold text-gray-700 truncate shrink-0">{stats.activeCount} items</span>
                            </div>
                        </div>

                        {/* KPI 3: Low Stock Warning */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-amber-700 uppercase tracking-wider truncate">Low Stock</p>
                                    <h3 className="text-base sm:text-2xl font-black text-amber-900 tracking-tight truncate">{stats.lowStockCount} <span className="text-xs font-semibold text-amber-600">items</span></h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-amber-100/70 text-amber-700 rounded-none ring-1 ring-amber-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-amber-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-amber-700 gap-1">
                                <span className="truncate">Warning Level</span>
                                <span className="font-bold text-amber-800 truncate shrink-0">≤ 10 units</span>
                            </div>
                        </div>

                        {/* KPI 4: Out of Stock */}
                        <div className="bg-white p-3.5 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs relative overflow-hidden group hover:shadow-md transition-all duration-300 flex flex-col justify-between h-full">
                            <div className="flex justify-between items-start gap-2">
                                <div className="space-y-0.5 sm:space-y-1 min-w-0">
                                    <p className="text-[10px] sm:text-[11px] font-black text-rose-700 uppercase tracking-wider truncate">Out of Stock</p>
                                    <h3 className="text-base sm:text-2xl font-black text-rose-900 tracking-tight truncate">{stats.outOfStockCount} <span className="text-xs font-semibold text-rose-600">items</span></h3>
                                </div>
                                <div className="p-2 sm:p-2.5 bg-rose-100/70 text-rose-700 rounded-none ring-1 ring-rose-200 shrink-0">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                    </svg>
                                </div>
                            </div>
                            <div className="mt-2.5 sm:mt-3 pt-2 sm:pt-3 border-t border-rose-100 flex items-center justify-between text-[10px] sm:text-xs font-semibold text-rose-700 gap-1">
                                <span className="truncate">Depleted</span>
                                <span className="font-bold text-rose-800 truncate shrink-0">0 units</span>
                            </div>
                        </div>
                    </div>

                    {/* 2. INVENTORY WORKSPACE: CONNECTED TABS + MAIN CONTENT CARD */}
                    <div ref={workspaceSectionRef} className="flex flex-col scroll-mt-4">
                        {/* Interactive Pipeline Status Tabs */}
                        <div className="w-full max-w-full overflow-x-auto overflow-y-hidden no-scrollbar scroll-smooth -mb-px relative z-20 pt-1">
                            <div ref={pipelineTabsRef} className="flex flex-nowrap items-end gap-1 sm:gap-1.5 px-3 w-max min-w-full">
                                {/* All Catalog */}
                                <button
                                    data-tab="all"
                                    onClick={() => handleStockTabChange('all')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        stockTab === 'all'
                                            ? 'bg-white text-[#1B3B6A] font-black border-t-[#1B3B6A] border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {stockTab === 'all' && (
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
                                    <span>All Catalog</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        stockTab === 'all' 
                                            ? 'bg-[#1B3B6A] text-white shadow-2xs' 
                                            : 'bg-gray-200/80 text-gray-600 group-hover:bg-gray-300 group-hover:text-gray-800'
                                    }`}>
                                        {stats.totalProducts}
                                    </span>
                                </button>

                                {/* Healthy In Stock */}
                                <button
                                    data-tab="in_stock"
                                    onClick={() => handleStockTabChange('in_stock')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        stockTab === 'in_stock'
                                            ? 'bg-white text-emerald-800 font-black border-t-emerald-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {stockTab === 'in_stock' && (
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
                                    <span>Healthy In Stock</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        stockTab === 'in_stock' 
                                            ? 'bg-emerald-600 text-white shadow-2xs' 
                                            : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                                    }`}>
                                        {stats.healthyStockCount}
                                    </span>
                                </button>

                                {/* Low Stock Alerts */}
                                <button
                                    data-tab="low_stock"
                                    onClick={() => handleStockTabChange('low_stock')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        stockTab === 'low_stock'
                                            ? 'bg-white text-amber-900 font-black border-t-amber-500 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {stockTab === 'low_stock' && (
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
                                    <span>Low Stock Alerts</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        stockTab === 'low_stock' 
                                            ? 'bg-amber-500 text-white shadow-2xs' 
                                            : 'bg-amber-50 text-amber-700 group-hover:bg-amber-100'
                                    }`}>
                                        {stats.lowStockCount}
                                    </span>
                                </button>

                                {/* Out of Stock */}
                                <button
                                    data-tab="out_of_stock"
                                    onClick={() => handleStockTabChange('out_of_stock')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        stockTab === 'out_of_stock'
                                            ? 'bg-white text-rose-900 font-black border-t-rose-600 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {stockTab === 'out_of_stock' && (
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
                                    <span>Out of Stock</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        stockTab === 'out_of_stock' 
                                            ? 'bg-rose-600 text-white shadow-2xs' 
                                            : 'bg-rose-50 text-rose-700 group-hover:bg-rose-100'
                                    }`}>
                                        {stats.outOfStockCount}
                                    </span>
                                </button>

                                {/* Archived Items */}
                                <button
                                    data-tab="archived"
                                    onClick={() => handleStockTabChange('archived')}
                                    className={`group px-3.5 sm:px-4 py-2.5 sm:py-3 rounded-none text-xs sm:text-sm transition-all duration-200 flex items-center gap-2 whitespace-nowrap shrink-0 border-t-2 border-x relative cursor-pointer ${
                                        stockTab === 'archived'
                                            ? 'bg-white text-slate-900 font-black border-t-slate-700 border-x-gray-200/90 shadow-xs z-20'
                                            : 'bg-gray-100/70 hover:bg-gray-100 text-gray-500 hover:text-gray-800 font-bold border-transparent'
                                    }`}
                                >
                                    {stockTab === 'archived' && (
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
                                    <span>Archived Items</span>
                                    <span className={`px-2 py-0.5 rounded-none text-[10px] sm:text-[11px] font-black transition-all ${
                                        stockTab === 'archived' 
                                            ? 'bg-slate-700 text-white shadow-2xs' 
                                            : 'bg-slate-100 text-slate-700 group-hover:bg-slate-200'
                                    }`}>
                                        {stats.archivedCount}
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
                                            placeholder="Search by SKU, product name, barcode..."
                                            className="pl-11 pr-10 py-2.5 bg-gray-50/70 border border-gray-200 rounded-none w-full focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 focus:bg-white text-sm font-medium transition-all shadow-2xs"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                        <svg className="w-5 h-5 text-gray-400 absolute left-3.5 top-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                        {searchTerm && (
                                            <button onClick={() => setSearchTerm('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 p-0.5">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
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
                                            title="Card View"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25h-2.25a2.25 2.25 0 01-2.25-2.25v-2.25z" /></svg>
                                            <span className="hidden sm:inline">Cards</span>
                                        </button>
                                    </div>

                                    {/* Category & Sort Dropdowns */}
                                    <div className="grid grid-cols-2 sm:flex sm:flex-nowrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto shrink-0">
                                        <select
                                            value={filterCategory}
                                            onChange={(e) => setFilterCategory(e.target.value)}
                                            className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs w-full sm:w-[160px] lg:w-[175px] shrink-0"
                                        >
                                            <option value="">All Categories ({categories.length})</option>
                                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>

                                        <select
                                            value={sortBy}
                                            onChange={(e) => setSortBy(e.target.value)}
                                            className="bg-gray-50/70 border border-gray-200 rounded-none py-2.5 pl-3 pr-7 sm:pl-3.5 sm:pr-8 focus:border-[#1B3B6A] focus:ring-2 focus:ring-[#1B3B6A]/10 text-gray-700 text-xs sm:text-sm font-semibold transition-all shadow-2xs w-full sm:w-[160px] lg:w-[175px] shrink-0"
                                        >
                                            <option value="newest">Sort: Default</option>
                                            <option value="created_desc">Sort: Newest Added</option>
                                            <option value="created_asc">Sort: Oldest Added</option>
                                            <option value="name_asc">Sort: Name (A-Z)</option>
                                            <option value="name_desc">Sort: Name (Z-A)</option>
                                            <option value="stock_desc">Sort: Stock (High to Low)</option>
                                            <option value="stock_asc">Sort: Stock (Low to High)</option>
                                            <option value="price_desc">Sort: Price (High to Low)</option>
                                            <option value="price_asc">Sort: Price (Low to High)</option>
                                            <option value="margin_desc">Sort: Margin (High to Low)</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* Tier 2: Action Buttons & Tools Strip (Admin Only) */}
                            {isAdmin && (
                                <div className="pt-2.5 border-t border-gray-100 pb-0.5 relative z-20">
                                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 w-full">
                                        
                                        {/* Left Side: Section Label (Desktop Only) */}
                                        <div className="hidden lg:block">
                                            <span className="text-xs font-black text-gray-800 uppercase tracking-wider">Inventory Actions</span>
                                        </div>

                                        {/* Right Side / Mobile & Tablet Actions Grid */}
                                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:flex lg:w-auto items-center gap-2 w-full shrink-0 justify-end">
                                            {/* 1. Categories */}
                                            <button
                                                onClick={() => setShowCategoryManager(true)}
                                                className="w-full lg:w-auto justify-center px-3.5 py-2.5 rounded-none font-bold text-xs sm:text-sm bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-gray-500"><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.386l4.248-2.493c.827-.486 1.055-1.545.474-2.308l-8.62-11.23a2.25 2.25 0 00-1.781-.845z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>
                                                <span>Categories</span>
                                            </button>

                                            {/* 2. Activity Feed */}
                                            <button
                                                onClick={openRecentActivity}
                                                className="w-full lg:w-auto justify-center px-3.5 py-2.5 rounded-none font-bold text-xs sm:text-sm bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0"
                                                title="View Recent Store Stock Activity & History"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <span>Activity Feed</span>
                                            </button>

                                            {/* 3. Data & Export Dropdown */}
                                            <div className="relative data-menu-container w-full lg:w-auto shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={() => setShowDataMenu(!showDataMenu)}
                                                    className="w-full lg:w-auto justify-center px-3.5 py-2.5 rounded-none font-bold text-xs sm:text-sm bg-[#EFF4F9] text-[#1B3B6A] hover:bg-[#E2ECF6] border border-[#CBD7E6] shadow-2xs transition-all active:scale-95 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                                    <span>Data & Export</span>
                                                    <svg className={`w-3.5 h-3.5 ml-0.5 text-gray-500 transition-transform duration-200 ${showDataMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7" /></svg>
                                                </button>

                                                {showDataMenu && (
                                                    <div className="absolute left-0 lg:left-auto lg:right-0 top-full mt-2 w-full sm:w-56 bg-white rounded-none shadow-2xl border border-gray-100 py-2 z-50 animate-in fade-in zoom-in-95 duration-150">
                                                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Data Import</div>
                                                        <button
                                                            onClick={() => { setShowDataMenu(false); document.getElementById('excel-import-input').click(); }}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                                                            Import Excel / CSV
                                                        </button>
                                                        <button
                                                            onClick={() => { setShowDataMenu(false); downloadTemplate(); }}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-blue-600"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                                            Download Template
                                                        </button>
                                                        <div className="border-t border-gray-100 my-1.5"></div>
                                                        <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400">Reports & Export</div>
                                                        <button
                                                            onClick={() => { setShowDataMenu(false); exportExcel(); }}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                            >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-emerald-600"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
                                                            Export to Excel (.xlsx)
                                                        </button>
                                                        <button
                                                            onClick={() => { setShowDataMenu(false); exportPDF(); }}
                                                            className="w-full px-4 py-2 text-left text-xs font-bold text-gray-700 hover:bg-gray-50 flex items-center gap-2.5 transition-colors"
                                                        >
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-rose-600"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                                            Export to PDF Document
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <input
                                                id="excel-import-input"
                                                type="file"
                                                accept=".xlsx,.xls,.csv"
                                                className="hidden"
                                                onChange={handleImport}
                                            />

                                            {/* 4. Add Product */}
                                            <button
                                                onClick={openAddModal}
                                                className="w-full lg:w-auto justify-center px-3.5 sm:px-4 py-2.5 bg-[#1B3B6A] hover:bg-[#142E54] text-white rounded-none font-bold shadow-md shadow-[#1B3B6A]/15 active:scale-95 transition-all text-xs sm:text-sm flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                <span>Add Product</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 3. Main Content: Table View (Desktop Only when viewMode === 'table') */}
                        {viewMode === 'table' && (
                            <div className="hidden lg:block bg-white overflow-hidden">
                                <div className="overflow-x-auto custom-scrollbar">
                                    <table className="w-full text-left min-w-[1050px]">
                                        <thead className="bg-gray-50/80 border-b border-gray-200/80 text-gray-500 uppercase text-[10px] font-black tracking-wider whitespace-nowrap">
                                            <tr>
                                                <th className="p-4 w-12 text-center whitespace-nowrap">
                                                    <input
                                                        type="checkbox"
                                                        onChange={handleSelectAll}
                                                        checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedIds.includes(p.id))}
                                                        className="w-4 h-4 text-[#1B3B6A] border-gray-300 rounded focus:ring-[#1B3B6A] cursor-pointer"
                                                    />
                                                </th>
                                                <th className="p-4 w-36 whitespace-nowrap">SKU / Barcode</th>
                                                <th className="p-4 min-w-[220px] whitespace-nowrap">Product Details</th>
                                                <th className="p-4 whitespace-nowrap">Category</th>
                                                {isAdmin && (
                                                    <th className="p-4 text-right whitespace-nowrap">Cost Price</th>
                                                )}
                                                <th className="p-4 text-right whitespace-nowrap">Retail & Wholesale</th>
                                                <th className="p-4 text-center whitespace-nowrap">Stock Level</th>
                                                <th className="p-4 text-center w-36 whitespace-nowrap">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {loading ? (
                                                Array.from({ length: 6 }).map((_, index) => (
                                                    <tr key={`skel-${index}`} className="animate-pulse">
                                                        <td className="p-4 text-center whitespace-nowrap"><div className="w-4 h-4 bg-gray-200 rounded mx-auto"></div></td>
                                                        <td className="p-4 whitespace-nowrap"><div className="h-6 bg-gray-200 rounded w-24"></div></td>
                                                        <td className="p-4 flex items-center gap-3 whitespace-nowrap">
                                                            <div className="w-10 h-10 bg-gray-200 rounded-lg shrink-0"></div>
                                                            <div className="space-y-1.5 flex-1">
                                                                <div className="h-4 bg-gray-200 rounded w-32"></div>
                                                                <div className="h-3 bg-gray-200 rounded w-20"></div>
                                                            </div>
                                                        </td>
                                                        <td className="p-4 whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-16"></div></td>
                                                        {isAdmin && (
                                                            <td className="p-4 text-right whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-16 ml-auto"></div></td>
                                                        )}
                                                        <td className="p-4 text-right whitespace-nowrap"><div className="h-4 bg-gray-200 rounded w-20 ml-auto"></div></td>
                                                        <td className="p-4 text-center whitespace-nowrap"><div className="h-6 bg-gray-200 rounded-full w-16 mx-auto"></div></td>
                                                        <td className="p-4 text-center whitespace-nowrap"><div className="h-7 bg-gray-200 rounded w-24 mx-auto"></div></td>
                                                    </tr>
                                                ))
                                            ) : paginatedProducts.length === 0 ? (
                                                <tr>
                                                    <td colSpan={isAdmin ? 8 : 7} className="py-8 px-4 sm:py-10 text-center text-gray-500 font-bold whitespace-nowrap">
                                                        <div className="max-w-xs mx-auto flex flex-col items-center">
                                                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 mb-2">
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                                            </div>
                                                            <p className="text-gray-900 font-black text-sm">No items found</p>
                                                            <p className="text-gray-400 text-xs mt-0.5">Try changing your search terms, categories, or filters.</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : (
                                                paginatedProducts.map((p) => {
                                                    const isSelected = selectedIds.includes(p.id);
                                                    const qty = Number(p.stock_quantity) || 0;
                                                    const isLow = qty > 0 && qty <= 10;
                                                    const isOut = qty <= 0;

                                                    return (
                                                        <tr
                                                            key={p.id}
                                                            className={`transition-colors whitespace-nowrap ${
                                                                isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50/60'
                                                            }`}
                                                        >
                                                            {/* Checkbox */}
                                                            <td className="p-4 text-center whitespace-nowrap">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isSelected}
                                                                    onChange={() => handleToggleSelect(p.id)}
                                                                    className="w-4 h-4 text-[#1B3B6A] border-gray-300 rounded-none focus:ring-[#1B3B6A] cursor-pointer"
                                                                />
                                                            </td>

                                                            {/* SKU / Barcode */}
                                                            <td className="p-4 whitespace-nowrap">
                                                                <span className="font-mono text-sm font-semibold text-gray-800 whitespace-nowrap">
                                                                    {p.sku || '—'}
                                                                </span>
                                                            </td>

                                                            {/* Product Details */}
                                                            <td className="p-4 whitespace-nowrap">
                                                                <div className="flex items-center gap-3 whitespace-nowrap">
                                                                    <div className="w-11 h-11 bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 shadow-2xs">
                                                                        {p.image_path ? (
                                                                            <img src={p.image_path} className="w-full h-full object-cover" loading="lazy" decoding="async" alt={p.name} />
                                                                        ) : (
                                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-gray-400"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                                                                        )}
                                                                    </div>
                                                                    <div className="min-w-0">
                                                                        <div className="font-bold text-gray-900 text-sm hover:underline cursor-pointer truncate max-w-[280px]" onClick={() => isAdmin && openEditModal(p)} title={p.name}>
                                                                            {p.name}
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-400 font-medium">
                                                                            Added: {formatDateTime(p.created_at)}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            {/* Category */}
                                                            <td className="p-4 whitespace-nowrap">
                                                                {p.category ? (
                                                                    <span className="px-2.5 py-1 rounded-none text-xs font-bold bg-gray-100 text-gray-700 whitespace-nowrap">
                                                                        {p.category.name}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-gray-400 italic text-xs whitespace-nowrap">General</span>
                                                                )}
                                                            </td>

                                                            {/* Cost Price (Admin Only) */}
                                                            {isAdmin && (
                                                                <td className="p-4 text-right whitespace-nowrap">
                                                                    <div className="font-bold text-gray-700 text-sm whitespace-nowrap">
                                                                        {p.cost_price ? formatCurrency(p.cost_price) : '—'}
                                                                    </div>
                                                                </td>
                                                            )}

                                                            {/* Retail & Wholesale Price */}
                                                            <td className="p-4 text-right whitespace-nowrap">
                                                                <div className="font-black text-gray-900 text-base whitespace-nowrap">
                                                                    {formatCurrency(productRetailPrice(p))}
                                                                    {productPriceUnitSuffix(p) && <span className="text-xs font-bold text-gray-500">{productPriceUnitSuffix(p)}</span>}
                                                                </div>
                                                                {productWholesalePrice(p) > 0 && (
                                                                    <div className="text-[10px] text-gray-500 font-bold mt-0.5 whitespace-nowrap" title="Wholesale Price">WS: {formatCurrency(productWholesalePrice(p))}{productPriceUnitSuffix(p)}</div>
                                                                )}
                                                                {p.selling_method === 'multiple' && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); setUnitsViewProduct(p); }}
                                                                        className="block ml-auto text-[10px] text-[#1B3B6A] font-bold mt-0.5 whitespace-nowrap underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-[#142E54]"
                                                                        title="View selling units"
                                                                    >
                                                                        {p.units?.length || 0} selling unit{(p.units?.length || 0) === 1 ? '' : 's'}
                                                                    </button>
                                                                )}
                                                            </td>

                                                            {/* Stock Status */}
                                                            <td className="p-4 whitespace-nowrap text-center">
                                                                <span className={`inline-flex items-center px-3 py-1 rounded-none text-xs font-black tracking-wider uppercase border shadow-2xs whitespace-nowrap ${
                                                                    isOut 
                                                                        ? 'bg-rose-50 text-rose-700 border-rose-200' 
                                                                        : isLow 
                                                                        ? 'bg-amber-50 text-amber-700 border-amber-200' 
                                                                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                                }`}>
                                                                    {formatProductQty(p, qty)}{p.selling_method === 'multiple' ? ` ${productUnitLabel(p)}` : ''} Left
                                                                </span>
                                                            </td>

                                                            {/* Actions */}
                                                            <td className="p-4 text-center whitespace-nowrap">
                                                                <div className="flex items-center justify-center gap-1 whitespace-nowrap">
                                                                    {/* Quick Restock (Admin Only) */}
                                                                    {isAdmin && (
                                                                        <button
                                                                            onClick={() => handleQuickAdd(p)}
                                                                            className="p-1.5 text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                            title="Restock Inventory"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                                        </button>
                                                                    )}

                                                                    {/* Stock History Ledger (Admin Only) */}
                                                                    {isAdmin && (
                                                                        <button
                                                                            onClick={() => openStockHistory(p)}
                                                                            className="p-1.5 text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                            title="View Stock Movement & Sales History"
                                                                        >
                                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                        </button>
                                                                    )}

                                                                    {/* Print Label */}
                                                                    <button
                                                                        onClick={() => setPrintState({ isOpen: true, product: p, quantity: 1, mode: 'thermal' })}
                                                                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                        title="Print Barcode Label"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                                                    </button>

                                                                    {/* Save PNG Barcode */}
                                                                    <button
                                                                        onClick={() => downloadLabelImage(p, settings?.store_name || 'POS STORE')}
                                                                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                        title="Save PNG Barcode"
                                                                    >
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                                                    </button>

                                                                    {isAdmin && (
                                                                        <>
                                                                            {/* Edit Product */}
                                                                            <button
                                                                                onClick={() => openEditModal(p)}
                                                                                className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                                title="Edit Product"
                                                                            >
                                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
                                                                            </button>

                                                                            {/* Archive / Restore */}
                                                                            <button
                                                                                onClick={() => handleToggleActive(p)}
                                                                                className={`p-1.5 rounded-none transition-colors inline-flex items-center justify-center active:scale-95 ${p.is_active ? 'text-amber-600 hover:text-amber-800 hover:bg-amber-50' : 'text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50'}`}
                                                                                title={p.is_active ? "Archive Product" : "Restore Product"}
                                                                            >
                                                                                {p.is_active ? (
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                                                                ) : (
                                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                                                                                )}
                                                                            </button>

                                                                            {/* Delete Product */}
                                                                            <button
                                                                                onClick={() => handleDelete(p)}
                                                                                className="p-1.5 text-red-600 hover:text-red-800 hover:bg-red-50 rounded-none transition-colors inline-flex items-center justify-center active:scale-95"
                                                                                title="Delete Product"
                                                                            >
                                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                                                            </button>
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

                        {/* 4. Responsive Card View (Mobile/Tablet always, and Laptop/Desktop when viewMode === 'grid') */}
                        <div className={`${viewMode === 'table' ? 'lg:hidden' : 'block'} p-3.5 sm:p-4 bg-gray-50/40 border-t lg:border-t-0 border-gray-100`}>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3.5 sm:gap-4">
                                {loading ? (
                                    Array.from({ length: 4 }).map((_, index) => (
                                        <div key={`mob-skel-${index}`} className="bg-white p-4 rounded-none border border-gray-200/80 shadow-2xs flex flex-col gap-3 animate-pulse">
                                            <div className="flex gap-3.5">
                                                <div className="w-20 h-20 bg-gray-200 rounded-none shrink-0"></div>
                                                <div className="flex-1 flex flex-col justify-center gap-2">
                                                    <div className="h-4 bg-gray-200 rounded-none w-3/4"></div>
                                                    <div className="h-3 bg-gray-200 rounded-none w-1/3 mt-1"></div>
                                                    <div className="flex justify-between items-end mt-1">
                                                        <div className="h-5 bg-gray-200 rounded-none w-1/3"></div>
                                                        <div className="h-4 bg-gray-200 rounded-none w-1/4"></div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : paginatedProducts.length === 0 ? (
                                    <div className="col-span-full bg-white py-8 px-4 rounded-none border border-gray-200/80 text-center text-gray-500 font-bold">
                                        <div className="max-w-xs mx-auto flex flex-col items-center">
                                            <div className="w-10 h-10 bg-gray-100 rounded-none flex items-center justify-center text-gray-400 mb-2">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                            </div>
                                            <p className="text-gray-900 font-black text-sm">No items found</p>
                                            <p className="text-gray-400 text-xs mt-0.5">Try changing your search terms, categories, or filters.</p>
                                        </div>
                                    </div>
                                ) : (
                                    paginatedProducts.map((p) => {
                                        const qty = Number(p.stock_quantity) || 0;
                                        const isLow = qty > 0 && qty <= 10;
                                        const isOut = qty <= 0;
                                        const isSelected = selectedIds.includes(p.id);

                                        return (
                                            <div 
                                                key={p.id} 
                                                className={`bg-white rounded-none border shadow-2xs p-3.5 sm:p-4 flex flex-col justify-between gap-3 hover:shadow-md transition-all ${
                                                    isSelected ? 'border-[#1B3B6A] ring-2 ring-[#1B3B6A]/20' : 'border-gray-200/80'
                                                }`}
                                            >
                                                <div className="flex gap-3 sm:gap-3.5">
                                                    <div className="relative w-20 h-20 sm:w-24 sm:h-24 bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center overflow-hidden shrink-0">
                                                        {p.image_path ? (
                                                            <img src={p.image_path} className="w-full h-full object-cover" loading="lazy" alt={p.name} />
                                                        ) : (
                                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-gray-400"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                                                        )}
                                                        <div className="absolute top-1.5 left-1.5">
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={() => handleToggleSelect(p.id)}
                                                                className="w-4 h-4 text-[#1B3B6A] border-gray-300 rounded-none shadow-xs cursor-pointer bg-white"
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                        <div>
                                                            <div className="flex items-center justify-between gap-1">
                                                                {p.category ? (
                                                                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider truncate">{p.category.name}</span>
                                                                ) : (
                                                                    <span className="text-[10px] font-medium text-gray-400 italic">General</span>
                                                                )}
                                                                {!p.is_active && (
                                                                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-none text-[8px] font-black tracking-wider uppercase bg-slate-100 text-slate-500 border border-slate-200">
                                                                        Archived
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <h3 className="font-bold text-gray-900 text-sm sm:text-base leading-tight tracking-tight line-clamp-2 mt-0.5" title={p.name}>
                                                                {p.name}
                                                            </h3>
                                                            <div className="text-[10px] text-gray-400 font-medium mt-0.5 truncate">
                                                                Added: {formatDateTime(p.created_at)}
                                                            </div>
                                                        </div>
                                                        <div className="flex justify-between items-end mt-2 pt-1 border-t border-gray-50">
                                                            <div className="flex flex-col">
                                                                <p className="font-black text-gray-900 text-base sm:text-lg tracking-tight">
                                                                    {formatCurrency(productRetailPrice(p))}
                                                                    {productPriceUnitSuffix(p) && <span className="text-xs font-bold text-gray-500">{productPriceUnitSuffix(p)}</span>}
                                                                </p>
                                                                <span className="text-[10px] sm:text-[11px] font-bold text-gray-500" title="Wholesale Price">
                                                                    WS: {formatCurrency(productWholesalePrice(p))}{productPriceUnitSuffix(p)}
                                                                </span>
                                                                {p.selling_method === 'multiple' && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={(e) => { e.stopPropagation(); setUnitsViewProduct(p); }}
                                                                        className="self-start text-left text-[10px] font-bold text-[#1B3B6A] underline decoration-dotted underline-offset-2 hover:decoration-solid hover:text-[#142E54]"
                                                                        title="View selling units"
                                                                    >
                                                                        {p.units?.length || 0} selling unit{(p.units?.length || 0) === 1 ? '' : 's'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                            <span className={`px-2 py-0.5 rounded-none text-[10px] font-black uppercase tracking-wider ${isOut ? 'bg-rose-100 text-rose-700' : isLow ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                                {formatProductQty(p, qty)}{p.selling_method === 'multiple' ? ` ${productUnitLabel(p)}` : ''} Left
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Barcode & Optional Cost */}
                                                <div className="flex justify-between items-center bg-gray-50/80 px-3 py-1.5 rounded-none border border-gray-100 text-xs">
                                                    <span className="font-mono text-xs font-bold text-gray-600 truncate">
                                                        Barcode: {p.sku || 'N/A'}
                                                    </span>
                                                    {isAdmin && p.cost_price && (
                                                        <span className="text-[11px] text-gray-500 font-bold shrink-0">Cost: {formatCurrency(p.cost_price)}</span>
                                                    )}
                                                </div>

                                                {/* All Product Actions in Card */}
                                                {isAdmin ? (
                                                    <div className="space-y-1.5 pt-0.5 border-t border-gray-100">
                                                        {/* Primary Actions Row (Admin) */}
                                                        <div className="grid grid-cols-3 gap-1.5">
                                                            {/* Restock */}
                                                            <button 
                                                                onClick={() => handleQuickAdd(p)} 
                                                                className="py-1.5 px-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-none border border-blue-200 flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                                title="Restock Inventory"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                                <span className="text-[11px]">Restock</span>
                                                            </button>

                                                            {/* Stock History Ledger */}
                                                            <button 
                                                                onClick={() => openStockHistory(p)} 
                                                                className="py-1.5 px-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-none border border-indigo-200 flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                                title="Stock Movement Ledger"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5 text-indigo-600"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                                <span className="text-[11px]">Ledger</span>
                                                            </button>

                                                            {/* Print Barcode */}
                                                            <button 
                                                                onClick={() => setPrintState({ isOpen: true, product: p, quantity: 1, mode: 'thermal' })} 
                                                                className="py-1.5 px-1.5 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                                title="Print Barcode Label"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                                                <span className="text-[11px]">Print Label</span>
                                                            </button>
                                                        </div>

                                                        {/* Secondary Actions Row (Admin) */}
                                                        <div className="flex items-center justify-between gap-1.5 pt-1">
                                                            {/* Save PNG Barcode */}
                                                            <button 
                                                                onClick={() => downloadLabelImage(p, settings?.store_name || 'POS STORE')} 
                                                                className="flex-1 py-1.5 px-2 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center gap-1 active:scale-95 transition-all"
                                                                title="Save Barcode as PNG Image"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                                                <span className="text-[11px]">Save PNG</span>
                                                            </button>

                                                            <div className="flex items-center gap-1.5">
                                                                {/* Edit Product */}
                                                                <button 
                                                                    onClick={() => openEditModal(p)} 
                                                                    className="p-1.5 text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center active:scale-95 transition-all"
                                                                    title="Edit Product Details"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
                                                                </button>

                                                                {/* Archive / Restore */}
                                                                <button
                                                                    onClick={() => handleToggleActive(p)}
                                                                    className={`p-1.5 rounded-none border transition-all active:scale-95 ${
                                                                        p.is_active 
                                                                            ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100' 
                                                                            : 'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                                                    }`}
                                                                    title={p.is_active ? "Archive Product" : "Restore Product"}
                                                                >
                                                                    {p.is_active ? (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                                                                    ) : (
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" /></svg>
                                                                    )}
                                                                </button>

                                                                {/* Delete Product */}
                                                                <button 
                                                                    onClick={() => handleDelete(p)} 
                                                                    className="p-1.5 text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-none border border-rose-200 flex items-center justify-center active:scale-95 transition-all"
                                                                    title="Delete Product"
                                                                >
                                                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    /* Cashier Card Actions: Clean single row with Print Label + Save PNG */
                                                    <div className="pt-1.5 border-t border-gray-100">
                                                        <div className="grid grid-cols-2 gap-1.5">
                                                            {/* Print Barcode */}
                                                            <button 
                                                                onClick={() => setPrintState({ isOpen: true, product: p, quantity: 1, mode: 'thermal' })} 
                                                                className="py-1.5 px-2 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                                                                title="Print Barcode Label"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                                                <span className="text-[11px]">Print Label</span>
                                                            </button>

                                                            {/* Save PNG Barcode */}
                                                            <button 
                                                                onClick={() => downloadLabelImage(p, settings?.store_name || 'POS STORE')} 
                                                                className="py-1.5 px-2 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-none border border-gray-200 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                                                                title="Save Barcode as PNG Image"
                                                            >
                                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3.5 h-3.5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>
                                                                <span className="text-[11px]">Save PNG</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>

                    {/* 5. SEPARATE PAGINATION (Outside main card, matching Transactions & Shift History) */}
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

                    {/* 6. FLOATING BULK SELECTION ACTION BAR */}
                    {selectedIds.length > 0 && (
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1B3B6A] text-white px-5 py-3.5 rounded-none shadow-2xl flex items-center gap-4 border border-[#142E54] animate-in slide-in-from-bottom-6 duration-200 max-w-lg w-[90%] sm:w-auto">
                            <div className="flex items-center gap-2">
                                <span className="bg-white/20 text-white font-black text-xs px-2.5 py-1 rounded-none">
                                    {selectedIds.length}
                                </span>
                                <span className="text-xs sm:text-sm font-bold whitespace-nowrap">Selected Items</span>
                            </div>

                            <div className="h-4 w-px bg-white/20"></div>

                            <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                                {isAdmin && (
                                    <button
                                        onClick={handleBulkArchive}
                                        className="px-3 py-1.5 rounded-none bg-white/10 hover:bg-white/20 text-xs font-bold transition-all active:scale-95 whitespace-nowrap"
                                    >
                                        Archive/Restore
                                    </button>
                                )}
                                <button
                                    onClick={() => setSelectedIds([])}
                                    className="p-1.5 rounded-none text-white/60 hover:text-white hover:bg-white/10 transition-all"
                                    title="Deselect All"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>
                    )}
            </div>
        </div>
    </div>

            {/* DUAL-MODE PRINT OPTIONS MODAL */}
            {printState.isOpen && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-opacity">
                    <div className="absolute inset-0" onClick={() => setPrintState({ ...printState, isOpen: false })}></div>
                    <div className="relative bg-white w-full max-w-sm rounded-none shadow-2xl p-6 animate-slide-up sm:animate-fade-in-up flex flex-col">
                        <div className="flex items-start justify-between border-b border-slate-100 pb-4 mb-4">
                            <div>
                                <h2 className="text-xl font-black tracking-tight text-slate-900">Print Labels</h2>
                                <p className="text-xs text-slate-500 mt-1 font-medium">{printState.product?.name}</p>
                            </div>
                            <button onClick={() => setPrintState({ ...printState, isOpen: false })} className="p-2 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="space-y-5">
                            {/* Quantity Input */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Number of Labels</label>
                                <input
                                    type="number"
                                    min="1" max="200"
                                    value={printState.quantity}
                                    onChange={(e) => setPrintState({ ...printState, quantity: parseInt(e.target.value) || 1 })}
                                    className="w-full bg-slate-50 border border-slate-300 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] py-2.5 text-lg font-bold text-center transition-colors text-slate-900"
                                />
                            </div>

                            {/* Mode Selector */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Printer Layout</label>
                                <div className="grid grid-cols-2 gap-3">
                                    <button
                                        onClick={() => setPrintState({ ...printState, mode: 'thermal' })}
                                        className={`flex flex-col items-center justify-center gap-2 p-3 border-2 rounded-none transition-all ${printState.mode === 'thermal' ? 'border-[#1B3B6A] bg-[#1B3B6A]/10 text-[#1B3B6A] font-extrabold' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                        <div className="text-center">
                                            <span className="block font-bold text-sm">Thermal Roll</span>
                                            <span className="block text-[9px] uppercase tracking-wider opacity-70 mt-0.5">40 x 20mm</span>
                                        </div>
                                    </button>

                                    <button
                                        onClick={() => setPrintState({ ...printState, mode: 'a4' })}
                                        className={`flex flex-col items-center justify-center gap-2 p-3 border-2 rounded-none transition-all ${printState.mode === 'a4' ? 'border-[#1B3B6A] bg-[#1B3B6A]/10 text-[#1B3B6A] font-extrabold' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'}`}
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                        <div className="text-center">
                                            <span className="block font-bold text-sm">A4 Sheet</span>
                                            <span className="block text-[9px] uppercase tracking-wider opacity-70 mt-0.5">Grid Layout</span>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="mt-6 pt-4 border-t border-slate-100 shrink-0">
                            <button onClick={executePrint} className="w-full py-3.5 bg-[#1B3B6A] text-white rounded-none hover:bg-[#142E54] font-black shadow-md active:scale-95 transition-all text-sm uppercase tracking-wider flex items-center justify-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5zm-3 0h.008v.008H15V10.5z" /></svg>
                                Print Now
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* DOWNLOAD TEMPLATE TYPE CHOOSER */}
            {showTemplateChooser && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
                    <div className="absolute inset-0" onClick={() => setShowTemplateChooser(false)}></div>
                    <div className="relative bg-white w-full sm:max-w-lg rounded-none shadow-2xl flex flex-col animate-slide-up sm:animate-fade-in-up">
                        <div className="flex items-start justify-between border-b border-slate-100 p-5">
                            <div>
                                <h2 className="text-lg font-black tracking-tight text-slate-900">Download Import Template</h2>
                                <p className="text-xs text-slate-500 mt-1 font-medium">Choose which template to download.</p>
                            </div>
                            <button onClick={() => setShowTemplateChooser(false)} className="p-2 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors" aria-label="Close">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        <div className="p-5 space-y-3">
                            <button
                                type="button"
                                onClick={() => generateTemplate(false)}
                                className="w-full text-left p-4 border-2 border-slate-200 hover:border-[#1B3B6A] hover:bg-[#1B3B6A]/5 rounded-none transition-all group"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="font-black text-sm text-slate-900 uppercase tracking-wide">Standard Template</h3>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-[#1B3B6A] opacity-60 group-hover:opacity-100">Download</span>
                                </div>
                                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                                    One sheet, 7 columns: SKU, Name, Category, Retail, Wholesale, Cost, Stock.
                                    For Standard products only.
                                </p>
                            </button>

                            <button
                                type="button"
                                onClick={() => generateTemplate(true)}
                                className="w-full text-left p-4 border-2 border-slate-200 hover:border-[#1B3B6A] hover:bg-[#1B3B6A]/5 rounded-none transition-all group"
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <h3 className="font-black text-sm text-slate-900 uppercase tracking-wide">Complete Template</h3>
                                    <span className="text-[10px] font-black uppercase tracking-wider text-[#1B3B6A] opacity-60 group-hover:opacity-100">Download</span>
                                </div>
                                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                                    Products sheet (10 columns) + Product Units sheet + Instructions.
                                    For Standard and Multiple UOM products, with examples.
                                </p>
                            </button>
                        </div>

                        <div className="px-5 pb-5 flex justify-end">
                            <button onClick={() => setShowTemplateChooser(false)} className="px-4 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 rounded-none">
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* IMPORT PREVIEW MODAL */}
            {importPreview && typeof document !== 'undefined' && createPortal(
                (() => {
                    const ip = importPreview;
                    const busy = ip.submitting;
                    const hasErrors = ip.errors.length > 0;
                    const existingCount = ip.products.filter(p => p.existingProduct).length;
                    const willUpdateStock = ip.overwrite && ip.updateStock;
                    const stockDiffers = (p) => p.stock_provided && Number(p.stock_quantity) !== Number(p.existingProduct?.stock_quantity);
                    const stockChanges = willUpdateStock ? ip.products.filter(p => p.existingProduct && stockDiffers(p)).length : 0;
                    const importCount = ip.products.length - (ip.overwrite ? 0 : existingCount);
                    const qty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
                    const money = (n) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                    const defaultUnitOf = (sku) => ip.units.find(u => u.sku === sku && u.is_default === 'yes');
                    const setOption = (patch) => !busy && setImportPreview(prev => ({ ...prev, ...patch, serverErrors: [] }));
                    const close = () => { if (!busy) setImportPreview(null); };
                    const MAX_ROWS = 300;

                    return (
                        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
                            <div className="absolute inset-0" onClick={close}></div>
                            <div className="relative bg-white w-full sm:max-w-5xl max-h-[95vh] sm:max-h-[90vh] rounded-none shadow-2xl flex flex-col animate-slide-up sm:animate-fade-in-up">
                                {/* Header */}
                                <div className="flex items-start justify-between border-b border-slate-100 p-5 shrink-0">
                                    <div className="min-w-0">
                                        <h2 className="text-lg font-black tracking-tight text-slate-900">Import Preview</h2>
                                        <p className="text-xs text-slate-500 mt-1 font-medium truncate">{ip.fileName}</p>
                                    </div>
                                    <button onClick={close} disabled={busy} className="p-2 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors disabled:opacity-40" aria-label="Close">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>

                                {/* Body */}
                                <div className="overflow-y-auto p-5 space-y-5">
                                    {/* Summary */}
                                    <div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            {[
                                                { label: 'Products in File', value: ip.summary.totalProducts, cls: 'bg-slate-50 border-slate-200 text-slate-900' },
                                                { label: 'New', value: ip.summary.newProducts, cls: 'bg-emerald-50 border-emerald-100 text-emerald-800' },
                                                { label: ip.overwrite ? 'To Update' : 'To Skip', value: existingCount, cls: ip.overwrite ? 'bg-blue-50 border-blue-100 text-blue-800' : 'bg-slate-100 border-slate-200 text-slate-600' },
                                                { label: 'Selling Units', value: ip.summary.totalUnits, cls: 'bg-indigo-50 border-indigo-100 text-indigo-800' },
                                            ].map(card => (
                                                <div key={card.label} className={`p-3 border rounded-none ${card.cls}`}>
                                                    <p className="text-2xl font-black">{card.value}</p>
                                                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{card.label}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-2">
                                            {ip.summary.standardProducts} Standard · {ip.summary.multipleUomProducts} Multiple UOM
                                        </p>
                                    </div>

                                    {/* File validation errors */}
                                    {hasErrors && (
                                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-none">
                                            <h4 className="font-black text-rose-900 text-[11px] uppercase tracking-wider mb-1">
                                                {ip.errors.length} problem{ip.errors.length === 1 ? '' : 's'} found — fix the file and import again
                                            </h4>
                                            <div className="max-h-40 overflow-y-auto text-xs text-rose-800 font-mono space-y-0.5">
                                                {ip.errors.map((e, i) => <div key={i}>{e}</div>)}
                                            </div>
                                        </div>
                                    )}

                                    {/* Errors returned by the server */}
                                    {ip.serverErrors?.length > 0 && (
                                        <div className="p-3 bg-rose-50 border border-rose-200 rounded-none">
                                            <h4 className="font-black text-rose-900 text-[11px] uppercase tracking-wider mb-1">Import failed — nothing was saved</h4>
                                            <div className="max-h-40 overflow-y-auto text-xs text-rose-800 font-mono space-y-0.5">
                                                {ip.serverErrors.map((e, i) => <div key={i}>{e}</div>)}
                                            </div>
                                        </div>
                                    )}

                                    {ip.warnings.length > 0 && (
                                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-none">
                                            <h4 className="font-black text-amber-900 text-[11px] uppercase tracking-wider mb-1">Warnings</h4>
                                            <div className="max-h-32 overflow-y-auto text-xs text-amber-800 font-mono space-y-0.5">
                                                {ip.warnings.map((w, i) => <div key={i}>{w}</div>)}
                                            </div>
                                        </div>
                                    )}

                                    {/* Options for products that already exist */}
                                    {existingCount > 0 && (
                                        <div className="border border-slate-200 rounded-none p-4 space-y-3">
                                            <h4 className="font-black text-slate-900 text-[11px] uppercase tracking-wider">
                                                {existingCount} product{existingCount === 1 ? '' : 's'} already exist (same SKU)
                                            </h4>
                                            <div className="grid sm:grid-cols-2 gap-2">
                                                {[
                                                    { value: true, title: 'Update details', text: 'Name, category, prices, cost and selling units are replaced with the file values.' },
                                                    { value: false, title: 'Skip', text: 'Leave existing products unchanged. Only new products are imported.' },
                                                ].map(opt => (
                                                    <label key={String(opt.value)} className={`flex gap-3 p-3 border-2 cursor-pointer rounded-none transition-colors ${ip.overwrite === opt.value ? 'border-[#1B3B6A] bg-[#1B3B6A]/5' : 'border-slate-200 hover:border-slate-300'}`}>
                                                        <input
                                                            type="radio"
                                                            name="import-existing"
                                                            checked={ip.overwrite === opt.value}
                                                            onChange={() => setOption({ overwrite: opt.value })}
                                                            disabled={busy}
                                                            className="mt-0.5 text-[#1B3B6A] focus:ring-[#1B3B6A]"
                                                        />
                                                        <span>
                                                            <span className="block text-sm font-bold text-slate-900">{opt.title}</span>
                                                            <span className="block text-[11px] text-slate-500 mt-0.5 leading-relaxed">{opt.text}</span>
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>

                                            <label className={`flex gap-3 p-3 border rounded-none ${ip.overwrite ? 'cursor-pointer border-slate-200 hover:border-slate-300' : 'opacity-50 cursor-not-allowed border-slate-100'} ${willUpdateStock ? 'bg-amber-50 border-amber-300' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    checked={willUpdateStock}
                                                    onChange={(e) => setOption({ updateStock: e.target.checked })}
                                                    disabled={busy || !ip.overwrite}
                                                    className="mt-0.5 text-[#1B3B6A] focus:ring-[#1B3B6A] rounded-none"
                                                />
                                                <span>
                                                    <span className="block text-sm font-bold text-slate-900">Also update stock from the file</span>
                                                    <span className="block text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                                                        Use after a physical count. Each change is recorded as a stock adjustment in the stock ledger.
                                                        Blank stock cells are left unchanged.
                                                    </span>
                                                    {willUpdateStock && (
                                                        <span className="block text-[11px] font-bold text-amber-800 mt-1.5">
                                                            {stockChanges > 0
                                                                ? `Stock will change on ${stockChanges} product${stockChanges === 1 ? '' : 's'} (see the Stock column).`
                                                                : 'No stock differences found — stock stays the same.'}
                                                        </span>
                                                    )}
                                                    {!willUpdateStock && ip.overwrite && (
                                                        <span className="block text-[11px] font-bold text-slate-600 mt-1.5">Existing stock is kept.</span>
                                                    )}
                                                </span>
                                            </label>
                                        </div>
                                    )}

                                    {/* Products */}
                                    <div>
                                        <h4 className="font-black text-slate-900 text-[11px] uppercase tracking-wider mb-2">Products</h4>
                                        <div className="overflow-x-auto border border-slate-200 max-h-80 overflow-y-auto">
                                            <table className="w-full text-xs">
                                                <thead className="bg-[#1B3A69] text-white text-[10px] uppercase tracking-wider sticky top-0">
                                                    <tr>
                                                        <th className="text-left p-2.5 font-black">Row</th>
                                                        <th className="text-left p-2.5 font-black">SKU</th>
                                                        <th className="text-left p-2.5 font-black">Product</th>
                                                        <th className="text-left p-2.5 font-black">Category</th>
                                                        <th className="text-left p-2.5 font-black">Method</th>
                                                        <th className="text-right p-2.5 font-black">Retail / WS</th>
                                                        <th className="text-right p-2.5 font-black">Stock</th>
                                                        <th className="text-center p-2.5 font-black">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {ip.products.slice(0, MAX_ROWS).map((p, i) => {
                                                        const isMulti = p.selling_method === 'multiple';
                                                        const unitLabel = isMulti && p.base_unit ? ` ${p.base_unit}` : '';
                                                        const defUnit = isMulti ? defaultUnitOf(p.sku) : null;
                                                        const existing = p.existingProduct;
                                                        const action = !existing ? 'NEW' : (ip.overwrite ? 'UPDATE' : 'SKIP');
                                                        const actionCls = action === 'NEW' ? 'bg-emerald-100 text-emerald-800' : action === 'UPDATE' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-500';

                                                        let stockCell;
                                                        if (!existing) {
                                                            stockCell = <span className="text-slate-800">{qty(p.stock_quantity)}{unitLabel}</span>;
                                                        } else if (willUpdateStock && stockDiffers(p)) {
                                                            stockCell = (
                                                                <span className="font-bold text-amber-700 whitespace-nowrap">
                                                                    {qty(existing.stock_quantity)} → {qty(p.stock_quantity)}{unitLabel}
                                                                </span>
                                                            );
                                                        } else {
                                                            stockCell = (
                                                                <span className="text-slate-500 whitespace-nowrap" title="Current stock is kept">
                                                                    {qty(existing.stock_quantity)}{unitLabel} <span className="text-[10px]">(kept)</span>
                                                                </span>
                                                            );
                                                        }

                                                        return (
                                                            <tr key={`${p.rowNum}-${i}`} className={action === 'SKIP' ? 'opacity-60' : ''}>
                                                                <td className="p-2.5 text-slate-400 font-mono">{p.rowNum}</td>
                                                                <td className="p-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">{p.sku || '—'}</td>
                                                                <td className="p-2.5 text-slate-800 max-w-[220px] truncate" title={p.name}>{p.name || '—'}</td>
                                                                <td className="p-2.5 text-slate-600 whitespace-nowrap">{p.category_name || '—'}</td>
                                                                <td className="p-2.5 whitespace-nowrap">
                                                                    {isMulti
                                                                        ? <span className="text-purple-800 font-bold">Multiple UOM</span>
                                                                        : <span className="text-slate-600">Standard</span>}
                                                                </td>
                                                                <td className="p-2.5 text-right whitespace-nowrap text-slate-800">
                                                                    {isMulti
                                                                        ? (defUnit ? <>{money(defUnit.retail_price)} / {money(defUnit.wholesale_price)} <span className="text-slate-400">({defUnit.unit_name})</span></> : '—')
                                                                        : <>{money(p.price)} / {money(p.wholesale_price)}</>}
                                                                </td>
                                                                <td className="p-2.5 text-right">{stockCell}</td>
                                                                <td className="p-2.5 text-center">
                                                                    <span className={`px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${actionCls}`}>{action}</span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        {ip.products.length > MAX_ROWS && (
                                            <p className="text-[11px] text-slate-500 mt-1.5">Showing the first {MAX_ROWS} of {ip.products.length} rows. All rows will be imported.</p>
                                        )}
                                    </div>

                                    {/* Selling units */}
                                    {ip.units.length > 0 && (
                                        <div>
                                            <h4 className="font-black text-slate-900 text-[11px] uppercase tracking-wider mb-2">Selling Units ({ip.units.length})</h4>
                                            <div className="overflow-x-auto border border-slate-200 max-h-60 overflow-y-auto">
                                                <table className="w-full text-xs">
                                                    <thead className="bg-slate-100 text-slate-600 text-[10px] uppercase tracking-wider sticky top-0">
                                                        <tr>
                                                            <th className="text-left p-2.5 font-black">SKU</th>
                                                            <th className="text-left p-2.5 font-black">Unit</th>
                                                            <th className="text-right p-2.5 font-black">Conversion</th>
                                                            <th className="text-right p-2.5 font-black">Retail</th>
                                                            <th className="text-right p-2.5 font-black">Wholesale</th>
                                                            <th className="text-center p-2.5 font-black">Default</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {ip.units.slice(0, MAX_ROWS).map((u, i) => (
                                                            <tr key={`${u.rowNum}-${i}`} className={u.is_default === 'yes' ? 'bg-amber-50/60' : ''}>
                                                                <td className="p-2.5 font-mono font-bold text-slate-900 whitespace-nowrap">{u.sku}</td>
                                                                <td className="p-2.5 text-slate-800 whitespace-nowrap">{u.unit_name}</td>
                                                                <td className="p-2.5 text-right text-slate-600">× {qty(u.conversion_factor)}</td>
                                                                <td className="p-2.5 text-right text-slate-800">{money(u.retail_price)}</td>
                                                                <td className="p-2.5 text-right text-slate-600">{money(u.wholesale_price)}</td>
                                                                <td className="p-2.5 text-center">
                                                                    {u.is_default === 'yes' && <span className="px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">Default</span>}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="p-5 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-3 sm:items-center sm:justify-between shrink-0">
                                    <p className="text-[11px] text-slate-500">
                                        {hasErrors
                                            ? 'Import is disabled until the problems above are fixed.'
                                            : `${importCount} product${importCount === 1 ? '' : 's'} will be ${ip.overwrite && existingCount > 0 ? 'imported or updated' : 'imported'}.`}
                                    </p>
                                    <div className="flex gap-3 justify-end">
                                        <button onClick={close} disabled={busy} className="px-4 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 rounded-none disabled:opacity-40">
                                            Cancel
                                        </button>
                                        <button
                                            onClick={submitImport}
                                            disabled={hasErrors || busy || importCount === 0}
                                            className="px-5 py-2.5 bg-[#1B3B6A] text-white font-black text-xs uppercase tracking-wider hover:bg-[#142E54] rounded-none disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                                        >
                                            {busy && (
                                                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                                            )}
                                            {busy ? 'Importing...' : 'Confirm & Import'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })(),
                document.body
            )}

            {/* VIEW SELLING UNITS MODAL (Multiple UOM) */}
            {unitsViewProduct && typeof document !== 'undefined' && createPortal(
                (() => {
                    // Use the latest copy of the product (list re-polls every few seconds)
                    const vp = products.find(x => x.id === unitsViewProduct.id) || unitsViewProduct;
                    const units = [...(vp.units || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                    const baseUnit = vp.base_unit || 'base unit';
                    const fmtFactor = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 8 });
                    const close = () => setUnitsViewProduct(null);
                    return (
                        <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm sm:p-4">
                            <div className="absolute inset-0" onClick={close}></div>
                            <div className="relative bg-white w-full sm:max-w-2xl max-h-[90vh] rounded-none shadow-2xl flex flex-col animate-slide-up sm:animate-fade-in-up">
                                <div className="flex items-start justify-between border-b border-slate-100 p-5 shrink-0">
                                    <div className="min-w-0">
                                        <h2 className="text-lg font-black tracking-tight text-slate-900">Selling Units</h2>
                                        <p className="text-xs text-slate-500 mt-1 font-medium truncate">
                                            {vp.name} <span className="font-mono text-slate-400">· {vp.sku}</span>
                                        </p>
                                        <p className="text-[11px] text-slate-500 mt-1">
                                            Base unit: <span className="font-bold text-slate-700">{baseUnit}</span>
                                            {' · '}Stock: <span className="font-bold text-slate-700">{formatProductQty(vp, vp.stock_quantity)} {baseUnit}</span>
                                            {vp.cost_price ? <>{' · '}Cost: <span className="font-bold text-slate-700">{formatCurrency(vp.cost_price)} / {baseUnit}</span></> : null}
                                        </p>
                                    </div>
                                    <button onClick={close} className="p-2 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-none transition-colors shrink-0" aria-label="Close">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>

                                <div className="overflow-y-auto p-5">
                                    {units.length === 0 ? (
                                        <p className="text-sm text-slate-500 text-center py-8">No selling units configured for this product.</p>
                                    ) : (
                                        <div className="overflow-x-auto border border-slate-200">
                                            <table className="w-full text-sm">
                                                <thead className="bg-[#1B3A69] text-white text-[10px] uppercase tracking-wider">
                                                    <tr>
                                                        <th className="text-left p-3 font-black">Unit</th>
                                                        <th className="text-right p-3 font-black whitespace-nowrap">Contains</th>
                                                        <th className="text-right p-3 font-black whitespace-nowrap">Retail</th>
                                                        <th className="text-right p-3 font-black whitespace-nowrap">Wholesale</th>
                                                        <th className="text-right p-3 font-black whitespace-nowrap">Available</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {units.map((u) => {
                                                        const factor = Number(u.conversion_factor) || 0;
                                                        const available = factor > 0 ? Math.floor((Number(vp.stock_quantity) || 0) / factor) : 0;
                                                        return (
                                                            <tr key={u.id ?? u.name} className={u.is_default ? 'bg-amber-50/60' : ''}>
                                                                <td className="p-3 font-bold text-slate-900 whitespace-nowrap">
                                                                    {u.name}
                                                                    {u.is_default && (
                                                                        <span className="ml-2 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-800">Default</span>
                                                                    )}
                                                                </td>
                                                                <td className="p-3 text-right text-slate-600 whitespace-nowrap">{fmtFactor(factor)} {baseUnit}</td>
                                                                <td className="p-3 text-right font-bold text-slate-900 whitespace-nowrap">{formatCurrency(u.price)}</td>
                                                                <td className="p-3 text-right text-slate-600 whitespace-nowrap">{formatCurrency(u.wholesale_price)}</td>
                                                                <td className="p-3 text-right text-slate-600 whitespace-nowrap">{available.toLocaleString('en-US')}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>

                                <div className="p-5 border-t border-slate-100 flex gap-3 justify-end shrink-0">
                                    <button onClick={close} className="px-4 py-2.5 border border-slate-300 text-slate-700 font-bold text-xs uppercase tracking-wider hover:bg-slate-50 rounded-none">
                                        Close
                                    </button>
                                    <button
                                        onClick={() => { close(); openEditModal(vp); }}
                                        className="px-4 py-2.5 bg-[#1B3B6A] text-white font-black text-xs uppercase tracking-wider hover:bg-[#142E54] rounded-none"
                                    >
                                        Edit Units
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })(),
                document.body
            )}

            {/* PRODUCT ADD/EDIT MODAL */}
            {showModal && typeof document !== 'undefined' && createPortal(
                <div className={`fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[100] sm:p-6 backdrop-blur-sm animate-in fade-in duration-300 ${showScanner ? 'hidden' : ''}`}>
                    <div className="bg-white w-full h-full sm:h-auto sm:max-w-lg sm:rounded-none sm:shadow-2xl overflow-hidden flex flex-col sm:max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300 border border-gray-200/80">

                        {/* Header (Sticky on Mobile) */}
                        <div className="bg-[#1B3B6A] border-b border-white/10 px-6 sm:px-8 py-5 sm:py-6 flex justify-between items-center shrink-0 sticky top-0 z-50 text-white shadow-md">
                            <div className="flex items-center gap-3 min-w-0">
                                <div className="p-2 sm:p-2.5 bg-white/10 rounded-none shrink-0 ring-1 ring-white/20">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 sm:w-6 sm:h-6 text-white">
                                        <path strokeLinecap="round" strokeLinejoin="round" d={editMode ? "M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" : "M12 4.5v15m7.5-7.5h-15"} />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-lg sm:text-xl font-black text-white tracking-tight truncate">
                                        {editMode ? 'Update Product' : 'New Product'}
                                    </h2>
                                    <p className="text-xs text-white/80 font-medium truncate mt-0.5">
                                        {editMode ? 'Modify catalog pricing, barcode, and inventory levels' : 'Register a new catalog item into your inventory'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                className="bg-white/10 hover:bg-white/20 p-2 sm:p-2.5 rounded-none text-white transition-colors active:scale-95 shrink-0 ml-2 ring-1 ring-white/20"
                                title="Close Modal"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* Scrollable Form Body */}
                        <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar">
                            <form id="product-form" onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-500">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">SKU / Barcode</label>
                                    <div className="flex gap-2">
                                            <input
                                                name="sku"
                                                required
                                                value={formData.sku}
                                                onChange={handleChange}
                                                onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                                                className="flex-1 border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 font-mono"
                                                placeholder="Scan..."
                                            />
                                        <button type="button" onClick={() => setShowScanner(true)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 px-4 py-3 rounded-none transition-colors active:scale-95" title="Scan Barcode">
                                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" /></svg>
                                        </button>
                                        <button type="button" onClick={generateSKU} disabled={isCheckingSku} className="bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 px-4 py-3 rounded-none transition-colors active:scale-95 disabled:opacity-50" title="Generate SKU">
                                            {isCheckingSku ? (
                                                <svg className="animate-spin h-5 w-5 text-slate-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                                            )}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Product Name</label>
                                    <input name="name" required value={formData.name} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400" placeholder="e.g. Classic Cappuccino" />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Category</label>
                                        <select name="category_id" value={formData.category_id} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm" required>
                                            <option value="">Select Category...</option>
                                            {categories.map(cat => ( <option key={cat.id} value={cat.id}>{cat.name}</option> ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Selling Method</label>
                                        <select
                                            name="selling_method"
                                            value={formData.selling_method}
                                            onChange={(e) => handleSellingMethodChange(e.target.value)}
                                            className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm"
                                        >
                                            <option value="standard">Standard Quantity</option>
                                            <option value="multiple">Multiple Units (UOM)</option>
                                        </select>
                                    </div>
                                </div>

                                {formData.selling_method === 'standard' ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                        <div>
                                             <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Initial Stock</label>
                                             <input
                                                 type="number"
                                                 step="1"
                                                 min="0"
                                                 name="stock_quantity"
                                                 required
                                                 value={formData.stock_quantity}
                                                 onChange={handleChange}
                                                 className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400"
                                                 placeholder="0"
                                             />
                                        </div>
                                        <div>
                                             <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Cost Price</label>
                                             <input type="number" step="0.01" name="cost_price" required value={formData.cost_price} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 font-mono" placeholder="0.00" />
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                            <div className="relative">
                                                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Base Inventory Unit</label>
                                                <input
                                                    name="base_unit"
                                                    required
                                                    value={formData.base_unit}
                                                    onChange={handleChange}
                                                    onFocus={() => setBaseUnitSuggestionsOpen(true)}
                                                    onBlur={() => setTimeout(() => setBaseUnitSuggestionsOpen(false), 250)}
                                                    onKeyDown={handleBaseUnitKeyDown}
                                                    autoComplete="off"
                                                    className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400"
                                                    placeholder="e.g. meter, piece, gram"
                                                />
                                                {baseUnitSuggestionsOpen && filteredBaseUnits.length > 0 && (
                                                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-none shadow-xl z-30 max-h-48 overflow-y-auto custom-scrollbar divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150">
                                                        <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                            Suggestions ({filteredBaseUnits.length})
                                                        </div>
                                                        {filteredBaseUnits.map((unit, idx) => {
                                                            const isHighlighted = baseUnitHighlightedIndex === idx;
                                                            return (
                                                                <button
                                                                    key={idx}
                                                                    type="button"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        setFormData(prev => ({ ...prev, base_unit: unit }));
                                                                        setBaseUnitSuggestionsOpen(false);
                                                                        setBaseUnitHighlightedIndex(-1);
                                                                    }}
                                                                    onMouseEnter={() => setBaseUnitHighlightedIndex(idx)}
                                                                    className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                                                                        isHighlighted
                                                                            ? 'bg-[#EFF4F9] text-[#1B3B6A]'
                                                                            : 'text-slate-700 hover:bg-slate-50'
                                                                    }`}
                                                                >
                                                                    <span>{unit}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                 <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Initial Stock ({formData.base_unit || 'base unit'})</label>
                                                 <input
                                                     type="number"
                                                     step="0.00000001"
                                                     min="0"
                                                     name="stock_quantity"
                                                     required
                                                     value={formData.stock_quantity}
                                                     onChange={handleChange}
                                                     className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400"
                                                     placeholder="0"
                                                 />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Quantity Decimals</label>
                                            <select
                                                name="quantity_decimals"
                                                value={formData.quantity_decimals ?? ''}
                                                onChange={handleChange}
                                                className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm"
                                            >
                                                <option value="">Auto: {defaultQuantityDecimals(formData.base_unit)} for "{formData.base_unit || 'base unit'}"</option>
                                                <option value="0">0 - whole quantities only (e.g. 3 pcs)</option>
                                                <option value="1">1 (e.g. 2.5)</option>
                                                <option value="2">2 (e.g. 12.75 m)</option>
                                                <option value="3">3 (e.g. 1.250 kg)</option>
                                                <option value="4">4 (e.g. 0.3048)</option>
                                            </select>
                                            <p className="text-[11px] text-slate-500 mt-1.5 ml-0.5 leading-relaxed">
                                                Max decimal places the cashier can enter (in any selling unit) and that stock is shown with. Stock is always stored exactly.
                                            </p>
                                        </div>

                                        <div>
                                             <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Cost Price per {formData.base_unit || 'Base Unit'}</label>
                                             <input type="number" step="0.01" name="cost_price" required value={formData.cost_price} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 font-mono" placeholder="0.00" />
                                        </div>
                                    </>
                                )}

                                {formData.selling_method === 'multiple' ? (
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Selling Units</h3>
                                                <p className="text-[10px] text-slate-500 mt-0.5">Conversion factor = how many base units each selling unit contains.</p>
                                            </div>
                                            <button type="button" onClick={addUnitRow} className="text-xs font-bold text-[#1B3B6A] hover:underline">
                                                + Add Unit
                                            </button>
                                        </div>

                                        {formData.units.map((unit, index) => (
                                            <div key={index} className="border border-slate-200 bg-slate-50/60 p-4 space-y-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                                        <input
                                                            type="radio"
                                                            name="default_unit"
                                                            checked={!!unit.is_default}
                                                            onChange={() => handleUnitChange(index, 'is_default', true)}
                                                            className="w-4 h-4 text-[#1B3B6A] border-slate-300 focus:ring-[#1B3B6A]"
                                                        />
                                                        Default unit
                                                    </label>
                                                    {formData.units.length > 1 && (
                                                        <button type="button" onClick={() => removeUnitRow(index)} className="text-[11px] font-bold text-rose-600 hover:underline">
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                    <div className="relative">
                                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">Unit Name</label>
                                                        <input
                                                            required
                                                            value={unit.name}
                                                            onChange={(e) => handleUnitChange(index, 'name', e.target.value)}
                                                            onFocus={() => setUnitNameSuggestionsOpen(prev => ({ ...prev, [`open_${index}`]: true }))}
                                                            onBlur={() => setTimeout(() => setUnitNameSuggestionsOpen(prev => ({ ...prev, [`open_${index}`]: false })), 250)}
                                                            onKeyDown={(e) => handleUnitNameKeyDown(index, e)}
                                                            autoComplete="off"
                                                            className="w-full border border-slate-300 bg-white rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] py-2.5 px-3 text-sm font-semibold text-slate-900"
                                                            placeholder="e.g. Roll"
                                                        />
                                                        {unitNameSuggestionsOpen[`open_${index}`] && getFilteredUnitNames(unit.name).length > 0 && (
                                                            <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-none shadow-xl z-30 max-h-48 overflow-y-auto custom-scrollbar divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150">
                                                                <div className="px-3 py-1.5 bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                                    Suggestions ({getFilteredUnitNames(unit.name).length})
                                                                </div>
                                                                {getFilteredUnitNames(unit.name).map((u, idx) => {
                                                                    const isHighlighted = unitNameHighlightedIndex[`highlight_${index}`] === idx;
                                                                    return (
                                                                        <button
                                                                            key={idx}
                                                                            type="button"
                                                                            onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                handleUnitChange(index, 'name', u);
                                                                                setUnitNameSuggestionsOpen(prev => ({ ...prev, [`open_${index}`]: false }));
                                                                                setUnitNameHighlightedIndex(prev => ({ ...prev, [`highlight_${index}`]: -1 }));
                                                                            }}
                                                                            onMouseEnter={() => setUnitNameHighlightedIndex(prev => ({ ...prev, [`highlight_${index}`]: idx }))}
                                                                            className={`w-full text-left px-3.5 py-2.5 text-xs transition-colors flex items-center justify-between group cursor-pointer ${
                                                                                isHighlighted
                                                                                    ? 'bg-[#EFF4F9] text-[#1B3B6A]'
                                                                                    : 'text-slate-700 hover:bg-slate-50'
                                                                            }`}
                                                                        >
                                                                            <span>{u}</span>
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                                                            Conversion Factor ({formData.base_unit || 'base units'})
                                                        </label>
                                                        <input
                                                            type="number"
                                                            step="0.00000001"
                                                            min="0.00000001"
                                                            required
                                                            value={unit.conversion_factor}
                                                            onChange={(e) => handleUnitChange(index, 'conversion_factor', e.target.value)}
                                                            className="w-full border border-slate-300 bg-white rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] py-2.5 px-3 text-sm font-semibold text-slate-900 font-mono"
                                                            placeholder="e.g. 100"
                                                        />
                                                        {repeatingFactorHint(unit.conversion_factor, formData.base_unit, unit.name) && (
                                                            <p className="mt-1.5 text-[11px] font-semibold text-amber-700 leading-relaxed font-sans">
                                                                ⚠ {repeatingFactorHint(unit.conversion_factor, formData.base_unit, unit.name)}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 font-mono">
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 font-sans">Retail Price / {unit.name || 'unit'}</label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            required
                                                            value={unit.price}
                                                            onChange={(e) => handleUnitChange(index, 'price', e.target.value)}
                                                            className="w-full border border-slate-300 bg-white rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] py-2.5 px-3 text-sm font-semibold text-slate-900 font-mono"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-1 font-sans">Wholesale Price / {unit.name || 'unit'}</label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            min="0"
                                                            required
                                                            value={unit.wholesale_price}
                                                            onChange={(e) => handleUnitChange(index, 'wholesale_price', e.target.value)}
                                                            className="w-full border border-slate-300 bg-white rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] py-2.5 px-3 text-sm font-semibold text-slate-900 font-mono"
                                                            placeholder="0.00"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 font-mono">
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5 font-sans">Retail Price</label>
                                            <input type="number" step="0.01" name="price" required value={formData.price} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 font-mono" placeholder="0.00" />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5 font-sans">Wholesale Price</label>
                                            <input type="number" step="0.01" name="wholesale_price" required value={formData.wholesale_price} onChange={handleChange} className="w-full border border-slate-300 bg-slate-50/50 rounded-none focus:ring-2 focus:ring-[#1B3B6A] focus:border-[#1B3B6A] focus:bg-white transition-all py-3 px-4 text-sm font-semibold text-slate-900 shadow-sm placeholder:text-slate-400 font-mono" placeholder="0.00" />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5 ml-0.5">Product Image (Optional)</label>
                                    <input type="file" accept="image/*" onChange={handleFileChange} className="w-full text-xs text-slate-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-none file:border-0 file:text-xs file:font-bold file:bg-slate-100 file:text-slate-700 file:hover:bg-slate-200 file:transition-colors bg-slate-50 rounded-none cursor-pointer border border-slate-300"/>
                                </div>

                                <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-none border border-slate-200">
                                    <input
                                        type="checkbox"
                                        name="is_active"
                                        id="is_active_checkbox"
                                        checked={!!formData.is_active}
                                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                        className="w-4 h-4 text-[#1B3B6A] border-slate-300 rounded-none focus:ring-[#1B3B6A]"
                                    />
                                    <label htmlFor="is_active_checkbox" className="select-none cursor-pointer">
                                        <span className="block text-sm font-bold text-slate-900">Active Status</span>
                                        <span className="block text-[10px] text-slate-500 mt-0.5">If unchecked, this product will be archived and hidden from the POS terminal screen.</span>
                                    </label>
                                </div>
                            </form>
                        </div>

                        {/* Footer Actions (Sticky bottom on mobile) */}
                        <div className="bg-white sm:bg-gray-50/80 px-6 sm:px-8 py-5 border-t border-gray-100 flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowModal(false)}
                                className="order-2 sm:order-1 w-full sm:w-auto px-6 py-3.5 sm:py-3 text-gray-600 font-semibold bg-white border border-gray-300 hover:bg-gray-50 rounded-none text-sm transition-all active:scale-[0.98]"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="product-form"
                                disabled={isSaving}
                                className="order-1 sm:order-2 w-full sm:w-auto px-8 py-3.5 sm:py-3 bg-[#1B3B6A] hover:bg-[#142E54] text-white font-semibold rounded-none shadow-md shadow-[#1B3B6A]/20 text-sm transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                        Saving...
                                    </>
                                ) : 'Save Product'}
                            </button>
                        </div>

                    </div>
                </div>,
                document.body
            )}

            {/* AUXILIARY UI COMPONENTS */}
            {showCategoryManager && <CategoryManager onClose={() => setShowCategoryManager(false)} onUpdate={handleCategoryUpdate} isAdmin={isAdmin} initialCategories={categories} />}

            {/* FULL SCREEN MOBILE SCANNER PORTAL */}
            {showScanner && typeof document !== 'undefined' && createPortal(
                <MobileScanner onScan={handleScan} onClose={() => setShowScanner(false)} />,
                document.body
            )}

            {/* STOCK MOVEMENT HISTORY & AUDIT MODAL */}
            {historyModal.isOpen && typeof document !== 'undefined' && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[100] sm:p-4 lg:p-6 backdrop-blur-sm animate-in fade-in duration-300"
                    onClick={() => setHistoryModal(prev => ({ ...prev, isOpen: false }))}
                >
                    <div 
                        className="bg-white w-full h-full sm:h-auto sm:max-w-4xl lg:max-w-5xl sm:rounded-none sm:shadow-2xl overflow-hidden flex flex-col sm:max-h-[92vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300 border border-gray-200/80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header (Sticky on Mobile) */}
                        <div className="bg-[#1B3B6A] border-b border-white/10 px-4 sm:px-8 py-3.5 sm:py-5 flex justify-between items-center shrink-0 sticky top-0 z-50 text-white shadow-md">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div className="p-2 sm:p-2.5 bg-white/10 rounded-none shrink-0 ring-1 ring-white/20">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-white">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight truncate max-w-full">
                                        {historyModal.product?.name || 'Stock Movement History'}
                                    </h2>
                                    <p className="text-[11px] sm:text-xs text-white/80 font-mono flex items-center gap-1.5 mt-0.5 truncate whitespace-nowrap overflow-hidden">
                                        <span>SKU: {historyModal.product?.sku || 'N/A'}</span>
                                        <span>•</span>
                                        <span>{fmtLedgerQty(historyModal.data?.stats?.current_stock ?? historyModal.product?.stock_quantity ?? 0)} {ledgerUnit()}</span>
                                        <span className="hidden sm:inline">•</span>
                                        <span className="hidden sm:inline truncate">{historyModal.product?.category?.name || historyModal.data?.product?.category_name || 'General'}</span>
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                                {/* Export Excel Button */}
                                <button
                                    onClick={exportProductLedgerExcel}
                                    className="p-1.5 sm:px-3 sm:py-2 bg-white/10 hover:bg-white/20 text-white rounded-none transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold ring-1 ring-white/20"
                                    title="Download item stock ledger as styled Excel spreadsheet (.xlsx)"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                    </svg>
                                    <span className="hidden sm:inline">Export Excel</span>
                                </button>

                                {/* Close Button */}
                                <button
                                    onClick={() => setHistoryModal(prev => ({ ...prev, isOpen: false }))}
                                    className="bg-white/10 hover:bg-white/20 p-1.5 sm:p-2 rounded-none text-white transition-colors active:scale-95 shrink-0 ring-1 ring-white/20"
                                    title="Close Stock Movement Modal"
                                >
                                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        {/* Search & Filter Toolbar */}
                        <div className="p-3.5 sm:px-8 sm:py-3.5 bg-white border-b border-gray-100 space-y-2.5 shrink-0">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                                {/* Search Bar */}
                                <div className="relative flex-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Filter ledger by cashier name, invoice number, or description..."
                                        value={historyModal.search || ''}
                                        onChange={(e) => setHistoryModal(prev => ({ ...prev, search: e.target.value }))}
                                        className="w-full pl-10 pr-8 py-2 text-xs font-semibold bg-gray-50/70 border border-gray-200 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/10 focus:border-[#1B3B6A] focus:bg-white transition-all placeholder:text-gray-400 text-gray-900 shadow-2xs"
                                    />
                                    {historyModal.search && (
                                        <button 
                                            onClick={() => setHistoryModal(prev => ({ ...prev, search: '' }))}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                                        </button>
                                    )}
                                </div>

                                {/* Filter Pills with Dynamic Counts */}
                                {(() => {
                                    const timeline = historyModal.data?.timeline || [];
                                    let salesCount = 0;
                                    let restockCount = 0;
                                    let initialCount = 0;
                                    let adjustCount = 0;

                                    timeline.forEach(item => {
                                        if (item.type === 'sale') salesCount++;
                                        else if (item.type === 'restock') restockCount++;
                                        else if (item.type === 'creation') initialCount++;
                                        else adjustCount++;
                                    });

                                    const tabs = [
                                        { key: 'all', label: 'All Movements', count: timeline.length },
                                        { key: 'sale', label: 'POS Sales', count: salesCount },
                                        { key: 'restock', label: 'Restocks', count: restockCount },
                                        { key: 'creation', label: 'Initial Catalog', count: initialCount },
                                        { key: 'adjustment', label: 'Adjustments', count: adjustCount }
                                    ];

                                    return (
                                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth">
                                            {tabs.map(tab => (
                                                <button
                                                    key={tab.key}
                                                    onClick={(e) => {
                                                        setHistoryModal(prev => ({ ...prev, filter: tab.key }));
                                                        e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                                                    }}
                                                    className={`px-3 py-1.5 rounded-none text-xs font-bold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                                                        historyModal.filter === tab.key
                                                            ? 'bg-[#1B3B6A] text-white shadow-2xs'
                                                            : 'bg-gray-100/80 hover:bg-gray-200 text-gray-600'
                                                    }`}
                                                >
                                                    <span>{tab.label}</span>
                                                    <span className={`px-1.5 py-0.5 rounded-none text-[10px] font-black ${
                                                        historyModal.filter === tab.key
                                                            ? 'bg-white/20 text-white'
                                                            : 'bg-gray-200 text-gray-700'
                                                    }`}>
                                                        {tab.count}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Movement Timeline Table (Desktop) & Cards (Mobile) */}
                        <div ref={historyTimelineRef} className="flex-1 overflow-y-auto p-4 sm:p-8 custom-scrollbar bg-slate-50/30">
                            {historyModal.loading && (!historyModal.data || !historyModal.data.timeline) ? (
                                <div className="py-20 flex flex-col items-center justify-center gap-3">
                                    <svg className="animate-spin h-9 w-9 text-[#1B3B6A]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    <span className="text-xs font-bold text-slate-500">Loading stock movement ledger...</span>
                                </div>
                            ) : (() => {
                                const searchStr = (historyModal.search || '').toLowerCase().trim();
                                const filter = historyModal.filter || 'all';

                                const filteredTimeline = (historyModal.data?.timeline || []).filter(item => {
                                    const matchesFilter = filter === 'all' || item.type === filter;

                                    const matchesSearch = !searchStr ||
                                        (item.description && item.description.toLowerCase().includes(searchStr)) ||
                                        (item.user_name && item.user_name.toLowerCase().includes(searchStr)) ||
                                        (item.reference_no && item.reference_no.toLowerCase().includes(searchStr)) ||
                                        (item.invoice_number && item.invoice_number.toLowerCase().includes(searchStr));

                                    return matchesFilter && matchesSearch;
                                });

                                if (filteredTimeline.length === 0) {
                                    return (
                                        <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                                            <div className="p-4 rounded-none bg-gray-100 text-gray-400">
                                                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            </div>
                                            <p className="text-sm font-bold text-slate-700">No stock movements found</p>
                                            <p className="text-xs text-slate-400 max-w-sm">Try adjusting your search query or switching to "All Movements".</p>
                                        </div>
                                    );
                                }

                                return (
                                    <>
                                        {/* Desktop & Tablet Table */}
                                        <div className="hidden sm:block overflow-x-auto rounded-none border border-slate-200 bg-white shadow-2xs">
                                            <table className="w-full text-left border-collapse">
                                                <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
                                                    <tr>
                                                        <th className="p-4">Date & Time</th>
                                                        <th className="p-4">Movement Type</th>
                                                        <th className="p-4 text-center">Qty Change</th>
                                                        <th className="p-4">Staff / User</th>
                                                        <th className="p-4">Reference</th>
                                                        <th className="p-4">Description</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 text-xs font-semibold text-slate-700">
                                                    {filteredTimeline.map((row) => {
                                                        const refNo = row.reference_no || (row.invoice_number && row.invoice_number !== 'N/A' ? row.invoice_number : (row.type === 'creation' ? (historyModal.product?.sku || `PRD-${historyModal.product?.id}`) : `LOG-${(row.id || '').replace(/\D/g, '')}`));

                                                        return (
                                                            <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                                                                {/* Date & Time + Relative */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <div className="font-mono text-xs text-slate-900 font-bold">
                                                                        {formatDateTime(row.created_at)}
                                                                    </div>
                                                                    <div className="text-[10px] text-slate-400 font-medium">
                                                                        {formatRelativeTime(row.created_at)}
                                                                    </div>
                                                                </td>

                                                                {/* Movement Type */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    {row.type === 'sale' ? (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 uppercase tracking-wider">
                                                                            POS Sale
                                                                        </span>
                                                                    ) : row.type === 'restock' ? (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
                                                                            Restock
                                                                        </span>
                                                                    ) : row.type === 'creation' ? (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                                                                            Initial Catalog
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-none text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider">
                                                                            {row.subtype === 'void_return' ? 'Void Return' : 'Adjustment'}
                                                                        </span>
                                                                    )}
                                                                </td>

                                                                {/* Qty Change Delta */}
                                                                <td className="p-4 text-center whitespace-nowrap font-mono font-black">
                                                                    {row.quantity_change < 0 ? (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-xs font-black bg-rose-50 text-rose-700 border border-rose-200">
                                                                            {ledgerQtyText(row)}
                                                                        </span>
                                                                    ) : row.quantity_change > 0 ? (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-xs font-black bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                                            {ledgerQtyText(row)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center px-2.5 py-1 rounded-none text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                                                            0 {ledgerUnit()}
                                                                        </span>
                                                                    )}
                                                                    {ledgerSellingUnit(row) && (
                                                                        <div className="text-[10px] font-bold text-slate-500 mt-1 font-sans">{ledgerSellingUnit(row)}</div>
                                                                    )}
                                                                </td>

                                                                {/* Recorded By */}
                                                                <td className="p-4 whitespace-nowrap">
                                                                    <div className="flex items-center gap-2.5">
                                                                        {row.user_avatar ? (
                                                                            <img
                                                                                src={getAvatarUrl(row.user_avatar)}
                                                                                alt={row.user_name}
                                                                                className="w-8 h-8 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                            />
                                                                        ) : (
                                                                            <div className="w-8 h-8 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-gray-200 text-xs font-black flex items-center justify-center shrink-0 uppercase shadow-2xs">
                                                                                {row.user_name ? row.user_name.charAt(0) : 'S'}
                                                                            </div>
                                                                        )}
                                                                        <div>
                                                                            <span className="font-extrabold text-gray-900 text-xs block">{row.user_name || 'System'}</span>
                                                                            {row.user_account_number && (
                                                                                <span className="text-[10px] font-mono font-bold text-gray-400 block -mt-0.5">#{row.user_account_number}</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                {/* Reference / Invoice */}
                                                                <td className="p-4 whitespace-nowrap font-mono text-xs text-slate-600 font-bold">
                                                                    <span className="inline-flex items-center px-2 py-0.5 rounded-none text-[10px] bg-slate-100 text-slate-700 border border-slate-200">
                                                                        <LogRef value={refNo} />
                                                                    </span>
                                                                </td>

                                                                {/* Description */}
                                                                <td className="p-4 text-slate-700 text-xs font-medium max-w-xs break-words">
                                                                    {row.description}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Mobile Cards Timeline */}
                                        <div className="sm:hidden flex flex-col gap-2.5">
                                            {filteredTimeline.map((row) => {
                                                const refNo = row.reference_no || (row.invoice_number && row.invoice_number !== 'N/A' ? row.invoice_number : (row.type === 'creation' ? (historyModal.product?.sku || `PRD-${historyModal.product?.id}`) : `LOG-${(row.id || '').replace(/\D/g, '')}`));

                                                return (
                                                    <div key={`mob-hist-${row.id}`} className="bg-white p-4 rounded-none border border-slate-200/90 shadow-2xs flex flex-col gap-2.5">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <div>
                                                                {row.type === 'sale' ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 uppercase tracking-wider">
                                                                        POS Sale
                                                                    </span>
                                                                ) : row.type === 'restock' ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider">
                                                                        Restock
                                                                    </span>
                                                                ) : row.type === 'creation' ? (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                                                                        Initial Catalog
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center px-2.5 py-1 rounded-none text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider">
                                                                        {row.subtype === 'void_return' ? 'Void Return' : 'Adjustment'}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="text-right">
                                                                <span className="text-[10px] font-bold text-slate-700 block">{formatRelativeTime(row.created_at)}</span>
                                                                <span className="text-[9px] font-mono text-slate-400 block">{formatDateTime(row.created_at)}</span>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                {row.user_avatar ? (
                                                                    <img
                                                                        src={getAvatarUrl(row.user_avatar)}
                                                                        alt={row.user_name}
                                                                        className="w-7 h-7 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                    />
                                                                ) : (
                                                                    <div className="w-7 h-7 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-gray-200 text-[10px] font-black flex items-center justify-center shrink-0 uppercase shadow-2xs">
                                                                        {row.user_name ? row.user_name.charAt(0) : 'S'}
                                                                    </div>
                                                                )}
                                                                <div className="min-w-0">
                                                                    <span className="text-xs font-extrabold text-gray-900 block truncate">{row.user_name || 'System'}</span>
                                                                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-gray-400 font-bold">
                                                                        <span>Ref: <LogRef value={refNo} /></span>
                                                                        {row.user_account_number && <span>• #{row.user_account_number}</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div>
                                                                {row.quantity_change < 0 ? (
                                                                    <span className="text-rose-600 bg-rose-50 px-2.5 py-1 rounded-none border border-rose-200 font-black font-mono text-xs">
                                                                        {ledgerQtyText(row)}
                                                                    </span>
                                                                ) : row.quantity_change > 0 ? (
                                                                    <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-none border border-emerald-200 font-black font-mono text-xs">
                                                                        {ledgerQtyText(row)}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-slate-500 bg-slate-50 px-2.5 py-1 rounded-none border border-slate-200 font-bold font-mono text-xs">
                                                                        0
                                                                    </span>
                                                                )}
                                                                {ledgerSellingUnit(row) && (
                                                                    <span className="block text-right text-[10px] font-bold text-slate-500 mt-1">{ledgerSellingUnit(row)}</span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {row.description && (
                                                            <p className="text-[11px] font-medium text-slate-600 pt-1.5 border-t border-slate-100 leading-snug">
                                                                {row.description}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        {/* Footer Actions (Sticky bottom on mobile) */}
                        <div className="bg-white sm:bg-gray-50/90 px-6 sm:px-8 py-4 sm:py-5 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <span>{historyModal.data?.timeline?.length || 0} movement entries in product audit ledger</span>
                            </div>

                            <div className="flex items-center gap-2 w-full sm:w-auto">
                                {isAdmin && historyModal.product && (
                                    <button
                                        onClick={() => handleQuickAdd(historyModal.product)}
                                        className="flex-1 sm:flex-none px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-none text-xs sm:text-sm transition-all active:scale-[0.98] shadow-sm flex items-center justify-center gap-1.5"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                        <span>Restock Item</span>
                                    </button>
                                )}
                                <button
                                    onClick={() => setHistoryModal(prev => ({ ...prev, isOpen: false }))}
                                    className="flex-1 sm:flex-none px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-none text-xs sm:text-sm transition-all active:scale-[0.98]"
                                >
                                    Close Ledger
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* STORE-WIDE RECENT INVENTORY ACTIVITY AUDIT FEED MODAL */}
            {activityDrawer.isOpen && typeof document !== 'undefined' && createPortal(
                <div 
                    className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[100] sm:p-4 lg:p-6 backdrop-blur-sm animate-in fade-in duration-300"
                    onClick={() => setActivityDrawer(prev => ({ ...prev, isOpen: false }))}
                >
                    <div 
                        className="bg-white w-full h-full sm:h-auto sm:max-w-3xl lg:max-w-4xl sm:rounded-none sm:shadow-2xl overflow-hidden flex flex-col sm:max-h-[92vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-300 border border-gray-200/80"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header (Sticky on Mobile) */}
                        <div className="bg-[#1B3B6A] border-b border-white/10 px-4 sm:px-8 py-3.5 sm:py-5 flex justify-between items-center shrink-0 sticky top-0 z-50 text-white shadow-md">
                            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                                <div className="p-2 sm:p-2.5 bg-white/10 rounded-none shrink-0 ring-1 ring-white/20">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 sm:w-5 sm:h-5 text-white">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-base sm:text-lg font-black text-white tracking-tight truncate max-w-full">
                                        Inventory Activity Audit Feed
                                    </h2>
                                    <p className="text-[11px] sm:text-xs text-white/80 font-medium flex items-center gap-1.5 mt-0.5 truncate whitespace-nowrap overflow-hidden">
                                        <span>Live Store Audit Trail</span>
                                        <span>•</span>
                                        <span>Real-time Ledger</span>
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-2">
                                {/* Export Excel Button */}
                                <button
                                    onClick={exportActivityExcel}
                                    className="p-1.5 sm:px-3 sm:py-2 bg-white/10 hover:bg-white/20 text-white rounded-none transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold ring-1 ring-white/20"
                                    title="Download audit logs as styled Excel spreadsheet (.xlsx)"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                    </svg>
                                    <span className="hidden sm:inline">Export Excel</span>
                                </button>

                                {/* Close Button */}
                                <button
                                    onClick={() => setActivityDrawer(prev => ({ ...prev, isOpen: false }))}
                                    className="bg-white/10 hover:bg-white/20 p-1.5 sm:p-2 rounded-none text-white transition-colors active:scale-95 shrink-0 ring-1 ring-white/20"
                                    title="Close Activity Feed Modal"
                                >
                                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                            </div>
                        </div>

                        {/* Search & Filter Toolbar */}
                        <div className="p-3.5 sm:px-8 sm:py-3.5 bg-white border-b border-gray-100 space-y-2.5 shrink-0">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                                {/* Search Bar */}
                                <div className="relative flex-1">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Filter audit log by staff name, product SKU, keyword, or invoice..."
                                        value={activityDrawer.search}
                                        onChange={(e) => setActivityDrawer(prev => ({ ...prev, search: e.target.value }))}
                                        className="w-full pl-10 pr-8 py-2 text-xs font-semibold bg-gray-50/70 border border-gray-200 rounded-none focus:ring-2 focus:ring-[#1B3B6A]/10 focus:border-[#1B3B6A] focus:bg-white transition-all placeholder:text-gray-400 text-gray-900 shadow-2xs"
                                    />
                                    {activityDrawer.search && (
                                        <button 
                                            onClick={() => setActivityDrawer(prev => ({ ...prev, search: '' }))}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                                        </button>
                                    )}
                                </div>

                                {/* Filter Pills with Dynamic Counts */}
                                {(() => {
                                    const logs = activityDrawer.logs || [];
                                    let salesCount = 0;
                                    let restockCount = 0;
                                    let createCount = 0;
                                    let updateCount = 0;
                                    let categoryCount = 0;
                                    let fileCount = 0;

                                    logs.forEach(log => {
                                        const activityType = getActivityType(log);
                                        if (activityType === 'sale') {
                                            salesCount++;
                                        } else if (activityType === 'stock') {
                                            restockCount++;
                                        } else if (activityType === 'create') {
                                            createCount++;
                                        } else if (activityType === 'category') {
                                            categoryCount++;
                                        } else if (activityType === 'file') {
                                            fileCount++;
                                        } else {
                                            updateCount++;
                                        }
                                    });

                                    const filterTabs = [
                                        { key: 'all', label: 'All', count: logs.length },
                                        { key: 'sale', label: 'POS Sales', count: salesCount },
                                        { key: 'stock', label: 'Restocks', count: restockCount },
                                        { key: 'create', label: 'New Items', count: createCount },
                                        { key: 'update', label: 'Edits', count: updateCount },
                                        { key: 'category', label: 'Categories', count: categoryCount },
                                        { key: 'file', label: 'Import / Export', count: fileCount }
                                    ];

                                    return (
                                        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 scroll-smooth">
                                            {filterTabs.map(f => (
                                                <button
                                                    key={f.key}
                                                    onClick={(e) => {
                                                        setActivityDrawer(prev => ({ ...prev, filter: f.key }));
                                                        e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                                                    }}
                                                    className={`px-3 py-1.5 rounded-none text-xs font-bold transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
                                                        activityDrawer.filter === f.key
                                                            ? 'bg-[#1B3B6A] text-white shadow-2xs'
                                                            : 'bg-gray-100/80 hover:bg-gray-200 text-gray-600'
                                                    }`}
                                                >
                                                    <span>{f.label}</span>
                                                    <span className={`px-1.5 py-0.5 rounded-none text-[10px] font-black ${
                                                        activityDrawer.filter === f.key
                                                            ? 'bg-white/20 text-white'
                                                            : 'bg-gray-200 text-gray-700'
                                                    }`}>
                                                        {f.count}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>

                        {/* Chronologically Grouped Timeline Feed Stream */}
                        <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 custom-scrollbar bg-slate-50/40">
                            {activityDrawer.loading && (!activityDrawer.logs || activityDrawer.logs.length === 0) ? (
                                <div className="py-20 flex flex-col items-center justify-center gap-3">
                                    <svg className="animate-spin h-9 w-9 text-[#1B3B6A]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    <span className="text-xs font-bold text-gray-500">Streaming store audit movements...</span>
                                </div>
                            ) : (() => {
                                const searchStr = (activityDrawer.search || '').toLowerCase().trim();
                                const filter = activityDrawer.filter || 'all';

                                const filtered = (activityDrawer.logs || []).filter(log => {
                                    const matchesSearch = !searchStr || 
                                        (log.description && log.description.toLowerCase().includes(searchStr)) ||
                                        (log.user_name && log.user_name.toLowerCase().includes(searchStr)) ||
                                        (log.action && log.action.toLowerCase().includes(searchStr));

                                    // Tab keys: 'sale' | 'stock' | 'create' | 'update' (same classifier as counts & badges)
                                    const matchesFilter = filter === 'all' || getActivityType(log) === filter;

                                    return matchesSearch && matchesFilter;
                                });

                                if (filtered.length === 0) {
                                    return (
                                        <div className="py-20 text-center text-gray-400 flex flex-col items-center justify-center gap-2">
                                            <div className="p-4 rounded-none bg-gray-100 text-gray-400">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                                                </svg>
                                            </div>
                                            <p className="text-sm font-bold text-gray-700">No matching activities found</p>
                                            <p className="text-xs text-gray-400 max-w-sm">Try adjusting your search criteria or switching to "All Movements".</p>
                                        </div>
                                    );
                                }

                                // Group items by Date
                                const groups = {};
                                filtered.forEach(log => {
                                    if (!log.created_at) {
                                        groups['Earlier Activity'] = groups['Earlier Activity'] || [];
                                        groups['Earlier Activity'].push(log);
                                        return;
                                    }
                                    const d = new Date(log.created_at);
                                    const today = new Date();
                                    const yesterday = new Date();
                                    yesterday.setDate(today.getDate() - 1);

                                    let groupKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                                    if (d.toDateString() === today.toDateString()) {
                                        groupKey = 'Today';
                                    } else if (d.toDateString() === yesterday.toDateString()) {
                                        groupKey = 'Yesterday';
                                    }

                                    if (!groups[groupKey]) {
                                        groups[groupKey] = [];
                                    }
                                    groups[groupKey].push(log);
                                });

                                return Object.keys(groups).map((groupTitle) => (
                                    <div key={groupTitle} className="space-y-3">
                                        {/* Date Section Header */}
                                        <div className="flex items-center gap-3">
                                            <span className="px-3 py-1 rounded-none text-[11px] font-black bg-white text-[#1B3B6A] border border-gray-200 shadow-2xs tracking-wider uppercase">
                                                {groupTitle}
                                            </span>
                                            <div className="flex-1 h-px bg-gray-200/80"></div>
                                            <span className="text-[10px] font-bold text-gray-400">
                                                {groups[groupTitle].length} {groups[groupTitle].length === 1 ? 'event' : 'events'}
                                            </span>
                                        </div>

                                        {/* Timeline Cards in Group */}
                                        <div className="relative pl-4 sm:pl-6 space-y-3 border-l-2 border-gray-200 ml-3 sm:ml-4">
                                            {groups[groupTitle].map(log => {
                                                const activityType = getActivityType(log);
                                                const isSale = activityType === 'sale';
                                                const isRestock = activityType === 'stock';
                                                const isCreate = activityType === 'create';
                                                const isCategory = activityType === 'category';
                                                const isFile = activityType === 'file';
                                                const stockChange = Number(log.new_values?.quantity_change ?? log.new_values?.quantity_added ?? 0);

                                                return (
                                                    <div 
                                                        key={log.id} 
                                                        className="relative bg-white p-4 sm:p-5 rounded-none border border-gray-200/80 shadow-2xs hover:shadow-md transition-all space-y-2.5 group"
                                                    >
                                                        {/* Timeline Dot Node */}
                                                        <div className={`absolute -left-[23px] sm:-left-[31px] top-5 w-3.5 h-3.5 rounded-full border-2 border-white ring-2 ${
                                                            isSale ? 'bg-rose-500 ring-rose-200' :
                                                            isRestock ? 'bg-emerald-500 ring-emerald-200' :
                                                            isCreate ? 'bg-blue-500 ring-blue-200' :
                                                            isCategory ? 'bg-violet-500 ring-violet-200' :
                                                            isFile ? 'bg-sky-500 ring-sky-200' :
                                                            'bg-amber-500 ring-amber-200'
                                                        }`}></div>

                                                        {/* Header: Event Badge, Staff & Time */}
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                {/* Event Badge */}
                                                                {isSale ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" /></svg>
                                                                        POS Sale
                                                                    </span>
                                                                ) : isRestock ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" /></svg>
                                                                        {log.action === 'stock_void_return' ? 'Void Return' : (stockChange < 0 ? 'Stock Adjusted' : 'Restock')}
                                                                    </span>
                                                                ) : isCreate ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-blue-50 text-blue-700 border border-blue-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                                                                        New Product
                                                                    </span>
                                                                ) : isCategory ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-violet-50 text-violet-700 border border-violet-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" /><path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" /></svg>
                                                                        Category
                                                                    </span>
                                                                ) : isFile ? (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-sky-50 text-sky-700 border border-sky-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                                                                        {log.action === 'export' ? 'Export' : (log.action === 'import_failed' ? 'Import Rejected' : 'Import')}
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200 tracking-wider uppercase">
                                                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
                                                                        Adjustment
                                                                    </span>
                                                                )}

                                                                {/* Staff / Actor Avatar Chip */}
                                                                <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-none bg-gray-100 text-gray-700 text-[11px] font-bold">
                                                                    {log.user_avatar ? (
                                                                        <img
                                                                            src={getAvatarUrl(log.user_avatar)}
                                                                            alt={log.user_name}
                                                                            className="w-5 h-5 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                                        />
                                                                    ) : (
                                                                        <div className="w-5 h-5 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] border border-gray-200 flex items-center justify-center font-black text-[9px] shrink-0 uppercase shadow-2xs">
                                                                            {log.user_name ? log.user_name.charAt(0) : 'S'}
                                                                        </div>
                                                                    )}
                                                                    <span>{log.user_name || 'System'}</span>
                                                                    {log.user_account_number && (
                                                                        <span className="font-mono text-[10px] text-gray-400 font-bold">#{log.user_account_number}</span>
                                                                    )}
                                                                </div>

                                                                {/* Reference Number Badge */}
                                                                {(() => {
                                                                    let ref = log.reference_no;
                                                                    if (!ref) {
                                                                        if (log.invoice_number) ref = log.invoice_number;
                                                                        else if (log.sku) ref = `SKU: ${log.sku}`;
                                                                        else if (log.description && log.description.includes('SKU:')) {
                                                                            const m = log.description.match(/SKU:\s*([^)\s]+)/i);
                                                                            if (m) ref = `SKU: ${m[1]}`;
                                                                        } else if (log.description && log.description.includes('Inv:')) {
                                                                            const m = log.description.match(/Inv:\s*([A-Za-z0-9-]+)/i);
                                                                            if (m) ref = m[1];
                                                                        } else if (log.model_type && log.model_id) {
                                                                            ref = `${log.model_type} #${log.model_id}`;
                                                                        } else if (log.id) {
                                                                            ref = String(log.id).toUpperCase();
                                                                        }
                                                                    }
                                                                    if (!ref) return null;
                                                                    return (
                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none text-[10px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs">
                                                                            <span className="text-slate-400 font-medium">Ref:</span> <LogRef value={ref} />
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </div>

                                                            {/* Relative Timestamp */}
                                                            <div className="flex items-center gap-1.5 text-gray-400 font-medium text-xs">
                                                                <span className="font-bold text-gray-700">{formatRelativeTime(log.created_at)}</span>
                                                                <span className="text-[10px] text-gray-400">({formatDateTime(log.created_at)})</span>
                                                            </div>
                                                        </div>

                                                        {/* Description & Movement Summary */}
                                                        <div className="pt-1">
                                                            <p className="text-xs sm:text-sm font-semibold text-gray-800 leading-relaxed break-words">
                                                                {log.description}
                                                            </p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>

                        {/* Footer Actions (Sticky bottom on mobile) */}
                        <div className="bg-white sm:bg-gray-50/90 px-6 sm:px-8 py-3.5 sm:py-4 border-t border-gray-200/80 flex items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-[#1B3B6A]"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                <span>{activityDrawer.logs?.length || 0} activities recorded in store audit trail</span>
                            </div>
                            <button
                                onClick={() => setActivityDrawer(prev => ({ ...prev, isOpen: false }))}
                                className="w-full sm:w-auto px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-none text-xs sm:text-sm transition-all active:scale-[0.98]"
                            >
                                Close Audit Feed
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </AuthenticatedLayout>
    );
}