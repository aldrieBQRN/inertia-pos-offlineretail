<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\SaleItem;
use App\Models\ActivityLog;
use App\Services\ImageCompressionService;
use App\Services\ActivityService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Auth;

/**
 * ProductController
 * Handles administrative product management including inventory reconciliation,
 * media storage, and financial data processing for the local store.
 */
class ProductController extends Controller
{
    /**
     * Display a listing of products with optional filters.
     */
    public function index(Request $request)
    {
        $query = Product::with('category');

        // Search constraint: filter by partial name or exact SKU matches
        if ($request->search) {
            $query->where(function ($q) use ($request) {
                $q->where('name', 'like', "%{$request->search}%")
                    ->orWhere('sku', 'like', "%{$request->search}%");
            });
        }

        // Category constraint: filter items within a specific classification
        if ($request->category) {
            $query->where('category_id', $request->category);
        }

        // Inventory constraint: identify products requiring replenishment (Qty <= 10)
        if ($request->low_stock === 'true') {
            $query->where('stock_quantity', '<=', 10);
        }

        // Active status constraint: filter by active status if specified
        if ($request->has('active')) {
            $query->where('is_active', filter_var($request->active, FILTER_VALIDATE_BOOLEAN));
        }

        $query->orderBy('created_at', 'desc');

        // Return unpaginated results for export operations or paginated for UI display
        if ($request->has('all')) {
            return $query->get();
        }

        return $query->paginate(10);
    }

