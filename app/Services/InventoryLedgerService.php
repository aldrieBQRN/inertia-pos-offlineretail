<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Product;
use App\Models\SaleItem;
use App\Support\Quantity;
use Illuminate\Support\Collection;

/**
 * Builds the Inventory page's stock movement ledger and activity feed.
 *
 * Single source for both the Inertia page-load props and the polling APIs, so the
 * two never drift apart. All quantities are Multiple-UOM aware: stock movements are
 * expressed in the product's base unit (e.g. Meter) and sales keep the selling unit
 * they were rung up in (e.g. "Sold 1 Roll (100 Meter)").
 */
class InventoryLedgerService
{
    /** Unit label for stock quantities: the base unit for Multiple UOM, "units" otherwise. */
    public static function stockUnitLabel(?Product $product): string
    {
        if ($product && $product->selling_method === Product::SELLING_METHOD_MULTIPLE) {
            return $product->base_unit ?: 'units';
        }

        return 'units';
    }

    /** "1 Roll (100 Meter)" for converted sales, "3 unit(s)" for standard ones. */
    public static function saleQuantityText(SaleItem $item, ?Product $product = null): string
    {
        $quantity = Quantity::format($item->quantity);
        $unitName = $item->unit_name ?: 'unit(s)';
        $text = "{$quantity} {$unitName}";

        $baseUnit = $product && $product->selling_method === Product::SELLING_METHOD_MULTIPLE ? $product->base_unit : null;
        if ($item->base_quantity !== null && $baseUnit
            && (Quantity::compare($item->base_quantity, $item->quantity) !== 0 || strcasecmp($unitName, $baseUnit) !== 0)) {
            $text .= ' (' . Quantity::format($item->base_quantity) . " {$baseUnit})";
        }

        return $text;
    }

    // ------------------------------------------------------------------
    // Stock movement ledger (per product)
    // ------------------------------------------------------------------

    /** Ledger for one product (used by the history API). */
    public static function historyFor(Product $product): array
    {
        $product->loadMissing(['category', 'units']);
        $storeId = $product->store_id;

        $saleItems = SaleItem::where('product_id', $product->id)
            ->when($storeId, fn ($q) => $q->whereHas('sale', fn ($s) => $s->where('store_id', $storeId)))
            ->with(['sale.cashier'])
            ->orderBy('created_at', 'desc')
            ->get();

        $logs = ActivityLog::whereIn('model_type', ['Product', 'Inventory'])
            ->where('model_id', $product->id)
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->get();

        return self::buildHistory($product, $saleItems, $logs);
    }

    /** Ledgers for many products at once (used by the Inventory page preload). */
    public static function historiesFor(Collection $products, $storeId): array
    {
        $saleItems = SaleItem::whereHas('sale', fn ($q) => $q->where('store_id', $storeId))
            ->with(['sale.cashier'])
            ->orderBy('created_at', 'desc')
            ->get()
            ->groupBy('product_id');

        $logs = ActivityLog::where('store_id', $storeId)
            ->whereIn('model_type', ['Product', 'Inventory'])
            ->whereNotNull('model_id')
            ->with('user')
            ->orderBy('created_at', 'desc')
            ->get()
            ->groupBy('model_id');

        $histories = [];
        foreach ($products as $product) {
            $histories[$product->id] = self::buildHistory(
                $product,
                $saleItems->get($product->id) ?? collect(),
                $logs->get($product->id) ?? collect()
            );
        }

        return $histories;
    }

