<?php

use App\Http\Controllers\Api\CategoryController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\HeldOrderController;
use App\Http\Controllers\Api\PosController;
use App\Http\Controllers\Api\ProductController;
use App\Http\Controllers\Api\SettingController;
use App\Http\Controllers\Api\ShiftController;
use App\Http\Controllers\Api\TerminalController;
use App\Http\Controllers\Api\TransactionController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\LicenseController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\SetupController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;

/**
 * OFFLINE LICENSE ACTIVATION
 * Must be completed on this device before First-Time Setup.
 */
Route::get('/activate', [LicenseController::class, 'show'])->name('activate');
Route::post('/activate', [LicenseController::class, 'activate'])->middleware('throttle:guest_api')->name('activate.store');
Route::post('/activate/deactivate', [LicenseController::class, 'deactivate'])->name('activate.deactivate');

/**
 * FIRST-TIME SETUP
 * Only reachable after activation until the Admin account exists (see EnsureAppIsConfigured).
 */
Route::middleware('guest')->group(function () {
    Route::get('/setup', [SetupController::class, 'show'])->name('setup');
    Route::post('/setup', [SetupController::class, 'store'])->middleware('throttle:guest_api')->name('setup.store');
    // Per-step checks while the wizard moves forward (nothing is saved)
    Route::post('/setup/validate/{step}', [SetupController::class, 'validateStep'])
        ->whereNumber('step')->middleware('throttle:60,1')->name('setup.validate');
});


// Explicit route for Web App Manifest to ensure correct application/manifest+json Content-Type
Route::get('/manifest.webmanifest', function () {
    $path = public_path('manifest.webmanifest');
    if (file_exists($path)) {
        return response()->file($path, [
            'Content-Type' => 'application/manifest+json; charset=utf-8',
            'Cache-Control' => 'public, max-age=3600'
        ]);
    }
    return response()->json(['name' => 'Inertia POS', 'short_name' => 'POS', 'start_url' => '/'], 200, [
        'Content-Type' => 'application/manifest+json; charset=utf-8'
    ]);
});

// Standalone offline route to serve public uploads directly without requiring NTFS symlinks
Route::get('/storage/{path}', function (string $path) {
    if (!Storage::disk('public')->exists($path)) {
        abort(404);
    }
    return Storage::disk('public')->response($path);
})->where('path', '.*');

/**
 * ROOT REDIRECT LOGIC
 */
Route::get('/', function () {
    return redirect()->route(Auth::check() ? 'dashboard' : 'login');
});


/**
 * MAIN APPLICATION VIEWS (Inertia/React)
 * The single Admin account has access to every page.
 */