    /**
     * Store a newly created product.
     */
    public function store(Request $request)
    {
        $request->validate([
            'name' => 'required|string|max:255',
            'category_id' => 'required|exists:categories,id',
            'price' => 'required|numeric|min:0',
            'cost_price' => 'required|numeric|min:0',
            'wholesale_price' => 'required|numeric|min:0',
            'stock_quantity' => 'required|integer|min:0',
            'sku' => [
                'required',
                'string',
                // Scoped unique validation: Only check inside THIS store_id
                Rule::unique('products', 'sku')->where(function ($query) {
                    $storeId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;
                    return $query->where('store_id', $storeId);
                })
            ],
            'image' => 'nullable|image|max:2048',
            'is_active' => 'sometimes|boolean',
        ]);

        try {
            $data = $request->all();

            // Convert decimal currency values to integers (cents)
            $data['price'] = $request->price * 100;
            if ($request->cost_price) {
                $data['cost_price'] = $request->cost_price * 100;
            }
            if ($request->wholesale_price) {
                $data['wholesale_price'] = $request->wholesale_price * 100;
            }

            // Process and store the product image file
            if ($request->hasFile('image')) {
                try {
                    $imageCompression = new ImageCompressionService();
                    $path = $imageCompression->compressProductImage($request->file('image'));
                    // FIXED: Added the /storage/ prefix to match the frontend and update method expectations
                    $data['image_path'] = '/storage/' . $path;
                } catch (\Exception $e) {
                    Log::error('Image compression failed: ' . $e->getMessage());
                    // Store original image as fallback
                    $data['image_path'] = '/storage/' . $request->file('image')->store('products', 'public');
                }
            }

            // Explicitly resolve and set store_id for the local store
            $activeStoreId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);
            if ($activeStoreId) {
                $data['store_id'] = (int) $activeStoreId;
            }

            // Reload so database defaults (e.g. is_active) are part of the logged record
            $product = Product::create($data)->fresh();

            // Log the product creation with every product field (critical audit trail)
            $imageNote = $product->image_path ? ' with product image' : '';
            ActivityService::logCreate('Product', $product->id, "Created product: {$product->name} (SKU: {$product->sku}){$imageNote}", $this->auditSnapshot($product));

            return response()->json($product->fresh(), 201);
        } catch (\Exception $e) {
            Log::error('Product creation failed: ' . $e->getMessage());
            return response()->json(['error' => 'Failed to create product: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Update an existing product.
     */
    public function update(Request $request, $id)
    {
        $product = Product::findOrFail($id);

        $request->validate([
            'name' => 'sometimes|string|max:255',
            'category_id' => 'sometimes|exists:categories,id',
            'price' => 'sometimes|numeric|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'wholesale_price' => 'nullable|numeric|min:0',
            'stock_quantity' => 'sometimes|integer|min:0',
            'image' => 'nullable|image|max:2048',
            'sku' => [
                'sometimes',
                'string',
                // FIXED: Scoped unique validation that ignores the CURRENT product's ID
                Rule::unique('products', 'sku')->where(function ($query) {
                    $storeId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;
                    return $query->where('store_id', $storeId);
                })->ignore($id)
            ],
            'is_active' => 'sometimes|boolean',
        ]);

        try {
            $data = $request->except(['image']);

            // Re-calculate currency values if updated
            if ($request->has('price')) {
                $data['price'] = $request->price * 100;
            }
            if ($request->has('cost_price')) {
                $data['cost_price'] = $request->cost_price * 100;
            }
            if ($request->has('wholesale_price')) {
                $data['wholesale_price'] = $request->wholesale_price !== null ? ($request->wholesale_price * 100) : null;
            }

            // Handle image replacement (the previous image file is kept so the activity log
            // can still show what the product looked like before the change)
            if ($request->hasFile('image')) {
                try {
                    $imageCompression = new ImageCompressionService();
                    $path = $imageCompression->compressProductImage($request->file('image'));
                    $data['image_path'] = '/storage/' . $path;
                } catch (\Exception $e) {
                    Log::error('Image compression failed: ' . $e->getMessage());
                    // Store original image as fallback
                    $data['image_path'] = '/storage/' . $request->file('image')->store('products', 'public');
                }
            }

            $oldValues = $this->auditSnapshot($product);
            $hadImage = (bool) $oldValues['image_path'];

            $product->update($data);
            $product->refresh();

            // Log the product update with the full before/after record (critical audit trail)
            $imageNote = $request->hasFile('image') ? ($hadImage ? ' (product image replaced)' : ' (product image added)') : '';
            ActivityService::logUpdate('Product', $product->id, "Updated product: {$product->name} (SKU: {$product->sku}){$imageNote}", $oldValues, $this->auditSnapshot($product));

            return response()->json($product->fresh());
        } catch (\Exception $e) {
            Log::error('Product update failed: ' . $e->getMessage());
            return response()->json(['error' => 'Failed to update product: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Remove a product from the database.
     */
    public function destroy($id)
    {
        try {
            // Because of the Global Scope, findOrFail will automatically return a 404
            // if a user tries to delete a product belonging to another store.
            $product = Product::findOrFail($id);
            $productStoreId = $product->store_id;

            // Store product info for logging before deletion
            $productInfo = $this->auditSnapshot($product);

            // Ensure the associated image file is removed from storage
            if ($product->image_path) {
                $oldPath = str_replace('/storage/', '', $product->image_path);
                Storage::disk('public')->delete($oldPath);
            }

            $product->delete();

            // Log the product deletion (critical)
            ActivityService::logDelete('Product', $id, "Deleted product: {$product->name} (SKU: {$product->sku})", $productInfo);

            return response()->json(['message' => 'Product deleted successfully'], 200);
        } catch (\Illuminate\Database\QueryException $e) {
            // Integrity check: Prevent deletion if the product is referenced in transaction logs
            if ($e->getCode() == "23000") {
                return response()->json([
                    'error' => 'linked_to_transactions',
                    'message' => 'This product has sales history and cannot be deleted. Would you like to Archive it instead?'
                ], 409);
            }

            return response()->json(['error' => 'A database error occurred.'], 500);
        } catch (\Exception $e) {
            return response()->json(['error' => 'A server error occurred.'], 500);
        }
    }

    /**
     * Rapidly adjust inventory levels for a specific item.
     */
    public function adjustStock(Request $request, $id)
    {
        $request->validate([
            'quantity' => 'required|integer|min:1'
        ]);

        $product = Product::findOrFail($id);
        $oldStock = (int) $product->stock_quantity;
        $quantity = (int) $request->quantity;
        $newStock = $oldStock + $quantity;

        // Atomic increment of the stock level
        $product->increment('stock_quantity', $quantity);

        $description = "Restocked {$quantity} unit(s) for: {$product->name} (Stock: {$oldStock} → {$newStock})";

        // Log the stock adjustment (critical audit trail with previous and new stock)
        ActivityService::logStockAdjust(
            $id,
            $quantity,
            $description,
            $product->store_id,
            $oldStock,
            $newStock
        );

        return response()->json([
            'message' => 'Stock updated successfully',
            'new_stock' => $newStock
        ]);
    }

    /**
     * Import a list of products from JSON.
     */
    public function bulkImport(Request $request)
    {
        $request->validate([
            'products' => 'required|array|min:1',
            'products.*.name' => 'required|string|max:255',
            'products.*.sku' => 'required|string',
            'products.*.price' => 'required|numeric|min:0',
            'products.*.cost_price' => 'nullable|numeric|min:0',
            'products.*.wholesale_price' => 'nullable|numeric|min:0',
            'products.*.stock_quantity' => 'required|integer|min:0',
            'products.*.category_name' => 'nullable|string|max:255',
            'overwrite' => 'nullable|boolean'
        ]);

        \Illuminate\Support\Facades\DB::beginTransaction();

        try {
            $storeId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);
            $overwrite = (bool) $request->input('overwrite', false);
            $importedCount = 0;
            $updatedCount = 0;
            $skippedCount = 0;
            $skippedSkus = [];
            $errors = [];

            foreach ($request->products as $item) {
                $displayRow = $item['rowNum'] ?? ($importedCount + $updatedCount + 2);
                
                // Track missing/invalid fields for this specific row
                $rowErrors = [];

                // Normalize numeric-looking fields to ensure server-side validation accepts
                $normalizeNumber = function ($v) {
                    if ($v === null || $v === '') return 0;
                    if (is_numeric($v)) return $v;
                    $s = (string) $v;
                    $s = trim($s);
                    // Remove common currency symbols and spaces
                    $s = preg_replace('/[^0-9,\.\-]/u', '', $s);
                    if ($s === '') return 0;
                    // If both comma and dot present, assume comma is thousands separator
                    if (strpos($s, ',') !== false && strpos($s, '.') !== false) {
                        $s = str_replace(',', '', $s);
                    } elseif (strpos($s, ',') !== false && strpos($s, '.') === false) {
                        // comma as decimal separator
                        $s = str_replace(',', '.', $s);
                    }
                    $s = str_replace(' ', '', $s);
                    return is_numeric($s) ? $s : 0;
                };

                // Coerce incoming price fields to numeric (handles '0', '0.00', '0,00', '1,234.56')
                $item['price'] = $normalizeNumber($item['price'] ?? null);
                $item['wholesale_price'] = $normalizeNumber($item['wholesale_price'] ?? null);
                $item['cost_price'] = $normalizeNumber($item['cost_price'] ?? null);

                if (empty($item['sku'])) {
                    $rowErrors[] = "Barcode/SKU is empty";
                }
                if (empty($item['name'])) {
                    $rowErrors[] = "Product Name is empty";
                }
                if (empty($item['category_name'])) {
                    $rowErrors[] = "Category Name is empty";
                }
                if (!isset($item['price']) || $item['price'] === '' || !is_numeric($item['price'])) {
                    $rowErrors[] = "Retail Price must be a valid number";
                }
                if (!isset($item['wholesale_price']) || $item['wholesale_price'] === '' || !is_numeric($item['wholesale_price'])) {
                    $rowErrors[] = "Wholesale Price must be a valid number";
                }
                if (!isset($item['cost_price']) || $item['cost_price'] === '' || !is_numeric($item['cost_price'])) {
                    $rowErrors[] = "Cost Price must be a valid number";
                }
                if (!isset($item['stock_quantity']) || $item['stock_quantity'] === '' || !is_numeric($item['stock_quantity'])) {
                    $rowErrors[] = "Stock Quantity must be a valid number";
                }

                if (!empty($rowErrors)) {
                    $errors[] = "Row {$displayRow}: " . implode(', ', $rowErrors);
                    continue;
                }

                $sku = trim($item['sku']);

                // Find or create category
                $categoryId = null;
                $categoryName = trim($item['category_name']);
                $category = \App\Models\Category::where('name', $categoryName)->first();
                if (!$category) {
                    $category = \App\Models\Category::create([
                        'name' => $categoryName,
                        'color' => '#' . substr(md5($categoryName), 0, 6),
                        'store_id' => $storeId,
                    ]);
                }
                $categoryId = $category->id;

                // Find existing product by SKU under this store
                $existingProduct = Product::where('sku', $sku)->where('store_id', $storeId)->first();

                if ($existingProduct) {
                    if ($overwrite) {
                        $existingProduct->update([
                            'name' => trim($item['name']),
                            'category_id' => $categoryId,
                            'price' => (int) round($item['price'] * 100),
                            'cost_price' => (int) round($item['cost_price'] * 100),
                            'wholesale_price' => (int) round($item['wholesale_price'] * 100),
                            'stock_quantity' => (int) $item['stock_quantity'],
                            'is_active' => true,
                        ]);
                        $updatedCount++;
                    } else {
                        $skippedCount++;
                        $skippedSkus[] = $sku . ' - ' . trim($item['name']);
                    }
                    continue;
                }

                $productData = [
                    'name' => trim($item['name']),
                    'category_id' => $categoryId,
                    'price' => (int) round($item['price'] * 100),
                    'cost_price' => (int) round($item['cost_price'] * 100),
                    'wholesale_price' => (int) round($item['wholesale_price'] * 100),
                    'stock_quantity' => (int) $item['stock_quantity'],
                    'sku' => $sku,
                    'is_active' => true,
                    'store_id' => $storeId, // Ensure store_id is set
                ];

                Product::create($productData);
                $importedCount++;
            }

            if (!empty($errors)) {
                \Illuminate\Support\Facades\DB::rollBack();
                return response()->json([
                    'success' => false,
                    'message' => 'Import validation failed. Please correct the Excel file and try again.',
                    'errors' => $errors
                ], 422);
            }

            \Illuminate\Support\Facades\DB::commit();

            return response()->json([
                'success' => true,
                'message' => "Successfully processed import.",
                'imported_count' => $importedCount,
                'updated_count' => $updatedCount,
                'skipped_count' => $skippedCount,
                'skipped_skus' => $skippedSkus,
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\DB::rollBack();
            Log::error('Bulk import failed: ' . $e->getMessage());
            return response()->json([
                'success' => false,
                'message' => 'Failed to import products: ' . $e->getMessage()
            ], 500);
        }
    }

    /**
     * Get the next sequential auto-incrementing SKU prefixed with 'ITEM-'.
     */
    public function getNextSku()
    {
        $storeId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);

        // Fetch all product SKUs starting with ITEM- for this store
        $skus = Product::where('store_id', $storeId)
            ->where('sku', 'like', 'ITEM-%')
            ->pluck('sku');

        $maxNumber = 0;
        foreach ($skus as $sku) {
            if (preg_match('/^ITEM-(\d+)$/', $sku, $matches)) {
                $num = (int)$matches[1];
                if ($num > $maxNumber) {
                    $maxNumber = $num;
                }
            }
        }

        $nextNumber = $maxNumber + 1;
        $nextSku = 'ITEM-' . str_pad($nextNumber, 5, '0', STR_PAD_LEFT);

        return response()->json([
            'success' => true,
            'next_sku' => $nextSku
        ]);
    }

    /**
     * Toggle the active/archive status of a product.
     */
    public function toggleActive($id)
    {
        try {
            $product = Product::findOrFail($id);
            $oldValues = $this->auditSnapshot($product);
            $product->is_active = !$product->is_active;
            $product->save();

            $status = $product->is_active ? 'activated' : 'archived';

            // Log update activity (full record before and after the status change)
            ActivityService::logUpdate(
                'Product',
                $id,
                "Product status updated to {$status}: {$product->name} (SKU: {$product->sku})",
                $oldValues,
                $this->auditSnapshot($product)
            );

            return response()->json([
                'success' => true,
                'message' => "Product successfully {$status}.",
                'is_active' => $product->is_active
            ], 200);
        } catch (\Exception $e) {
            return response()->json(['error' => 'Failed to toggle product status: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Get unified stock movement history (Sales + Restocks + Adjustments) for a specific product.
     */
    public function stockHistory($id)
    {
        try {
            $product = Product::with('category')->findOrFail($id);
            $storeId = $product->store_id ?? \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);

            // 1. Fetch sales deductions from SaleItem
            $salesQuery = SaleItem::where('product_id', $id)->with(['sale.cashier'])->orderBy('created_at', 'desc')->limit(50);
            if ($storeId) {
                $salesQuery->whereHas('sale', function ($q) use ($storeId) {
                    $q->where('store_id', $storeId);
                });
            }

            $sales = $salesQuery->get()->map(function ($item) {
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

            // 2. Fetch stock adjustments & restock logs from ActivityLog
            $logsQuery = ActivityLog::where(function ($q) use ($id) {
                $q->where(function ($q2) use ($id) {
                    $q2->where('model_type', 'Product')->where('model_id', $id);
                })->orWhere(function ($q2) use ($id) {
                    $q2->where('model_type', 'Inventory')->where('model_id', $id);
                });
            });

            if ($storeId) {
                $logsQuery->where('store_id', $storeId);
            }

            $logs = $logsQuery->with('user')
                ->orderBy('created_at', 'desc')
                ->limit(50)
                ->get()
                ->map(function ($log) {
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

            // Combine list
            $timeline = $sales->concat($logs)->all();

            // 3. Always include initial catalog registration record
            $hasCreationLog = collect($timeline)->contains(fn($t) => $t['type'] === 'creation');
            if (!$hasCreationLog && $product->created_at) {
                $skuRef = $product->sku ? $product->sku : ('PRD-' . str_pad($product->id, 5, '0', STR_PAD_LEFT));
                $timeline[] = [
                    'id' => 'initial-reg-' . $product->id,
                    'type' => 'creation',
                    'action' => 'created',
                    'quantity_change' => $product->stock_quantity,
                    'reference_no' => $skuRef,
                    'invoice_number' => $skuRef,
                    'user_name' => 'Store Admin',
                    'user_avatar' => null,
                    'user_account_number' => null,
                    'description' => "Initial catalog registration for {$product->name} (SKU: {$product->sku})",
                    'created_at' => $product->created_at->toIso8601String(),
                ];
            }

            // Sort chronologically descending
            usort($timeline, fn($a, $b) => strcmp($b['created_at'], $a['created_at']));

            // Calculate aggregate statistics for this item
            $totalSoldUnits = (int) SaleItem::where('product_id', $id)->sum('quantity');
            $totalSalesRevenue = (float) (SaleItem::where('product_id', $id)->sum('subtotal') / 100);

            return response()->json([
                'success' => true,
                'product' => [
                    'id' => $product->id,
                    'name' => $product->name,
                    'sku' => $product->sku,
                    'price' => $product->price / 100,
                    'cost_price' => $product->cost_price ? $product->cost_price / 100 : null,
                    'stock_quantity' => $product->stock_quantity,
                    'is_active' => $product->is_active,
                    'category_name' => $product->category ? $product->category->name : 'Uncategorized',
                    'created_at' => $product->created_at ? $product->created_at->toIso8601String() : null,
                ],
                'stats' => [
                    'total_sold_units' => $totalSoldUnits,
                    'total_revenue' => $totalSalesRevenue,
                    'current_stock' => $product->stock_quantity,
                ],
                'timeline' => $timeline
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Stock history error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            return response()->json(['error' => 'Failed to fetch stock history: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Get store-wide recent inventory activity logs.
     */
    public function recentActivity(Request $request)
    {
        try {
            $storeId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);

            // 1. Fetch activity logs
            $logsQuery = ActivityLog::where(function ($q) {
                $q->whereIn('model_type', ['Product', 'Inventory', 'Category'])
                  ->orWhere('action', 'like', '%stock%')
                  ->orWhere('action', 'like', '%product%')
                  ->orWhere('action', 'like', '%category%');
            });

            if ($storeId) {
                $logsQuery->where('store_id', $storeId);
            }

            $logs = $logsQuery->with(['user'])
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

            // 2. Fetch recent sales deductions from SaleItem
            $salesQuery = SaleItem::with(['sale.cashier', 'product'])->orderBy('created_at', 'desc')->limit(30);
            if ($storeId) {
                $salesQuery->whereHas('sale', function ($q) use ($storeId) {
                    $q->where('store_id', $storeId);
                });
            }

            $sales = $salesQuery->get()->map(function ($item) {
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

            // 3. Fetch recent product additions
            $prodQuery = Product::orderBy('created_at', 'desc')->limit(15);
            if ($storeId) {
                $prodQuery->where('store_id', $storeId);
            }

            // Products created through the app already have a "Created product" log; only list the rest once
            $recentProducts = $prodQuery->get();
            $loggedProductIds = ActivityLog::where('model_type', 'Product')
                ->where('action', 'create')
                ->whereIn('model_id', $recentProducts->pluck('id'))
                ->pluck('model_id')
                ->all();
            $recentProducts = $recentProducts->reject(fn ($p) => in_array($p->id, $loggedProductIds))->map(function ($p) {
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

            // Combine and sort chronologically
            $combined = $logs->concat($sales)->concat($recentProducts)->sortByDesc('created_at')->values()->take(50)->all();

            return response()->json([
                'success' => true,
                'data' => $combined
            ]);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('Recent activity error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            return response()->json(['error' => 'Failed to fetch recent activity: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Every product field as shown in the activity log (prices in pesos, category by name).
     */
    private function auditSnapshot(Product $product): array
    {
        $category = $product->category_id
            ? \App\Models\Category::withoutGlobalScopes()->whereKey($product->category_id)->value('name')
            : null;

        return [
            'name' => $product->name,
            'sku' => $product->sku,
            'description' => $product->description,
            'category' => $category,
            'price' => $product->price !== null ? $product->price / 100 : null,
            'cost_price' => $product->cost_price !== null ? $product->cost_price / 100 : null,
            'wholesale_price' => $product->wholesale_price !== null ? $product->wholesale_price / 100 : null,
            'stock_quantity' => (int) $product->stock_quantity,
            'low_stock_threshold' => $product->low_stock_threshold,
            'is_active' => (bool) $product->is_active,
            'image_path' => $product->image_path,
            'store_id' => $product->store_id,
        ];
    }
}
