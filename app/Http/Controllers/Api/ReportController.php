<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Product;
use App\Models\Category;
use App\Models\Shift;
use App\Models\CashMovement;
use App\Models\Store;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * ReportController
 * Dedicated controller for detailed retail auditing, multi-domain filtering,
 * sales breakdown, inventory valuation, shift reconciliation, and staff performance.
 */
class ReportController extends Controller
{
    /**
     * Get comprehensive reports dataset with date ranges, cashier, category, and payment method filters.
     */
    public function index(Request $request)
    {
        try {
            $storeId = \App\Support\CurrentStore::id() ?? $request->user()->store_id;

            // 1. Date Range Handling (Default to Last 7 Days)
            $startDate = $request->has('start_date') && $request->start_date
                ? Carbon::parse($request->start_date)->startOfDay()
                : Carbon::now()->subDays(6)->startOfDay();

            $endDate = $request->has('end_date') && $request->end_date
                ? Carbon::parse($request->end_date)->endOfDay()
                : Carbon::now()->endOfDay();

        $userId = $request->user_id;
        $categoryId = $request->category_id;
        $paymentMethod = $request->payment_method;
        $search = $request->search ? trim($request->search) : '';

        // 2. Base Query for Completed Sales
        $salesBaseQuery = Sale::where('store_id', $storeId)
            ->whereBetween('created_at', [$startDate, $endDate]);

        if ($userId) {
            $salesBaseQuery->where('cashier_id', $userId);
        }

        if ($paymentMethod) {
            $salesBaseQuery->where('payment_method', $paymentMethod);
        }

        if ($search) {
            $salesBaseQuery->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%{$search}%")
                  ->orWhereHas('cashier', function ($q2) use ($search) {
                      $q2->where('name', 'like', "%{$search}%");
                  });
            });
        }

        // Completed sales clone
        $completedSalesQuery = (clone $salesBaseQuery)->where('status', 'completed');
        $voidSalesQuery = (clone $salesBaseQuery)->where('status', 'void');

        // High-level financial KPIs
        $totalSalesCents = (clone $completedSalesQuery)->sum('total_amount');
        $totalOrdersCount = (clone $completedSalesQuery)->count();
        $totalDiscountsCents = (clone $completedSalesQuery)->sum('discount_amount');
        $averageOrderValueCents = $totalOrdersCount > 0 ? (int)round($totalSalesCents / $totalOrdersCount) : 0;

        $voidCount = (clone $voidSalesQuery)->count();
        $voidAmountCents = (clone $voidSalesQuery)->sum('total_amount');