    public static function buildHistory(Product $product, Collection $saleItems, Collection $logs): array
    {
        $baseUnit = self::stockUnitLabel($product);

        $timeline = $saleItems->map(fn ($item) => self::saleLedgerRow($item, $product))
            ->concat($logs->map(fn ($log) => self::logLedgerRow($log, $baseUnit)))
            ->all();

        $hasCreation = collect($timeline)->contains(fn ($t) => $t['type'] === 'creation');
        if (!$hasCreation && $product->created_at) {
            $skuRef = $product->sku ?: ('PRD-' . str_pad($product->id, 5, '0', STR_PAD_LEFT));
            $timeline[] = [
                'id' => 'initial-reg-' . $product->id,
                'type' => 'creation',
                'action' => 'created',
                'quantity_change' => $product->stock_quantity,
                'unit' => $baseUnit,
                'reference_no' => $skuRef,
                'invoice_number' => $skuRef,
                'user_name' => 'Store Admin',
                'user_avatar' => null,
                'user_account_number' => null,
                'description' => "Initial catalog registration for {$product->name} (SKU: {$product->sku})",
                'created_at' => $product->created_at->toIso8601String(),
            ];
        }

        usort($timeline, fn ($a, $b) => strcmp($b['created_at'], $a['created_at']));

        $soldBase = $saleItems->reduce(
            fn ($carry, $item) => Quantity::add($carry, $item->base_quantity ?? $item->quantity),
            '0'
        );
        $addedBase = $logs
            ->filter(fn ($log) => self::isStockLog($log) && $log->action !== 'stock_void_return')
            ->reduce(function ($carry, $log) {
                $change = Quantity::normalize(self::logQuantityChange($log));
                return Quantity::compare($change, '0') > 0 ? Quantity::add($carry, $change) : $carry;
            }, '0');

        return [
            'product' => [
                'id' => $product->id,
                'name' => $product->name,
                'sku' => $product->sku,
                'price' => $product->price !== null ? $product->price / 100 : null,
                'cost_price' => $product->cost_price !== null ? $product->cost_price / 100 : null,
                'selling_method' => $product->selling_method,
                'base_unit' => $product->base_unit,
                'is_multi_unit' => $product->selling_method === Product::SELLING_METHOD_MULTIPLE,
                'quantity_precision' => $product->quantity_precision,
                'stock_quantity' => $product->stock_quantity,
                'is_active' => (bool) $product->is_active,
                'category_name' => $product->category ? $product->category->name : 'Uncategorized',
                'created_at' => $product->created_at ? $product->created_at->toIso8601String() : null,
                'units' => $product->relationLoaded('units') ? $product->units : $product->units()->get(),
            ],
            'timeline' => $timeline,
            'stats' => [
                'total_sold_units' => Quantity::toNumber($soldBase),       // base units
                'total_added_units' => Quantity::toNumber($addedBase),     // base units
                'current_stock' => $product->stock_quantity,
                'base_unit' => $product->base_unit,
                'unit_label' => $baseUnit,
                'total_revenue' => (int) $saleItems->sum('subtotal'),      // cents
                'transaction_count' => $saleItems->count(),
            ],
        ];
    }

    private static function saleLedgerRow(SaleItem $item, Product $product): array
    {
        $invoice = $item->sale && $item->sale->invoice_number
            ? $item->sale->invoice_number
            : ('POS-' . str_pad($item->sale_id ?? $item->id, 5, '0', STR_PAD_LEFT));

        $quantity = Quantity::toNumber($item->quantity);
        $baseQuantity = $item->base_quantity !== null ? Quantity::toNumber($item->base_quantity) : $quantity;
        $cashier = $item->sale?->cashier;

        return [
            'id' => 'sale-' . $item->id,
            'type' => 'sale',
            'quantity_change' => -$baseQuantity,                  // base units
            'unit' => self::stockUnitLabel($product),
            'quantity' => $quantity,                              // selling units
            'base_quantity' => $baseQuantity,
            'unit_name' => $item->unit_name,
            'conversion_factor' => $item->conversion_factor,
            'unit_price' => $item->unit_price / 100,
            'subtotal' => $item->subtotal / 100,
            'invoice_number' => $invoice,
            'reference_no' => $invoice,
            'user_name' => $cashier ? $cashier->name : 'POS Cashier',
            'user_avatar' => self::avatarUrl($cashier?->avatar_path),
            'user_account_number' => $cashier?->account_number,
            'description' => 'Sold ' . self::saleQuantityText($item, $product) . ' via POS (₱' . number_format($item->subtotal / 100, 2) . ')',
            'created_at' => $item->created_at ? $item->created_at->toIso8601String() : now()->toIso8601String(),
        ];
    }

    private static function isStockLog(ActivityLog $log): bool
    {
        return $log->action === 'stock.adjusted' || str_contains(strtolower((string) $log->action), 'stock');
    }

    /** Signed base-unit change recorded on a stock log. */
    private static function logQuantityChange(ActivityLog $log)
    {
        $new = $log->new_values ?? [];
        $old = $log->old_values ?? [];
        $change = $new['quantity_change'] ?? $new['quantity_added'] ?? $new['quantity'] ?? 0;

        if (Quantity::compare($change, '0') === 0 && isset($new['stock_quantity'], $old['stock_quantity'])) {
            $change = Quantity::subtract($new['stock_quantity'], $old['stock_quantity']);
        }

        return Quantity::toNumber($change);
    }

    private static function logLedgerRow(ActivityLog $log, string $baseUnit): array
    {
        $type = 'adjustment';
        $quantityChange = 0;

        $subtype = null;
        if ($log->action === 'stock_void_return') {
            // Stock put back by a voided sale
            $quantityChange = self::logQuantityChange($log);
            $type = 'adjustment';
            $subtype = 'void_return';
        } elseif (self::isStockLog($log)) {
            $quantityChange = self::logQuantityChange($log);
            // Additions are restocks; decreases (e.g. a lower physical count) are adjustments
            $type = $quantityChange < 0 ? 'adjustment' : 'restock';
        } elseif ($log->action === 'created' || str_contains(strtolower((string) $log->action), 'create')) {
            $type = 'creation';
            $quantityChange = Quantity::toNumber($log->new_values['stock'] ?? $log->new_values['stock_quantity'] ?? 0);
        }

        $refNo = 'LOG-' . str_pad($log->id, 5, '0', STR_PAD_LEFT);

        return [
            'id' => 'log-' . $log->id,
            'type' => $type,
            'subtype' => $subtype,
            'action' => $log->action,
            'quantity_change' => $quantityChange,
            'unit' => $log->new_values['unit'] ?? $log->new_values['base_unit'] ?? $baseUnit,
            'reference_no' => $refNo,
            'invoice_number' => $refNo,
            'old_values' => $log->old_values,
            'new_values' => $log->new_values,
            'user_name' => $log->user ? $log->user->name : 'Store Admin',
            'user_avatar' => self::avatarUrl($log->user?->avatar_path),
            'user_account_number' => $log->user?->account_number,
            'description' => $log->description ?: 'Stock updated for product',
            'created_at' => $log->created_at ? $log->created_at->toIso8601String() : now()->toIso8601String(),
        ];
    }

