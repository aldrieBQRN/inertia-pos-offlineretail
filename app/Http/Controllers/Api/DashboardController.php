<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sale;
use App\Models\SaleItem;
use App\Models\Product;
use App\Models\Shift;
use App\Models\ActivityLog;
use Illuminate\Http\Request;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Handles real-time dashboard analytics and executive business monitoring.
 */
class DashboardController extends Controller
{
    /**
     * DASHBOARD: Real-time, at-a-glance store monitoring.
     */
    public function index(Request $request)
    {
        $storeId = \App\Support\CurrentStore::id() ?? $request->user()->store_id;

        $tz = config('app.timezone', 'Asia/Manila');
        $today = Carbon::now($tz)->startOfDay();
        $endOfToday = Carbon::now($tz)->endOfDay();
        $yesterday = Carbon::now($tz)->subDay()->startOfDay();
        $endOfYesterday = Carbon::now($tz)->subDay()->endOfDay();

        // 1. KPI Cards (Today vs Yesterday)
        $todaySales = (int) Sale::where('store_id', $storeId)->where('status', '!=', 'void')->whereBetween('created_at', [$today, $endOfToday])->sum('total_amount');
        $todayOrders = (int) Sale::where('store_id', $storeId)->where('status', '!=', 'void')->whereBetween('created_at', [$today, $endOfToday])->count();
        $averageOrderValue = $todayOrders > 0 ? (int) ($todaySales / $todayOrders) : 0;

        // Today's Profit: sold price minus cost price minus discounts
        $todayItemProfit = (int) DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', '!=', 'void')
            ->whereBetween('sales.created_at', [$today, $endOfToday])
            ->sum(DB::raw('(sale_items.unit_price - COALESCE(products.cost_price, 0)) * sale_items.quantity'));

        $todayDiscounts = (int) Sale::where('store_id', $storeId)
            ->where('status', '!=', 'void')
            ->whereBetween('created_at', [$today, $endOfToday])
            ->sum('discount_amount');

        $todayProfit = $todayItemProfit - $todayDiscounts;
        $profitMargin = $todaySales > 0 ? round(($todayProfit / $todaySales) * 100, 1) : 0.0;

        // Yesterday's stats for growth calculations
        $yesterdaySales = (int) Sale::where('store_id', $storeId)->where('status', '!=', 'void')->whereBetween('created_at', [$yesterday, $endOfYesterday])->sum('total_amount');
        $yesterdayOrders = (int) Sale::where('store_id', $storeId)->where('status', '!=', 'void')->whereBetween('created_at', [$yesterday, $endOfYesterday])->count();
        $yesterdayAverageOrderValue = $yesterdayOrders > 0 ? (int) ($yesterdaySales / $yesterdayOrders) : 0;

        $yesterdayItemProfit = (int) DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', '!=', 'void')
            ->whereBetween('sales.created_at', [$yesterday, $endOfYesterday])
            ->sum(DB::raw('(sale_items.unit_price - COALESCE(products.cost_price, 0)) * sale_items.quantity'));

        $yesterdayDiscounts = (int) Sale::where('store_id', $storeId)
            ->where('status', '!=', 'void')
            ->whereBetween('created_at', [$yesterday, $endOfYesterday])
            ->sum('discount_amount');

        $yesterdayProfit = $yesterdayItemProfit - $yesterdayDiscounts;

        $calculateGrowth = function ($current, $previous) {
            if ($previous > 0) {
                return round((($current - $previous) / $previous) * 100, 1);
            } elseif ($previous < 0) {
                return round((($current - $previous) / abs($previous)) * 100, 1);
            } else {
                return $current > 0 ? 100.0 : ($current < 0 ? -100.0 : 0.0);
            }
        };

        $salesGrowth = $calculateGrowth($todaySales, $yesterdaySales);
        $profitGrowth = $calculateGrowth($todayProfit, $yesterdayProfit);
        $ordersGrowth = $calculateGrowth($todayOrders, $yesterdayOrders);
        $aovGrowth = $calculateGrowth($averageOrderValue, $yesterdayAverageOrderValue);

        // 2. Sales Performance Chart (Period-aware)
        $periodType = $request->get('period', 'today_hourly');
        $chartData = [];

        if ($periodType === 'today_hourly') {
            // Fetch all non-void sales and group by local timezone hour (Asia/Manila)
            $tz = config('app.timezone', 'Asia/Manila');
            $todayLocalStr = Carbon::now($tz)->format('Y-m-d');

            $allStoreSales = Sale::where('store_id', $storeId)
                ->where('status', '!=', 'void')
                ->get();

            $hourlySales = [];
            foreach ($allStoreSales as $s) {
                // Parse timestamp and convert to store timezone
                $carbonDt = Carbon::parse($s->getRawOriginal('created_at') ?: $s->created_at)->setTimezone($tz);
                if ($carbonDt->format('Y-m-d') === $todayLocalStr) {
                    $h = (int) $carbonDt->format('G'); // 0 - 23 hour format in local timezone
                    if (!isset($hourlySales[$h])) {
                        $hourlySales[$h] = ['total_sales' => 0, 'orders_count' => 0];
                    }
                    $hourlySales[$h]['total_sales'] += (int) $s->total_amount;
                    $hourlySales[$h]['orders_count'] += 1;
                }
            }

            $saleItemsToday = DB::table('sale_items')
                ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
                ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
                ->where('sales.store_id', $storeId)
                ->where('sales.status', '!=', 'void')
                ->select(
                    'sales.created_at',
                    DB::raw('(sale_items.unit_price - COALESCE(products.cost_price, 0)) * sale_items.quantity as item_profit')
                )
                ->get();

            $hourlyProfits = [];
            foreach ($saleItemsToday as $si) {
                $carbonDt = Carbon::parse($si->created_at)->setTimezone($tz);
                if ($carbonDt->format('Y-m-d') === $todayLocalStr) {
                    $h = (int) $carbonDt->format('G');
                    if (!isset($hourlyProfits[$h])) {
                        $hourlyProfits[$h] = 0;
                    }
                    $hourlyProfits[$h] += (int) $si->item_profit;
                }
            }

            for ($h = 0; $h < 24; $h++) {
                $label = Carbon::createFromTime($h, 0)->format('g A');
                $salesCent = isset($hourlySales[$h]) ? $hourlySales[$h]['total_sales'] : 0;
                $profitCent = isset($hourlyProfits[$h]) ? $hourlyProfits[$h] : 0;
                $orders = isset($hourlySales[$h]) ? $hourlySales[$h]['orders_count'] : 0;

                $chartData[] = [
                    'label' => $label,
                    'hour' => $h,
                    'sales' => $salesCent / 100,
                    'profit' => $profitCent / 100,
                    'orders' => $orders
                ];
            }
        } elseif ($periodType === 'last_7_days') {
            $trendStart = Carbon::now()->subDays(6)->startOfDay();
            $rawSales = Sale::select(
                DB::raw('DATE(created_at) as date'),
                DB::raw('SUM(total_amount) as total_sales'),
                DB::raw('COUNT(*) as orders_count')
            )
                ->where('store_id', $storeId)
                ->where('status', '!=', 'void')
                ->whereBetween('created_at', [$trendStart, $endOfToday])
                ->groupBy('date')
                ->get()
                ->keyBy('date');

            $rawProfits = DB::table('sale_items')
                ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
                ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
                ->where('sales.store_id', $storeId)
                ->where('sales.status', '!=', 'void')
                ->whereBetween('sales.created_at', [$trendStart, $endOfToday])
                ->select(
                    DB::raw('DATE(sales.created_at) as date'),
                    DB::raw('SUM((sale_items.unit_price - COALESCE(products.cost_price, 0)) * sale_items.quantity) as item_profit')
                )
                ->groupBy('date')
                ->get()
                ->keyBy('date');

            $periodDates = \Carbon\CarbonPeriod::create($trendStart, $endOfToday);
            foreach ($periodDates as $date) {
                $dateKey = $date->format('Y-m-d');
                $salesCent = isset($rawSales[$dateKey]) ? (int) $rawSales[$dateKey]->total_sales : 0;
                $profitCent = isset($rawProfits[$dateKey]) ? (int) $rawProfits[$dateKey]->item_profit : 0;
                $orders = isset($rawSales[$dateKey]) ? (int) $rawSales[$dateKey]->orders_count : 0;

                $chartData[] = [
                    'label' => $date->format('M d'),
                    'sales' => $salesCent / 100,
                    'profit' => $profitCent / 100,
                    'orders' => $orders
                ];
            }
        } elseif ($periodType === 'this_month') {
            $monthStart = Carbon::now()->startOfMonth();
            $rawSales = Sale::select(
                DB::raw('DATE(created_at) as date'),
                DB::raw('SUM(total_amount) as total_sales'),
                DB::raw('COUNT(*) as orders_count')
            )
                ->where('store_id', $storeId)
                ->where('status', '!=', 'void')
                ->whereBetween('created_at', [$monthStart, $endOfToday])
                ->groupBy('date')
                ->get()
                ->keyBy('date');

            $rawProfits = DB::table('sale_items')
                ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
                ->leftJoin('products', 'sale_items.product_id', '=', 'products.id')
                ->where('sales.store_id', $storeId)
                ->where('sales.status', '!=', 'void')
                ->whereBetween('sales.created_at', [$monthStart, $endOfToday])
                ->select(
                    DB::raw('DATE(sales.created_at) as date'),
                    DB::raw('SUM((sale_items.unit_price - COALESCE(products.cost_price, 0)) * sale_items.quantity) as item_profit')
                )
                ->groupBy('date')
                ->get()
                ->keyBy('date');

            $periodDates = \Carbon\CarbonPeriod::create($monthStart, $endOfToday);
            foreach ($periodDates as $date) {
                $dateKey = $date->format('Y-m-d');
                $salesCent = isset($rawSales[$dateKey]) ? (int) $rawSales[$dateKey]->total_sales : 0;
                $profitCent = isset($rawProfits[$dateKey]) ? (int) $rawProfits[$dateKey]->item_profit : 0;
                $orders = isset($rawSales[$dateKey]) ? (int) $rawSales[$dateKey]->orders_count : 0;

                $chartData[] = [
                    'label' => $date->format('M d'),
                    'sales' => $salesCent / 100,
                    'profit' => $profitCent / 100,
                    'orders' => $orders
                ];
            }
        }

        // 3. Current Live Shift / Register Status
        $activeShift = Shift::where('store_id', $storeId)
            ->where('status', 'open')
            ->with(['user', 'terminal', 'cashMovements.user'])
            ->latest('start_time')
            ->first();

        $shiftData = null;
        if ($activeShift) {
            // An open shift's stored totals are only written when it closes, so compute the
            // live drawer the same way the POS does (cash sales + Cash In/Out recorded so far)
            $activeShift->cash_sales = (float) Sale::where('cashier_id', $activeShift->user_id)
                ->where('status', 'completed')
                ->where('payment_method', 'cash')
                ->where('created_at', '>=', $activeShift->start_time)
                ->sum('total_amount') / 100;
            $activeShift->cash_in = (float) $activeShift->cashMovements->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
            $activeShift->cash_out = (float) $activeShift->cashMovements->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');

            $shiftData = [
                'id' => $activeShift->id,
                'cashier_name' => $activeShift->user ? $activeShift->user->name : 'Unknown Cashier',
                'cashier_role' => $activeShift->user ? $activeShift->user->role : 'cashier',
                'terminal_name' => $activeShift->terminal ? $activeShift->terminal->name : 'POS Register',
                'start_time' => $activeShift->start_time ? $activeShift->start_time->toISOString() : null,
                'starting_cash' => (float) $activeShift->starting_cash,
                'cash_sales' => (float) $activeShift->cash_sales,
                'cash_in' => (float) $activeShift->cash_in,
                'cash_out' => (float) $activeShift->cash_out,
                'expenses' => (float) $activeShift->expenses,
                'expected_cash' => (float) ($activeShift->starting_cash + $activeShift->cash_sales + $activeShift->cash_in - $activeShift->cash_out - $activeShift->expenses),
                'movements_count' => $activeShift->cashMovements ? $activeShift->cashMovements->count() : 0,
            ];
        }

        // 4. Payment Method Summary (Today)
        $paymentMethodsRaw = Sale::select('payment_method', DB::raw('SUM(total_amount) as total'), DB::raw('COUNT(*) as count'))
            ->where('store_id', $storeId)
            ->where('status', '!=', 'void')
            ->whereBetween('created_at', [$today, $endOfToday])
            ->groupBy('payment_method')
            ->get();

        $paymentMethods = [];
        $totalTenderedCents = $paymentMethodsRaw->sum('total');
        foreach ($paymentMethodsRaw as $pm) {
            $pmName = $pm->payment_method ?: 'cash';
            $pmTotalCent = (int) $pm->total;
            $percentage = $totalTenderedCents > 0 ? round(($pmTotalCent / $totalTenderedCents) * 100, 1) : 0;
            $paymentMethods[] = [
                'method' => $pmName,
                'total' => $pmTotalCent / 100,
                'count' => (int) $pm->count,
                'percentage' => $percentage
            ];
        }

        // 5. Inventory Attention Center (Out-of-Stock & Critical Low Stock)
        $outOfStockItems = Product::where('store_id', $storeId)
            ->where('is_active', true)
            ->where('stock_quantity', '<=', 0)
            ->with('category')
            ->orderBy('name')
            ->limit(5)
            ->get()
            ->map(function ($p) {
                return [
                    'id' => $p->id,
                    'name' => $p->name,
                    'sku' => $p->sku,
                    'category_name' => $p->category ? $p->category->name : 'Uncategorized',
                    'stock_quantity' => $p->stock_quantity,
                    'price' => $p->price / 100,
                    'status' => 'out_of_stock'
                ];
            });

        $lowStockItems = Product::where('store_id', $storeId)
            ->where('is_active', true)
            ->where('stock_quantity', '>', 0)
            ->whereRaw('stock_quantity <= COALESCE(low_stock_threshold, 10)')
            ->with('category')
            ->orderBy('stock_quantity', 'asc')
            ->limit(5)
            ->get()
            ->map(function ($p) {
                return [
                    'id' => $p->id,
                    'name' => $p->name,
                    'sku' => $p->sku,
                    'category_name' => $p->category ? $p->category->name : 'Uncategorized',
                    'stock_quantity' => $p->stock_quantity,
                    'price' => $p->price / 100,
                    'status' => 'low_stock'
                ];
            });

        $totalOutOfStockCount = Product::where('store_id', $storeId)->where('is_active', true)->where('stock_quantity', '<=', 0)->count();
        $totalLowStockCount = Product::where('store_id', $storeId)->where('is_active', true)->where('stock_quantity', '>', 0)->whereRaw('stock_quantity <= COALESCE(low_stock_threshold, 10)')->count();
        $totalActiveProducts = Product::where('store_id', $storeId)->where('is_active', true)->count();

        // 6. Top Selling Products (Today) - Deterministic ordering by units_sold desc, total_revenue desc, product id asc
        $topProducts = DB::table('sale_items')
            ->join('sales', 'sale_items.sale_id', '=', 'sales.id')
            ->join('products', 'sale_items.product_id', '=', 'products.id')
            ->leftJoin('categories', 'products.category_id', '=', 'categories.id')
            ->where('sales.store_id', $storeId)
            ->where('sales.status', '!=', 'void')
            ->whereBetween('sales.created_at', [$today, $endOfToday])
            ->select(
                'products.id',
                'products.name',
                'products.sku',
                'categories.name as category_name',
                DB::raw('SUM(sale_items.quantity) as units_sold'),
                DB::raw('SUM(sale_items.unit_price * sale_items.quantity) as total_revenue')
            )
            ->groupBy('products.id', 'products.name', 'products.sku', 'categories.name')
            ->orderByDesc('units_sold')
            ->orderByDesc('total_revenue')
            ->orderBy('products.id', 'asc')
            ->limit(5)
            ->get()
            ->map(function ($tp) {
                return [
                    'id' => $tp->id,
                    'name' => $tp->name,
                    'sku' => $tp->sku,
                    'category_name' => $tp->category_name ?? 'General',
                    'units_sold' => (int) $tp->units_sold,
                    'total_revenue' => ((int) $tp->total_revenue) / 100,
                ];
            });

        // 7. Today's Recent Transactions
        $recentTransactions = Sale::with(['items', 'cashier'])
            ->where('store_id', $storeId)
            ->whereBetween('created_at', [$today, $endOfToday])
            ->orderBy('created_at', 'desc')
            ->orderBy('id', 'desc')
            ->limit(5)
            ->get()
            ->map(function ($s) {
                return [
                    'id' => $s->id,
                    'invoice_number' => $s->invoice_number,
                    'created_at' => $s->created_at ? $s->created_at->toIso8601String() : null,
                    'time_formatted' => $s->created_at ? $s->created_at->timezone(config('app.timezone', 'Asia/Manila'))->format('g:i A') : '',
                    'cashier_name' => $s->cashier ? $s->cashier->name : 'Cashier',
                    'payment_method' => $s->payment_method ?: 'cash',
                    'total_amount' => $s->total_amount / 100,
                    'discount_amount' => $s->discount_amount / 100,
                    'status' => $s->status,
                    'items_count' => $s->items->sum('quantity')
                ];
            });

        // 8. Recent System Activity Feed
        $recentActivities = ActivityLog::where('store_id', $storeId)
            ->with('user')
            ->latest('created_at')
            ->limit(5)
            ->get()
            ->map(function ($log) {
                return [
                    'id' => $log->id,
                    'action' => $log->action,
                    'category' => $log->category,
                    'description' => $log->description,
                    'user_name' => $log->user ? $log->user->name : 'System',
                    'created_at' => $log->created_at->toISOString(),
                    'time_ago' => $log->created_at->diffForHumans()
                ];
            });

        return response()->json([
            'kpi' => [
                'today_sales' => $todaySales / 100,
                'sales_growth' => $salesGrowth,
                'today_profit' => $todayProfit / 100,
                'profit_growth' => $profitGrowth,
                'profit_margin' => $profitMargin,
                'today_orders' => $todayOrders,
                'orders_growth' => $ordersGrowth,
                'average_order_value' => $averageOrderValue / 100,
                'aov_growth' => $aovGrowth,
            ],
            'chart_data' => $chartData,
            'period' => $periodType,
            'active_shift' => $shiftData,
            'payment_methods' => $paymentMethods,
            'inventory_alerts' => [
                'out_of_stock' => $outOfStockItems,
                'low_stock' => $lowStockItems,
                'out_of_stock_count' => $totalOutOfStockCount,
                'low_stock_count' => $totalLowStockCount,
                'total_active' => $totalActiveProducts,
            ],
            'top_products' => $topProducts,
            'recent_transactions' => $recentTransactions,
            'recent_activities' => $recentActivities,
            'meta' => [
                'store_name' => $request->user()->store ? $request->user()->store->name : 'POS Store',
                'current_time' => Carbon::now()->toISOString(),
                'formatted_time' => Carbon::now()->format('F j, Y · g:i A')
            ]
        ]);
    }
}