        // Total Item Profit & Cost of Goods Sold (COGS)
        $itemProfitsRaw = DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', 'completed')
            ->whereBetween('sales.created_at', [$startDate, $endDate])
            ->when($userId, function ($q) use ($userId) {
                $q->where('sales.cashier_id', $userId);
            })
            ->when($paymentMethod, function ($q) use ($paymentMethod) {
                $q->where('sales.payment_method', $paymentMethod);
            })
            ->when($categoryId, function ($q) use ($categoryId) {
                $q->where('products.category_id', $categoryId);
            })
            ->selectRaw('
                SUM(COALESCE(sale_items.base_quantity, sale_items.quantity)) as total_units_sold,
                SUM(sale_items.subtotal) as total_gross_items_revenue,
                SUM(COALESCE(sale_items.cost_price_snapshot, products.cost_price, 0) * COALESCE(sale_items.base_quantity, sale_items.quantity)) as total_cogs
            ')
            ->first();

        $totalUnitsSold = Quantity::toNumber($itemProfitsRaw->total_units_sold ?? 0);
        $totalCogsCents = (int) round((float) ($itemProfitsRaw->total_cogs ?? 0));
        $totalGrossProfitCents = $totalSalesCents - $totalCogsCents - $totalDiscountsCents;
        $grossMarginPct = $totalSalesCents > 0 ? round(($totalGrossProfitCents / $totalSalesCents) * 100, 1) : 0;

        // ---------------------------------------------------------------------
        // DOMAIN 1: SALES & REVENUE AUDIT (Daily / Period Breakdowns)
        // ---------------------------------------------------------------------
        $dailySalesRaw = Sale::where('store_id', $storeId)
            ->whereBetween('created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('cashier_id', $userId))
            ->when($paymentMethod, fn($q) => $q->where('payment_method', $paymentMethod))
            ->selectRaw('
                DATE(created_at) as sale_date,
                COUNT(CASE WHEN status = \'completed\' THEN 1 END) as orders_count,
                SUM(CASE WHEN status = \'completed\' THEN total_amount ELSE 0 END) as gross_sales,
                SUM(CASE WHEN status = \'completed\' THEN discount_amount ELSE 0 END) as discounts,
                COUNT(CASE WHEN status = \'void\' THEN 1 END) as void_count,
                SUM(CASE WHEN status = \'void\' THEN total_amount ELSE 0 END) as void_amount,
                SUM(CASE WHEN status = \'completed\' AND payment_method = \'cash\' THEN total_amount ELSE 0 END) as cash_sales,
                SUM(CASE WHEN status = \'completed\' AND payment_method != \'cash\' THEN total_amount ELSE 0 END) as digital_sales
            ')
            ->groupBy('sale_date')
            ->orderBy('sale_date', 'desc')
            ->get();

        $dailySales = $dailySalesRaw->map(function ($row) {
            $orders = (int)$row->orders_count;
            $sales = (int)$row->gross_sales;
            return [
                'date' => $row->sale_date,
                'orders_count' => $orders,
                'gross_sales' => $sales,
                'discounts' => (int)$row->discounts,
                'net_sales' => $sales,
                'aov' => $orders > 0 ? (int)round($sales / $orders) : 0,
                'void_count' => (int)$row->void_count,
                'void_amount' => (int)$row->void_amount,
                'cash_sales' => (int)$row->cash_sales,
                'digital_sales' => (int)$row->digital_sales,
            ];
        });

        // Payment Methods Breakdown
        $paymentMethodsRaw = Sale::where('store_id', $storeId)
            ->where('status', 'completed')
            ->whereBetween('created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('cashier_id', $userId))
            ->selectRaw('payment_method, COUNT(*) as count, SUM(total_amount) as total_amount')
            ->groupBy('payment_method')
            ->get();

        $paymentMethods = $paymentMethodsRaw->map(function ($pm) use ($totalSalesCents) {
            $amt = (int)$pm->total_amount;
            return [
                'method' => $pm->payment_method ?? 'cash',
                'count' => (int)$pm->count,
                'total_amount' => $amt,
                'percentage' => $totalSalesCents > 0 ? round(($amt / $totalSalesCents) * 100, 1) : 0,
            ];
        });

        // Hourly Sales Velocity
        $hourlySalesRaw = Sale::where('store_id', $storeId)
            ->where('status', 'completed')
            ->whereBetween('created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('cashier_id', $userId))
            ->when($paymentMethod, fn($q) => $q->where('payment_method', $paymentMethod))
            ->selectRaw(self::hourExpression('created_at') . ' as hour, COUNT(*) as orders_count, SUM(total_amount) as total_sales')
            ->groupBy('hour')
            ->orderBy('hour')
            ->get();

        $hourlySales = $hourlySalesRaw->map(function ($h) {
            $hourNum = (int)$h->hour;
            $label = Carbon::createFromTime($hourNum, 0)->format('g A');
            return [
                'hour' => $hourNum,
                'hour_label' => $label,
                'orders_count' => (int)$h->orders_count,
                'total_sales' => (int)$h->total_sales,
            ];
        });

        // ---------------------------------------------------------------------
        // DOMAIN 2: PRODUCT & CATEGORY SALES PERFORMANCE
        // ---------------------------------------------------------------------
        $productSalesQuery = DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
            ->leftJoin('categories', 'products.category_id', '=', 'categories.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', 'completed')
            ->whereBetween('sales.created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('sales.cashier_id', $userId))
            ->when($paymentMethod, fn($q) => $q->where('sales.payment_method', $paymentMethod))
            ->when($categoryId, fn($q) => $q->where('products.category_id', $categoryId));

        if ($search) {
            $productSalesQuery->where(function ($q) use ($search) {
                $q->where('products.name', 'like', "%{$search}%")
                  ->orWhere('products.sku', 'like', "%{$search}%")
                  ->orWhere('sale_items.custom_name', 'like', "%{$search}%");
            });
        }

        $productSalesRaw = $productSalesQuery
            ->selectRaw('
                sale_items.product_id,
                MAX(COALESCE(products.name, sale_items.custom_name, \'Custom Item\')) as product_name,
                MAX(COALESCE(products.sku, \'N/A\')) as sku,
                MAX(COALESCE(categories.name, \'Uncategorized\')) as category_name,
                MAX(COALESCE(categories.id, 0)) as category_id,
                MAX(COALESCE(products.price, sale_items.unit_price)) as unit_retail_price,
                MAX(COALESCE(sale_items.cost_price_snapshot, products.cost_price, 0)) as unit_cost_price,
                MAX(COALESCE(products.stock_quantity, 0)) as current_stock,
                MAX(COALESCE(products.is_active, 1)) as is_active,
                MAX(CASE WHEN products.selling_method = \'multiple\' THEN 1 ELSE 0 END) as is_multi_unit,
                MAX(COALESCE(products.base_unit, \'\')) as base_unit,
                MAX(products.quantity_decimals) as quantity_decimals,
                MAX(CASE WHEN products.id IS NOT NULL AND COALESCE(sale_items.cost_price_snapshot, products.cost_price) IS NULL THEN 1 ELSE 0 END) as has_missing_cost,
                SUM(COALESCE(sale_items.base_quantity, sale_items.quantity)) as units_sold,
                SUM(sale_items.subtotal) as total_revenue,
                SUM(COALESCE(sale_items.cost_price_snapshot, products.cost_price, 0) * COALESCE(sale_items.base_quantity, sale_items.quantity)) as total_cost
            ')
            ->groupBy('sale_items.product_id')
            ->orderByDesc('units_sold')
            ->get();

        $productReports = $productSalesRaw->map(function ($p) {
            $rev = (int)$p->total_revenue;
            $cost = (int) round((float)$p->total_cost);
            $profit = $rev - $cost;
            $margin = $rev > 0 ? round(($profit / $rev) * 100, 1) : 0;
            $unitsSold = Quantity::toNumber($p->units_sold ?? 0);
            $isMulti = (bool) $p->is_multi_unit;

            // Multi-UOM reports express catalogue prices per base unit so they can
            // be compared directly with the base-unit units_sold figure.
            $unitRetail = $isMulti && Quantity::compare($unitsSold, '0') > 0
                ? Quantity::toInt(Quantity::divide($rev, $unitsSold))
                : (int) $p->unit_retail_price;
            $unitCost = Quantity::compare($unitsSold, '0') > 0
                ? Quantity::toInt(Quantity::divide($cost, $unitsSold))
                : (int) $p->unit_cost_price;

            return [
                'product_id' => $p->product_id,
                'name' => $p->product_name,
                'sku' => $p->sku,
                'category_name' => $p->category_name,
                'category_id' => (int)$p->category_id,
                'unit_retail_price' => $unitRetail,
                'unit_cost_price' => $unitCost,
                'current_stock' => Quantity::toNumber($p->current_stock ?? 0),
                'is_active' => (bool)$p->is_active,
                'selling_method' => $isMulti ? 'multiple' : 'standard',
                'is_multi_unit' => $isMulti,
                'base_unit' => $p->base_unit ?: null,
                'quantity_precision' => $isMulti
                    ? ($p->quantity_decimals !== null ? (int) $p->quantity_decimals : Product::defaultQuantityDecimals($p->base_unit))
                    : 0,
                'has_missing_cost' => (bool) $p->has_missing_cost,
                'units_sold' => $unitsSold,
                'total_revenue' => $rev,
                'total_cost' => $cost,
                'total_profit' => $profit,
                'margin_percent' => $margin,
                'velocity_status' => Quantity::compare($unitsSold, '20') >= 0 ? 'fast' : (Quantity::compare($unitsSold, '2') <= 0 ? 'slow' : 'regular'),
            ];
        });

        // Category Breakdown
        $categoryBreakdownRaw = DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
            ->leftJoin('categories', 'products.category_id', '=', 'categories.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', 'completed')
            ->whereBetween('sales.created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('sales.cashier_id', $userId))
            ->when($paymentMethod, fn($q) => $q->where('sales.payment_method', $paymentMethod))
            ->selectRaw('
                COALESCE(categories.id, 0) as category_id,
                MAX(COALESCE(categories.name, \'Uncategorized\')) as category_name,
                COUNT(DISTINCT sale_items.product_id) as unique_products_sold,
                SUM(COALESCE(sale_items.base_quantity, sale_items.quantity)) as units_sold,
                SUM(sale_items.subtotal) as total_revenue,
                SUM(COALESCE(sale_items.cost_price_snapshot, products.cost_price, 0) * COALESCE(sale_items.base_quantity, sale_items.quantity)) as total_cost
            ')
            ->groupBy(DB::raw('COALESCE(categories.id, 0)'))
            ->orderByDesc('total_revenue')
            ->get();

        $categoryBreakdown = $categoryBreakdownRaw->map(function ($c) use ($totalSalesCents) {
            $rev = (int)$c->total_revenue;
            $cost = (int) round((float)$c->total_cost);
            $profit = $rev - $cost;
            return [
                'category_id' => $c->category_id,
                'name' => $c->category_name,
                'unique_products_sold' => (int)$c->unique_products_sold,
                'units_sold' => Quantity::toNumber($c->units_sold ?? 0),
                'total_revenue' => $rev,
                'total_cost' => $cost,
                'total_profit' => $profit,
                'revenue_share' => $totalSalesCents > 0 ? round(($rev / $totalSalesCents) * 100, 1) : 0,
            ];
        });

        // ---------------------------------------------------------------------
        // DOMAIN 3: INVENTORY HEALTH & STOCK VALUATION
        // ---------------------------------------------------------------------
        $productsCatalog = Product::where('store_id', $storeId)
            ->with(['category', 'units'])
            ->when($categoryId, fn($q) => $q->where('category_id', $categoryId))
            ->when($search, function ($q) use ($search) {
                $q->where(function ($sub) use ($search) {
                    $sub->where('name', 'like', "%{$search}%")
                        ->orWhere('sku', 'like', "%{$search}%");
                });
            })
            ->orderBy('name', 'asc')
            ->get();

        $inventoryTotalSkus = $productsCatalog->count();
        $inventoryTotalUnits = '0';
        $inventoryTotalCostValue = 0;
        $inventoryTotalRetailValue = 0;
        $inventoryTotalWholesaleValue = 0;
        $healthyStockCount = 0;
        $lowStockCount = 0;
        $outOfStockCount = 0;
        $archivedItemsCount = 0;
        $missingCostItemsCount = 0;

        $inventoryItems = $productsCatalog->map(function ($item) use (
            &$inventoryTotalUnits,
            &$inventoryTotalCostValue,
            &$inventoryTotalRetailValue,
            &$inventoryTotalWholesaleValue,
            &$healthyStockCount,
            &$lowStockCount,
            &$outOfStockCount,
            &$archivedItemsCount,
            &$missingCostItemsCount
        ) {
            $qty = Quantity::normalize($item->stock_quantity);
            $cost = $item->cost_price !== null ? (int) $item->cost_price : null;
            $isMulti = $item->selling_method === Product::SELLING_METHOD_MULTIPLE;
            $defaultUnit = $isMulti ? $item->defaultUnit() : null;

            // Standard products value stock at their single price. Multi-UOM
            // products derive a per-base-unit value from the default unit.
            $retail = $isMulti
                ? ($defaultUnit ? Quantity::toInt(Quantity::divide($defaultUnit->price, $defaultUnit->conversion_factor)) : 0)
                : (int) ($item->price ?? 0);
            $wholesale = $isMulti
                ? ($defaultUnit ? Quantity::toInt(Quantity::divide($defaultUnit->wholesale_price, $defaultUnit->conversion_factor)) : 0)
                : (int) ($item->wholesale_price ?? $item->price ?? 0);

            $costValue = $cost !== null ? Quantity::toInt(Quantity::multiply($cost, $qty)) : 0;
            $retailValue = Quantity::toInt(Quantity::multiply($retail, $qty));
            $wholesaleValue = Quantity::toInt(Quantity::multiply($wholesale, $qty));

            if ($item->is_active) {
                $inventoryTotalUnits = Quantity::add($inventoryTotalUnits, $qty);
                $inventoryTotalCostValue += $costValue;
                $inventoryTotalRetailValue += $retailValue;
                $inventoryTotalWholesaleValue += $wholesaleValue;

                if ($cost === null) {
                    $missingCostItemsCount++;
                }

                if (Quantity::compare($qty, '0') <= 0) {
                    $outOfStockCount++;
                    $status = 'out_of_stock';
                } elseif (Quantity::compare($qty, '10') <= 0) {
                    $lowStockCount++;
                    $status = 'low_stock';
                } else {
                    $healthyStockCount++;
                    $status = 'in_stock';
                }
            } else {
                $archivedItemsCount++;
                $status = 'archived';
            }

            $unrealizedProfit = $retailValue - $costValue;
            $marginPct = $retail > 0 ? round((($retail - ($cost ?? 0)) / $retail) * 100, 1) : 0;

            return [
                'id' => $item->id,
                'name' => $item->name,
                'sku' => $item->sku ?? 'N/A',
                'category_name' => $item->category->name ?? 'Uncategorized',
                'category_id' => $item->category_id,
                'selling_method' => $item->selling_method,
                'is_multi_unit' => $isMulti,
                'base_unit' => $item->base_unit,
                'quantity_precision' => $item->quantity_precision,
                'default_unit_name' => $defaultUnit ? $defaultUnit->name : null,
                'cost_price' => $cost ?? 0,
                'has_cost_price' => $cost !== null,
                'wholesale_price' => $wholesale,
                'retail_price' => $retail,
                'stock_quantity' => Quantity::toNumber($qty),
                'total_cost_value' => $costValue,
                'total_retail_value' => $retailValue,
                'unrealized_profit' => $unrealizedProfit,
                'margin_percent' => $marginPct,
                'is_active' => (bool)$item->is_active,
                'status' => $status,
            ];
        });

        // Category Valuation Breakdown for Visualizations (base-unit values)
        $categoryValuations = $inventoryItems
            ->where('is_active', true)
            ->groupBy('category_id')
            ->map(function ($items) {
                $first = $items->first();
                $units = $items->reduce(
                    fn ($carry, $row) => Quantity::add($carry, $row['stock_quantity']),
                    '0'
                );
                $cost = (int) $items->sum('total_cost_value');
                $retail = (int) $items->sum('total_retail_value');

                return [
                    'name' => $first['category_name'],
                    'skus_count' => $items->count(),
                    'total_units' => Quantity::toNumber($units),
                    'total_cost_value' => $cost,
                    'total_retail_value' => $retail,
                    'unrealized_profit' => $retail - $cost,
                ];
            })
            ->sortByDesc('total_retail_value')
            ->values();

        // ---------------------------------------------------------------------
        // DOMAIN 4: SHIFTS & CASH RECONCILIATION AUDIT
        // ---------------------------------------------------------------------
        $shiftsQuery = Shift::where('store_id', $storeId)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->with(['user', 'terminal'])
            ->when($userId, fn($q) => $q->where('user_id', $userId))
            ->orderBy('start_time', 'desc');

        $shiftsList = $shiftsQuery->get();

        $totalShiftsCount = $shiftsList->count();
        $totalOverages = 0;
        $totalShortages = 0;
        $netDiscrepancy = 0;

        $shiftsReport = $shiftsList->map(function ($s) use (&$totalOverages, &$totalShortages, &$netDiscrepancy) {
            $diff = (float)($s->difference ?? 0);
            $netDiscrepancy += $diff;

            if ($diff > 0) {
                $totalOverages += $diff;
            } elseif ($diff < 0) {
                $totalShortages += abs($diff);
            }

            return [
                'id' => $s->id,
                'cashier_name' => $s->user->name ?? 'Unknown Cashier',
                'cashier_email' => $s->user->email ?? '',
                'user_id' => $s->user_id,
                'terminal_name' => $s->terminal->name ?? 'Register #1',
                'start_time' => $s->start_time ? $s->start_time->toIso8601String() : null,
                'end_time' => $s->end_time ? $s->end_time->toIso8601String() : null,
                'status' => $s->status,
                'starting_cash' => (float)$s->starting_cash,
                'cash_sales' => (float)$s->cash_sales,
                'cash_in' => (float)$s->cash_in,
                'cash_out' => (float)$s->cash_out,
                'expected_cash' => (float)$s->expected_cash,
                'actual_cash' => $s->actual_cash !== null ? (float)$s->actual_cash : null,
                'difference' => $diff,
                'opening_notes' => $s->opening_notes,
                'closing_notes' => $s->closing_notes,
            ];
        });

        // Cash Movements Breakdown for Period
        $cashMovementsQuery = CashMovement::where('store_id', $storeId)
            ->whereBetween('created_at', [$startDate, $endDate])
            ->when($userId, fn($q) => $q->where('user_id', $userId));

        $totalCashIn = (float)(clone $cashMovementsQuery)->where('type', 'cash_in')->sum('amount');
        $totalCashOut = (float)(clone $cashMovementsQuery)->where('type', 'cash_out')->sum('amount');
        $totalCashSalesShifts = (float)$shiftsList->sum('cash_sales');

        // ---------------------------------------------------------------------
        // FILTER METADATA & SYSTEM SETTINGS
        // ---------------------------------------------------------------------
        $categoriesList = Category::where('store_id', $storeId)
            ->orderBy('name', 'asc')
            ->get(['id', 'name']);

        $store = Store::find($storeId);

        return response()->json([
            'summary' => [
                'total_sales' => $totalSalesCents,
                'total_orders' => $totalOrdersCount,
                'average_order_value' => $averageOrderValueCents,
                'total_discounts' => $totalDiscountsCents,
                'total_units_sold' => $totalUnitsSold,
                'total_cogs' => $totalCogsCents,
                'total_gross_profit' => $totalGrossProfitCents,
                'gross_margin_percent' => $grossMarginPct,
                'void_count' => $voidCount,
                'void_amount' => $voidAmountCents,
                'inventory_skus' => $inventoryTotalSkus,
                'inventory_units' => Quantity::toNumber($inventoryTotalUnits),
                'inventory_cost_value' => $inventoryTotalCostValue,
                'inventory_retail_value' => $inventoryTotalRetailValue,
                'inventory_unrealized_profit' => $inventoryTotalRetailValue - $inventoryTotalCostValue,
                'inventory_missing_cost_count' => $missingCostItemsCount,
                'healthy_stock_count' => $healthyStockCount,
                'low_stock_count' => $lowStockCount,
                'out_of_stock_count' => $outOfStockCount,
                'shifts_count' => $totalShiftsCount,
                'net_cash_discrepancy' => $netDiscrepancy,
                'total_cash_overage' => $totalOverages,
                'total_cash_shortage' => $totalShortages,
            ],
            'sales_report' => [
                'daily_breakdown' => $dailySales,
                'payment_methods' => $paymentMethods,
                'hourly_velocity' => $hourlySales,
            ],
            'product_report' => [
                'products' => $productReports,
                'categories' => $categoryBreakdown,
            ],
            'inventory_report' => [
                'items' => $inventoryItems,
                'categories_valuation' => $categoryValuations,
                'total_skus' => $inventoryTotalSkus,
                'total_units' => Quantity::toNumber($inventoryTotalUnits),
                'total_cost_value' => $inventoryTotalCostValue,
                'total_retail_value' => $inventoryTotalRetailValue,
                'missing_cost_count' => $missingCostItemsCount,
                'healthy_count' => $healthyStockCount,
                'low_stock_count' => $lowStockCount,
                'out_of_stock_count' => $outOfStockCount,
            ],
            'shift_report' => [
                'shifts' => $shiftsReport,
                'cash_movements' => [
                    'total_cash_sales' => $totalCashSalesShifts,
                    'total_cash_in' => $totalCashIn,
                    'total_cash_out' => $totalCashOut,
                ],
                'total_shifts' => $totalShiftsCount,
                'total_overage' => $totalOverages,
                'total_shortage' => $totalShortages,
                'net_discrepancy' => $netDiscrepancy,
            ],
            'meta' => [
                'categories' => $categoriesList,
                'store' => [
                    'name' => $store->name ?? 'POS Retail Store',
                    'address' => $store->address ?? '',
                    'phone' => $store->phone ?? '',
                ],
                'date_range' => [
                    'start_date' => $startDate->toDateString(),
                    'end_date' => $endDate->toDateString(),
                ]
            ]
        ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Reports API Error: ' . $e->getMessage() . "\n" . $e->getTraceAsString());
            return response()->json([
                'message' => 'Failed to retrieve reports data: ' . $e->getMessage(),
                'error' => config('app.debug') ? $e->getTraceAsString() : null
            ], 500);
        }
    }

    /**
     * Hour-of-day SQL expression that works on SQLite (standalone) and MySQL.
     */
    private static function hourExpression(string $column): string
    {
        return DB::connection()->getDriverName() === 'sqlite'
            ? "CAST(strftime('%H', {$column}) AS INTEGER)"
            : "HOUR({$column})";
    }
}