Route::middleware(['auth'])->group(function () {

    // Dashboard
    Route::get('/dashboard', function (Request $request) {

        $statsRes = app(\App\Http\Controllers\Api\DashboardController::class)->index($request);
        $stats = $statsRes instanceof \Illuminate\Http\JsonResponse ? $statsRes->getData(true) : $statsRes;

        return Inertia::render('Dashboard', [
            'initial_stats' => $stats,
        ]);
    })->name('dashboard');

    // Analytics & Reports
    Route::get('/reports', function (Request $request) {

        $reportsRes = app(\App\Http\Controllers\Api\ReportController::class)->index($request);
        $reportData = $reportsRes instanceof \Illuminate\Http\JsonResponse ? $reportsRes->getData(true) : $reportsRes;

        return Inertia::render('Reports', [
            'initial_report_data' => $reportData,
        ]);
    })->name('reports');

    // POS Terminal
    Route::get('/pos', function (Request $request) {

        $storeId = \App\Support\CurrentStore::id();

        // Preload data so POS renders instantly with zero loading delay or layout shift
        $terminalsRes = app(\App\Http\Controllers\Api\TerminalController::class)->index($request);
        $terminals = $terminalsRes instanceof \Illuminate\Http\JsonResponse ? $terminalsRes->getData(true) : $terminalsRes;

        $categories = \App\Models\Category::where('store_id', $storeId)
            ->orderBy('name', 'asc')
            ->get();

        $products = \App\Models\Product::where('store_id', $storeId)
            ->where('is_active', true)
            ->with('category')
            ->orderBy('name', 'asc')
            ->get();

        $shiftRes = app(\App\Http\Controllers\Api\ShiftController::class)->current($request);
        $shiftData = $shiftRes instanceof \Illuminate\Http\JsonResponse ? $shiftRes->getData(true) : $shiftRes;
        $heldOrders = \App\Models\HeldOrder::where('store_id', $storeId)->orderBy('created_at', 'desc')->get();

        return Inertia::render('PosTerminal', [
            'initial_shift_data' => $shiftData,
            'initial_terminals' => $terminals,
            'initial_categories' => $categories,
            'initial_products' => $products,
            'initial_held_orders' => $heldOrders,
        ]);
    })->name('pos');

    // Inventory Management
    Route::get('/inventory', function (Request $request) {

        $storeId = \App\Support\CurrentStore::id();

        $categories = \App\Models\Category::where('store_id', $storeId)
            ->orderBy('name', 'asc')
            ->get();

        $products = \App\Models\Product::where('store_id', $storeId)
            ->with('category')
            ->orderBy('created_at', 'desc')
            ->get();

        // Preload recent activity feed for instant zero-delay modal opening
        $logs = \App\Models\ActivityLog::where('store_id', $storeId)
            ->where(function ($q) {
                $q->whereIn('model_type', ['Product', 'Inventory', 'Category'])
                  ->orWhere('action', 'like', '%stock%')
                  ->orWhere('action', 'like', '%product%')
                  ->orWhere('action', 'like', '%category%');
            })
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->limit(50)
            ->get()
            ->map(function ($log) {
                return [
                    'id' => 'log-' . $log->id,
                    'action' => $log->action,
                    'model_type' => $log->model_type,
                    'model_id' => $log->model_id,
                    'reference_no' => 'LOG-' . str_pad($log->id, 5, '0', STR_PAD_LEFT),
                    'description' => $log->description,
                    'user_name' => $log->user ? $log->user->name : 'System',
                    'user_avatar' => $log->user && $log->user->avatar_path ? (str_starts_with($log->user->avatar_path, 'http') ? $log->user->avatar_path : asset('storage/' . $log->user->avatar_path)) : null,
                    'user_account_number' => $log->user ? $log->user->account_number : null,
                    'old_values' => $log->old_values,
                    'new_values' => $log->new_values,
                    'created_at' => $log->created_at ? $log->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

        $sales = \App\Models\SaleItem::whereHas('sale', fn($q) => $q->where('store_id', $storeId))
            ->with(['sale.cashier', 'product'])
            ->orderBy('created_at', 'desc')
            ->limit(30)
            ->get()
            ->map(function ($item) {
                $prodName = $item->product ? $item->product->name : ($item->custom_name ?: 'Product Item');
                $invoice = $item->sale ? $item->sale->invoice_number : '';
                return [
                    'id' => 'sale-' . $item->id,
                    'action' => 'stock.sale',
                    'model_type' => 'Product',
                    'model_id' => $item->product_id,
                    'invoice_number' => $invoice,
                    'reference_no' => $invoice ?: ('SALE-' . str_pad($item->sale_id ?: $item->id, 5, '0', STR_PAD_LEFT)),
                    'sku' => $item->product ? $item->product->sku : null,
                    'description' => "Sold {$item->quantity}x {$prodName} via POS" . ($invoice ? " (Inv: {$invoice})" : ""),
                    'user_name' => $item->sale && $item->sale->cashier ? $item->sale->cashier->name : 'Cashier',
                    'user_avatar' => $item->sale && $item->sale->cashier && $item->sale->cashier->avatar_path ? (str_starts_with($item->sale->cashier->avatar_path, 'http') ? $item->sale->cashier->avatar_path : asset('storage/' . $item->sale->cashier->avatar_path)) : null,
                    'user_account_number' => $item->sale && $item->sale->cashier ? $item->sale->cashier->account_number : null,
                    'created_at' => $item->created_at ? $item->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

        $recentProducts = \App\Models\Product::where('store_id', $storeId)
            ->orderBy('created_at', 'desc')
            ->limit(15)
            ->get();
        // Products created through the app already have a "Created product" log; only list the rest once
        $loggedProductIds = \App\Models\ActivityLog::where('store_id', $storeId)
            ->where('model_type', 'Product')
            ->where('action', 'create')
            ->whereIn('model_id', $recentProducts->pluck('id'))
            ->pluck('model_id')
            ->all();
        $recentProducts = $recentProducts
            ->reject(fn ($p) => in_array($p->id, $loggedProductIds))
            ->map(function ($p) {
                return [
                    'id' => 'prod-reg-' . $p->id,
                    'action' => 'created',
                    'model_type' => 'Product',
                    'model_id' => $p->id,
                    'sku' => $p->sku,
                    'reference_no' => $p->sku ? ('SKU: ' . $p->sku) : ('PRD-' . str_pad($p->id, 5, '0', STR_PAD_LEFT)),
                    'description' => "Registered new product: {$p->name} (SKU: {$p->sku}) with {$p->stock_quantity} units",
                    'user_name' => 'Store Admin',
                    'user_avatar' => null,
                    'user_account_number' => null,
                    'created_at' => $p->created_at ? $p->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

        $initialActivity = $logs->concat($sales)->concat($recentProducts)->sortByDesc('created_at')->values()->take(50)->all();

        // Preload complete stock history for products so the modal opens with all movements immediately
        $allSaleItems = \App\Models\SaleItem::whereHas('sale', fn($q) => $q->where('store_id', $storeId))
            ->with(['sale.cashier'])
            ->orderBy('created_at', 'desc')
            ->get()
            ->groupBy('product_id');

        $allProductLogs = \App\Models\ActivityLog::where('store_id', $storeId)
            ->whereIn('model_type', ['Product', 'Inventory'])
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->get()
            ->groupBy('model_id');

        $stockHistories = [];
        foreach ($products as $p) {
            $prodSales = ($allSaleItems->get($p->id) ?? collect())->map(function ($item) {
                $inv = $item->sale && $item->sale->invoice_number 
                    ? $item->sale->invoice_number 
                    : ('POS-' . str_pad($item->sale_id ?? $item->id, 5, '0', STR_PAD_LEFT));

                return [
                    'id' => 'sale-' . $item->id,
                    'type' => 'sale',
                    'quantity_change' => -$item->quantity,
                    'quantity' => $item->quantity,
                    'unit_price' => $item->unit_price / 100,
                    'subtotal' => $item->subtotal / 100,
                    'invoice_number' => $inv,
                    'reference_no' => $inv,
                    'user_name' => $item->sale && $item->sale->cashier ? $item->sale->cashier->name : 'POS Cashier',
                    'user_avatar' => $item->sale && $item->sale->cashier && $item->sale->cashier->avatar_path ? (str_starts_with($item->sale->cashier->avatar_path, 'http') ? $item->sale->cashier->avatar_path : asset('storage/' . $item->sale->cashier->avatar_path)) : null,
                    'user_account_number' => $item->sale && $item->sale->cashier ? $item->sale->cashier->account_number : null,
                    'description' => "Sold {$item->quantity} unit(s) via POS (₱" . number_format($item->subtotal / 100, 2) . ")",
                    'created_at' => $item->created_at ? $item->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

            $prodLogs = ($allProductLogs->get($p->id) ?? collect())->map(function ($log) {
                $type = 'adjustment';
                $quantityChange = 0;

                if ($log->action === 'stock.adjusted' || str_contains(strtolower($log->action), 'stock')) {
                    $type = 'restock';
                    $quantityChange = (int) ($log->new_values['quantity_change'] ?? $log->new_values['quantity_added'] ?? $log->new_values['quantity'] ?? 0);
                    if ($quantityChange === 0 && isset($log->new_values['stock_quantity'], $log->old_values['stock_quantity'])) {
                        $quantityChange = (int)$log->new_values['stock_quantity'] - (int)$log->old_values['stock_quantity'];
                    }
                } elseif ($log->action === 'created' || str_contains(strtolower($log->action), 'create')) {
                    $type = 'creation';
                    $quantityChange = (int) ($log->new_values['stock'] ?? $log->new_values['stock_quantity'] ?? 0);
                }

                $refNo = 'LOG-' . str_pad($log->id, 5, '0', STR_PAD_LEFT);

                return [
                    'id' => 'log-' . $log->id,
                    'type' => $type,
                    'action' => $log->action,
                    'quantity_change' => $quantityChange,
                    'reference_no' => $refNo,
                    'invoice_number' => $refNo,
                    'old_values' => $log->old_values,
                    'new_values' => $log->new_values,
                    'user_name' => $log->user ? $log->user->name : 'Store Admin',
                    'user_avatar' => $log->user && $log->user->avatar_path ? (str_starts_with($log->user->avatar_path, 'http') ? $log->user->avatar_path : asset('storage/' . $log->user->avatar_path)) : null,
                    'user_account_number' => $log->user ? $log->user->account_number : null,
                    'description' => $log->description ?: "Stock updated for product",
                    'created_at' => $log->created_at ? $log->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

            $timeline = $prodSales->concat($prodLogs)->all();
            $hasCreation = collect($timeline)->contains(fn($t) => $t['type'] === 'creation');
            if (!$hasCreation && $p->created_at) {
                $skuRef = $p->sku ?: ('PRD-' . str_pad($p->id, 5, '0', STR_PAD_LEFT));
                $timeline[] = [
                    'id' => 'initial-reg-' . $p->id,
                    'type' => 'creation',
                    'action' => 'created',
                    'quantity_change' => $p->stock_quantity,
                    'reference_no' => $skuRef,
                    'invoice_number' => $skuRef,
                    'user_name' => 'Store Admin',
                    'user_avatar' => null,
                    'user_account_number' => null,
                    'description' => "Initial catalog registration for {$p->name} (SKU: {$p->sku})",
                    'created_at' => $p->created_at->toIso8601String(),
                ];
            }

            usort($timeline, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));

            $soldUnits = (int) ($allSaleItems->get($p->id) ?? collect())->sum('quantity');
            $addedUnits = (int) ($allProductLogs->get($p->id) ?? collect())
                ->filter(fn($l) => $l->action === 'stock.adjusted' || str_contains(strtolower($l->action), 'stock'))
                ->sum(fn($l) => (int) ($l->new_values['quantity_added'] ?? $l->new_values['quantity'] ?? 0));

            $stockHistories[$p->id] = [
                'product' => [
                    'id' => $p->id,
                    'name' => $p->name,
                    'sku' => $p->sku,
                    'stock_quantity' => $p->stock_quantity,
                    'category_name' => $p->category ? $p->category->name : 'General'
                ],
                'timeline' => $timeline,
                'stats' => [
                    'total_sold_units' => $soldUnits,
                    'total_added_units' => $addedUnits,
                    'current_stock' => $p->stock_quantity,
                    'total_revenue' => (int) ($allSaleItems->get($p->id) ?? collect())->sum('subtotal'),
                    'transaction_count' => ($allSaleItems->get($p->id) ?? collect())->count()
                ]
            ];
        }

        return Inertia::render('Inventory', [
            'initial_products' => $products,
            'initial_categories' => $categories,
            'initial_recent_activity' => $initialActivity,
            'initial_stock_histories' => $stockHistories,
        ]);
    })->name('inventory.index');

    // Transaction History
    Route::get('/transactions', function (Request $request) {

        $storeId = \App\Support\CurrentStore::id();

        $transactions = \App\Models\Sale::where('store_id', $storeId)
            ->with(['items.product', 'cashier'])
            ->orderBy('created_at', 'desc')
            ->get();

        $settingsRes = app(\App\Http\Controllers\Api\SettingController::class)->index();
        $settings = $settingsRes instanceof \Illuminate\Http\JsonResponse ? $settingsRes->getData(true) : $settingsRes;

        return Inertia::render('Transactions', [
            'initial_transactions' => $transactions,
            'initial_settings' => $settings,
        ]);
    })->name('transactions.index');

    // Shift Records (Z-Read History)
    Route::get('/shifts', function (Request $request) {

        $storeId = \App\Support\CurrentStore::id();

        $shifts = \App\Models\Shift::where('store_id', $storeId)
            ->with(['user', 'terminal', 'cashMovements.user'])
            ->orderBy('id', 'desc')
            ->get();

        $terminals = \App\Models\Terminal::where('store_id', $storeId)->get();
        $cashMovements = \App\Models\CashMovement::with(['user', 'terminal', 'shift'])
            ->where('store_id', $storeId)
            ->orderByDesc('id')
            ->limit(500)
            ->get();
        $settingsRes = app(\App\Http\Controllers\Api\SettingController::class)->index();
        $settings = $settingsRes instanceof \Illuminate\Http\JsonResponse ? $settingsRes->getData(true) : $settingsRes;

        $activeShiftsRes = app(\App\Http\Controllers\Api\ShiftController::class)->activeShifts($request);
        $activeShifts = $activeShiftsRes instanceof \Illuminate\Http\JsonResponse ? $activeShiftsRes->getData(true) : $activeShiftsRes;

        // Precompute detailed breakdown data for all shifts for instant modal preview with 0ms delay
        $shiftDetails = [];
        foreach ($shifts as $shift) {
            $shiftDetails[$shift->id] = [
                'id'                    => $shift->id,
                'staff_name'            => $shift->user?->name ?? 'Staff',
                'staff_avatar'          => $shift->user?->avatar_path ? (str_starts_with($shift->user->avatar_path, 'http') ? $shift->user->avatar_path : asset('storage/' . $shift->user->avatar_path)) : null,
                'staff_role'            => $shift->user?->role ?? 'cashier',
                'start_time'            => $shift->start_time,
                'end_time'              => $shift->end_time,
                'start'                 => $shift->start_time ? $shift->start_time->format('m/d/Y h:i A') : '—',
                'end'                   => $shift->end_time ? $shift->end_time->format('m/d/Y h:i A') : 'ACTIVE',
                'printed_at'            => now()->format('m/d/Y h:i A'),
                'expected_opening_cash' => (float) $shift->expected_opening_cash,
                'starting_cash'         => (float) $shift->starting_cash,
                'opening_discrepancy'   => (float) $shift->opening_discrepancy,
                'opening_notes'         => $shift->opening_notes,
                'closing_notes'         => $shift->closing_notes,
                'cash_sales'            => (float) $shift->cash_sales,
                'cash_in'               => (float) $shift->cash_in,
                'cash_out'              => (float) $shift->cash_out,
                'expenses'              => (float) ($shift->expenses ?? 0),
                'expected_cash'         => (float) $shift->expected_cash,
                'actual_cash'           => (float) $shift->actual_cash,
                'difference'            => (float) $shift->difference,
                'status'                => $shift->status,
                'total_sales'           => (float) $shift->cash_sales,
                'cash_movements'        => $shift->cashMovements,
                'shift_record'          => $shift
            ];
        }

        return Inertia::render('ShiftHistory', [
            'initial_shifts'        => $shifts,
            'initial_terminals'     => $terminals,
            'initial_settings'      => $settings,
            'initial_active_shifts' => $activeShifts,
            'initial_shift_details' => $shiftDetails,
            'initial_cash_movements' => $cashMovements,
        ]);
    })->name('shifts.index');

    // System Activity Logs (audit trail of this store)
    Route::get('/activity-logs', function (Request $request) {
        $storeId = \App\Support\CurrentStore::id();

        $logs = \App\Models\ActivityLog::where('store_id', $storeId)
            ->with(['user:id,name,account_number,avatar_path'])
            ->orderBy('created_at', 'desc')
            ->orderBy('id', 'desc')
            ->limit(500)
            ->get();

        // Deep link from a LOG-xxxxx reference: make sure that entry is listed even if it is older
        $focusLog = $request->integer('log') ?: null;
        if ($focusLog && !$logs->contains('id', $focusLog)) {
            $extra = \App\Models\ActivityLog::where('store_id', $storeId)
                ->with(['user:id,name,account_number,avatar_path'])
                ->find($focusLog);
            if ($extra) {
                $logs->push($extra);
            } else {
                $focusLog = null;
            }
        }

        $logs = $logs
            ->map(function ($log) {
                return [
                    'id' => $log->id,
                    'action' => $log->action,
                    'category' => \App\Models\ActivityLog::resolveCategory($log->action, $log->model_type),
                    'model_type' => $log->model_type,
                    'model_id' => $log->model_id,
                    'description' => $log->description,
                    'old_values' => $log->old_values,
                    'new_values' => $log->new_values,
                    'user_id' => $log->user_id,
                    'user_name' => $log->user ? $log->user->name : 'System / Auto',
                    'user_account_number' => $log->user ? $log->user->account_number : null,
                    'user_avatar' => $log->user && $log->user->avatar_path ? '/storage/' . ltrim($log->user->avatar_path, '/') : null,
                    'created_at' => $log->created_at ? $log->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

        $settingsRes = app(\App\Http\Controllers\Api\SettingController::class)->index();
        $settings = $settingsRes instanceof \Illuminate\Http\JsonResponse ? $settingsRes->getData(true) : $settingsRes;

        return Inertia::render('ActivityLogs', [
            'initial_logs' => $logs,
            'initial_settings' => $settings,
            'focus_log_id' => $focusLog,
        ]);
    })->name('activity-logs.index');

    // Store Settings
    Route::get('/settings', function (Request $request) {

        $settingsRes = app(\App\Http\Controllers\Api\SettingController::class)->index();
        $settings = $settingsRes instanceof \Illuminate\Http\JsonResponse ? $settingsRes->getData(true) : $settingsRes;

        return Inertia::render('Settings', [
            'initial_settings' => $settings,
        ]);
    })->name('settings');

});


/**
 * INTERNAL API ENDPOINTS
 */
Route::middleware(['auth', 'throttle:auth_api'])->group(function () {

    // Profile & Sign-in Credential
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::put('/profile/credential', [ProfileController::class, 'updateCredential'])->name('credential.update');

    // API: System Data
    Route::get('/api/user', fn(Request $request) => $request->user());
    Route::get('/api/settings', [SettingController::class, 'index']);

    // API: Operational
    Route::post('/api/checkout', [PosController::class, 'checkout'])->middleware('throttle:checkout_api');
    Route::get('/api/products', [ProductController::class, 'index']);
    Route::post('/api/products', [ProductController::class, 'store']);
    Route::get('/api/products/next-sku', [ProductController::class, 'getNextSku']);
    Route::get('/api/products/{id}/history', [ProductController::class, 'stockHistory']);
    Route::get('/api/inventory/recent-activity', [ProductController::class, 'recentActivity']);
    Route::get('/api/categories', [CategoryController::class, 'index']);
    Route::get('/api/transactions', [TransactionController::class, 'index']);
    Route::get('/api/transactions/{id}', [TransactionController::class, 'show']);
    Route::post('/api/products/{id}/stock', [ProductController::class, 'adjustStock']);

    // API: Management
    Route::post('/api/settings', [SettingController::class, 'update']);
    Route::post('/api/settings/receipt', [SettingController::class, 'updateReceiptSettings']);
    Route::get('/api/dashboard', [DashboardController::class, 'index']);
    Route::get('/api/reports', [ReportController::class, 'index']);
    Route::get('/api/dashboard/export', [DashboardController::class, 'export']);

    Route::post('/api/products/import', [ProductController::class, 'bulkImport']);
    Route::put('/api/products/{id}', [ProductController::class, 'update']);
    Route::delete('/api/products/{id}', [ProductController::class, 'destroy']);
    Route::patch('/api/products/{id}/toggle-active', [ProductController::class, 'toggleActive']);

    Route::post('/api/categories', [CategoryController::class, 'store']);
    Route::put('/api/categories/{id}', [CategoryController::class, 'update']);
    Route::delete('/api/categories/{id}', [CategoryController::class, 'destroy']);

    Route::post('/api/transactions/{id}/void', [TransactionController::class, 'void']);

    // Shift History API
    Route::get('/api/shifts', [ShiftController::class, 'index']);

    // API: Shift Lifecycle & Cash Management (Terminal Operations)
    Route::get('/api/shift/current', [ShiftController::class, 'current']);
    Route::get('/api/shifts/active', [ShiftController::class, 'activeShifts']);
    Route::post('/api/shift/open', [ShiftController::class, 'open']);
    Route::post('/api/shift/cash-movement', [ShiftController::class, 'cashMovement']);
    Route::post('/api/shift/close', [ShiftController::class, 'close']);
    Route::get('/api/pos/shift/data/{id}', [ShiftController::class, 'data']);

    // API: Cash Register (single register on this device)
    Route::get('/api/terminals', [TerminalController::class, 'index']);

    // API: Held Orders (Parked Sales)
    Route::get('/api/held-orders', [HeldOrderController::class, 'index']);
    Route::post('/api/held-orders', [HeldOrderController::class, 'store']);
    Route::delete('/api/held-orders/{id}', [HeldOrderController::class, 'destroy']);
});


require __DIR__ . '/auth.php';

/**
 * LOCAL STORAGE ASSET SERVING ROUTE
 * Streams uploaded store logos, avatars and product images from storage/app/public/
 * (works even when the public/storage symlink has not been created).
 */
Route::get('/storage/{path}', function ($path) {
    $root = realpath(storage_path('app/public'));
    $file = $root ? realpath($root . DIRECTORY_SEPARATOR . ltrim($path, '/')) : false;

    if (!$file || !str_starts_with($file, $root) || !is_file($file)) {
        abort(404);
    }

    return response()->file($file);
})->where('path', '.*')->name('storage.local');