    // ------------------------------------------------------------------
    // Inventory Activity Audit Feed
    // ------------------------------------------------------------------

    public static function recentActivity($storeId): array
    {
        $logs = ActivityLog::query()
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
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
            ->map(fn ($log) => [
                'id' => 'log-' . $log->id,
                'action' => $log->action,
                'model_type' => $log->model_type,
                'model_id' => $log->model_id,
                'reference_no' => 'LOG-' . str_pad($log->id, 5, '0', STR_PAD_LEFT),
                'description' => $log->description,
                'user_name' => $log->user ? $log->user->name : 'System',
                'user_avatar' => self::avatarUrl($log->user?->avatar_path),
                'user_account_number' => $log->user?->account_number,
                'old_values' => $log->old_values,
                'new_values' => $log->new_values,
                'created_at' => $log->created_at ? $log->created_at->toIso8601String() : now()->toIso8601String(),
            ]);

        $sales = SaleItem::query()
            ->when($storeId, fn ($q) => $q->whereHas('sale', fn ($s) => $s->where('store_id', $storeId)))
            ->with(['sale.cashier', 'product'])
            ->orderBy('created_at', 'desc')
            ->limit(30)
            ->get()
            ->map(function ($item) {
                $prodName = $item->product ? $item->product->name : ($item->custom_name ?: 'Product Item');
                $invoice = $item->sale ? $item->sale->invoice_number : '';
                $cashier = $item->sale?->cashier;

                return [
                    'id' => 'sale-' . $item->id,
                    'action' => 'stock.sale',
                    'model_type' => 'Product',
                    'model_id' => $item->product_id,
                    'invoice_number' => $invoice,
                    'reference_no' => $invoice ?: ('SALE-' . str_pad($item->sale_id ?: $item->id, 5, '0', STR_PAD_LEFT)),
                    'sku' => $item->product?->sku,
                    'description' => 'Sold ' . self::saleQuantityText($item, $item->product) . " of {$prodName} via POS" . ($invoice ? " (Inv: {$invoice})" : ''),
                    'user_name' => $cashier ? $cashier->name : 'Cashier',
                    'user_avatar' => self::avatarUrl($cashier?->avatar_path),
                    'user_account_number' => $cashier?->account_number,
                    'created_at' => $item->created_at ? $item->created_at->toIso8601String() : now()->toIso8601String(),
                ];
            });

        // Products without a "create" log (e.g. seeded) are listed once as registrations
        $recentProducts = Product::query()
            ->when($storeId, fn ($q) => $q->where('store_id', $storeId))
            ->orderBy('created_at', 'desc')
            ->limit(15)
            ->get();
        $loggedProductIds = ActivityLog::where('model_type', 'Product')
            ->where('action', 'create')
            ->whereIn('model_id', $recentProducts->pluck('id'))
            ->pluck('model_id')
            ->all();
        $registrations = $recentProducts
            ->reject(fn ($p) => in_array($p->id, $loggedProductIds))
            ->map(fn ($p) => [
                'id' => 'prod-reg-' . $p->id,
                'action' => 'created',
                'model_type' => 'Product',
                'model_id' => $p->id,
                'sku' => $p->sku,
                'reference_no' => $p->sku ? ('SKU: ' . $p->sku) : ('PRD-' . str_pad($p->id, 5, '0', STR_PAD_LEFT)),
                'description' => "Registered new product: {$p->name} (SKU: {$p->sku}) with " . Quantity::format($p->stock_quantity) . ' ' . self::stockUnitLabel($p),
                'user_name' => 'Store Admin',
                'user_avatar' => null,
                'user_account_number' => null,
                'created_at' => $p->created_at ? $p->created_at->toIso8601String() : now()->toIso8601String(),
            ]);

        return $logs->concat($sales)->concat($registrations)->sortByDesc('created_at')->values()->take(50)->all();
    }

    private static function avatarUrl(?string $path): ?string
    {
        if (!$path) return null;

        return str_starts_with($path, 'http') ? $path : asset('storage/' . $path);
    }
}
