<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\SaleItem;
use App\Models\ActivityLog;
use App\Services\ImageCompressionService;
use App\Services\ActivityService;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

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
        // Units are required by the Inventory page (multiple-UOM "From" price / selling units),
        // which re-polls this endpoint and replaces the page-load products with the result.
        $query = Product::with(['category', 'units']);

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
        $sellingMethod = $this->sellingMethodFrom($request);
        $request->merge(['units' => $this->normalizedUnitsInput($request)]);

        $rules = [
            'name' => 'required|string|max:255',
            'category_id' => 'required|exists:categories,id',
            'selling_method' => 'sometimes|in:standard,multiple',
            'base_unit' => 'nullable|string|max:50',
            'stock_quantity' => 'required|numeric|min:0',
            'low_stock_threshold' => 'sometimes|integer|min:0',
            'cost_price' => 'required|numeric|min:0',
            'sku' => [
                'required',
                'string',
                Rule::unique('products', 'sku')->where(function ($query) {
                    $storeId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;
                    return $query->where('store_id', $storeId);
                })
            ],
            'image' => 'nullable|image|max:2048',
            'is_active' => 'sometimes|boolean',
        ];

        if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE) {
            $rules['base_unit'] = 'required|string|max:50';
            $rules['quantity_decimals'] = 'nullable|integer|min:0|max:4';
            $rules['stock_quantity'] = 'required|numeric|min:0';
            $rules['units'] = 'required|array|min:1';
            $rules['units.*.name'] = 'required|string|max:100';
            $rules['units.*.conversion_factor'] = 'required|numeric|gt:0';
            $rules['units.*.price'] = 'required|numeric|min:0';
            $rules['units.*.wholesale_price'] = 'required|numeric|min:0';
            $rules['units.*.is_default'] = 'sometimes|boolean';
        } else {
            $rules['price'] = 'required|numeric|min:0';
            $rules['wholesale_price'] = 'required|numeric|min:0';
            $rules['stock_quantity'] = 'required|integer|min:0';
        }

        $request->validate($rules);

        try {
            $data = $request->only([
                'name', 'description', 'sku', 'selling_method', 'base_unit', 'category_id',
                'low_stock_threshold', 'is_active',
            ]);

            $data['selling_method'] = $sellingMethod;
            $data['stock_quantity'] = Quantity::normalize($request->stock_quantity);
            $data['cost_price'] = Quantity::toInt(Quantity::multiply($request->cost_price, '100'));

            if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE) {
                $data['base_unit'] = trim((string) $request->base_unit);
                $data['quantity_decimals'] = $request->filled('quantity_decimals') ? (int) $request->quantity_decimals : null;
                $data['price'] = null;
                $data['wholesale_price'] = null;
            } else {
                $data['base_unit'] = null;
                $data['quantity_decimals'] = null;
                $data['price'] = Quantity::toInt(Quantity::multiply($request->price, '100'));
                $data['wholesale_price'] = Quantity::toInt(Quantity::multiply($request->wholesale_price, '100'));
            }

            // Process and store the product image file
            if ($request->hasFile('image')) {
                try {
                    $imageCompression = new ImageCompressionService();
                    $path = $imageCompression->compressProductImage($request->file('image'));
                    $data['image_path'] = '/storage/' . $path;
                } catch (\Exception $e) {
                    Log::error('Image compression failed: ' . $e->getMessage());
                    $data['image_path'] = '/storage/' . $request->file('image')->store('products', 'public');
                }
            }

            // Explicitly resolve and set store_id for the local store
            $activeStoreId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);
            if ($activeStoreId) {
                $data['store_id'] = (int) $activeStoreId;
            }

            DB::beginTransaction();
            $product = Product::create($data);

            // Sync units for Multiple UOM
            if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE && $request->has('units')) {
                $this->syncUnits($product, $request->units);
            }

            DB::commit();

            // Reload so database defaults (e.g. is_active) are part of the logged record
            $product = $product->fresh();

            // Log the product creation with every product field (critical audit trail)
            $imageNote = $product->image_path ? ' with product image' : '';
            ActivityService::logCreate('Product', $product->id, "Created product: {$product->name} (SKU: {$product->sku}){$imageNote}", $this->auditSnapshot($product));

            return response()->json($product->fresh(['units']), 201);
        } catch (\Exception $e) {
            DB::rollBack();
            Log::error('Product creation failed: ' . $e->getMessage());
            return response()->json(['error' => 'Failed to create product: ' . $e->getMessage()], 500);
        }
    }

    /**
     * Determine selling method from request.
     */
    private function sellingMethodFrom(Request $request): string
    {
        $method = $request->input('selling_method', 'standard');
        return strtolower(trim($method)) === 'multiple' ? Product::SELLING_METHOD_MULTIPLE : Product::SELLING_METHOD_STANDARD;
    }

    /**
     * Normalize units input from request.
     */
    private function normalizedUnitsInput(Request $request): array
    {
        $units = $request->input('units', []);
        // The Inventory form posts multipart/form-data (for the image) with units as a JSON string
        if (is_string($units)) {
            $decoded = json_decode($units, true);
            $units = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($units)) {
            return [];
        }
        return array_values(array_filter($units, fn($u) => is_array($u) && !empty($u['name'])));
    }

    /**
     * Sync product units for Multiple UOM products.
     */
    private function syncUnits(Product $product, array $units): void
    {
        $product->units()->delete();
        
        $sortOrder = 1;
        foreach ($units as $unit) {
            $unitName = trim((string) $unit['name']);
            if ($unitName === '') continue;
            
            $factor = $this->normalizeNumber($unit['conversion_factor'] ?? null);
            $retailPrice = $this->normalizeNumber($unit['price'] ?? null);
            $wholesalePrice = $this->normalizeNumber($unit['wholesale_price'] ?? null);
            $isDefault = (isset($unit['is_default']) && $unit['is_default']) ? true : false;
            $sort = isset($unit['sort_order']) ? (int) $unit['sort_order'] : $sortOrder;
            
            if ($factor && $retailPrice !== null && $wholesalePrice !== null) {
                ProductUnit::create([
                    'product_id' => $product->id,
                    'name' => $unitName,
                    'conversion_factor' => Quantity::normalize($factor),
                    'price' => Quantity::toInt(Quantity::multiply($retailPrice, '100')),
                    'wholesale_price' => Quantity::toInt(Quantity::multiply($wholesalePrice, '100')),
                    'is_default' => $isDefault,
                    'sort_order' => $sort,
                ]);
            }
            $sortOrder++;
        }
    }

    /**
     * Normalize number from various formats.
     */
    private function normalizeNumber($v): ?float
    {
        if ($v === null || $v === '') return null;
        if (is_numeric($v)) return (float) $v;
        $s = trim((string) $v);
        $s = preg_replace('/[^0-9,\.\-]/u', '', $s);
        if ($s === '') return null;
        if (strpos($s, ',') !== false && strpos($s, '.') !== false) {
            $s = str_replace(',', '', $s);
        } elseif (strpos($s, ',') !== false && strpos($s, '.') === false) {
            $s = str_replace(',', '.', $s);
        }
        $s = str_replace(' ', '', $s);
        return is_numeric($s) ? (float) $s : null;
    }

    /**
     * Update an existing product.
     */
    public function update(Request $request, $id)
    {
        $product = Product::findOrFail($id);
        
        $sellingMethod = $this->sellingMethodFrom($request);
        $request->merge(['units' => $this->normalizedUnitsInput($request)]);

        $rules = [
            'name' => 'sometimes|string|max:255',
            'category_id' => 'sometimes|exists:categories,id',
            'selling_method' => 'sometimes|in:standard,multiple',
            'base_unit' => 'nullable|string|max:50',
            'stock_quantity' => 'sometimes|numeric|min:0',
            'low_stock_threshold' => 'sometimes|integer|min:0',
            'cost_price' => 'nullable|numeric|min:0',
            'sku' => [
                'sometimes',
                'string',
                Rule::unique('products', 'sku')->where(function ($query) {
                    $storeId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;
                    return $query->where('store_id', $storeId);
                })->ignore($id)
            ],
            'image' => 'nullable|image|max:2048',
            'is_active' => 'sometimes|boolean',
        ];

        if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE) {
            $rules['base_unit'] = 'required|string|max:50';
            $rules['quantity_decimals'] = 'nullable|integer|min:0|max:4';
            $rules['units'] = 'required|array|min:1';
            $rules['units.*.name'] = 'required|string|max:100';
            $rules['units.*.conversion_factor'] = 'required|numeric|gt:0';
            $rules['units.*.price'] = 'required|numeric|min:0';
            $rules['units.*.wholesale_price'] = 'required|numeric|min:0';
            $rules['units.*.is_default'] = 'sometimes|boolean';
        } else {
            $rules['price'] = 'sometimes|numeric|min:0';
            $rules['wholesale_price'] = 'nullable|numeric|min:0';
            $rules['stock_quantity'] = 'sometimes|integer|min:0';
        }

        $request->validate($rules);

        try {
            $data = $request->only([
                'name', 'description', 'sku', 'selling_method', 'base_unit', 'category_id',
                'low_stock_threshold', 'is_active',
            ]);

            $data['selling_method'] = $sellingMethod;
            $data['cost_price'] = $request->has('cost_price') ? Quantity::toInt(Quantity::multiply($request->cost_price, '100')) : $product->cost_price;

            if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE) {
                $data['base_unit'] = trim((string) $request->base_unit);
                $data['quantity_decimals'] = $request->filled('quantity_decimals') ? (int) $request->quantity_decimals : null;
                $data['price'] = null;
                $data['wholesale_price'] = null;
                if ($request->has('stock_quantity')) {
                    $data['stock_quantity'] = Quantity::normalize($request->stock_quantity);
                }
            } else {
                $data['base_unit'] = null;
                $data['quantity_decimals'] = null;
                if ($request->has('price')) {
                    $data['price'] = Quantity::toInt(Quantity::multiply($request->price, '100'));
                }
                if ($request->has('wholesale_price')) {
                    $data['wholesale_price'] = $request->wholesale_price !== null ? Quantity::toInt(Quantity::multiply($request->wholesale_price, '100')) : null;
                }
                if ($request->has('stock_quantity')) {
                    $data['stock_quantity'] = (int) $request->stock_quantity;
                }
            }

            // Handle image replacement
            if ($request->hasFile('image')) {
                try {
                    $imageCompression = new ImageCompressionService();
                    $path = $imageCompression->compressProductImage($request->file('image'));
                    $data['image_path'] = '/storage/' . $path;
                } catch (\Exception $e) {
                    Log::error('Image compression failed: ' . $e->getMessage());
                    $data['image_path'] = '/storage/' . $request->file('image')->store('products', 'public');
                }
            }

            $oldValues = $this->auditSnapshot($product);
            $hadImage = (bool) $oldValues['image_path'];

            $product->update($data);

            // Sync units for Multiple UOM
            if ($sellingMethod === Product::SELLING_METHOD_MULTIPLE && $request->has('units')) {
                $this->syncUnits($product, $request->units);
            } elseif ($sellingMethod !== Product::SELLING_METHOD_MULTIPLE) {
                $product->units()->delete();
            }

            $product->refresh();

            // Log the product update with the full before/after record (critical audit trail)
            $imageNote = $request->hasFile('image') ? ($hadImage ? ' (product image replaced)' : ' (product image added)') : '';
            ActivityService::logUpdate('Product', $product->id, "Updated product: {$product->name} (SKU: {$product->sku}){$imageNote}", $oldValues, $this->auditSnapshot($product));

            return response()->json($product->fresh(['units']));
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
     * Supports Multiple UOM: if unit_id is provided, quantity is converted to base units.
     */
    public function adjustStock(Request $request, $id)
    {
        $request->validate([
            'quantity' => 'required|numeric|min:0.001',
            'unit_id' => 'nullable|exists:product_units,id',
        ]);

        $product = Product::findOrFail($id);
        $isMultiple = $product->selling_method === Product::SELLING_METHOD_MULTIPLE;
        $oldStock = Quantity::normalize($product->getRawOriginal('stock_quantity'));
        $receivedText = Quantity::format($request->quantity);

        // Convert the received quantity to base units (exact decimal, no rounding)
        if ($request->filled('unit_id')) {
            $unit = ProductUnit::findOrFail($request->unit_id);
            if ($unit->product_id !== $product->id) {
                return response()->json(['error' => 'Unit does not belong to this product'], 422);
            }
            $baseQuantity = Quantity::multiply($request->quantity, (string) $unit->conversion_factor);
            $receivedText .= " {$unit->name}";
        } else {
            $baseQuantity = Quantity::normalize($request->quantity);
        }

        // Standard products keep whole-number stock
        if (!$isMultiple) {
            $baseQuantity = (string) Quantity::toInt($baseQuantity);
        }

        $newStock = Quantity::add($oldStock, $baseQuantity);

        // Atomic increment of the stock level
        $product->increment('stock_quantity', $baseQuantity);

        $oldNumber = Quantity::toNumber($oldStock);
        $newNumber = Quantity::toNumber($newStock);
        if ($isMultiple) {
            $baseUnit = $product->base_unit ?: 'unit(s)';
            $received = $request->filled('unit_id')
                ? "{$receivedText} (+" . Quantity::format($baseQuantity) . " {$baseUnit})"
                : "{$receivedText} {$baseUnit}";
            $description = "Received {$received} for: {$product->name} (Stock: {$oldNumber} → {$newNumber} {$baseUnit})";
        } else {
            $description = 'Restocked ' . Quantity::format($baseQuantity) . " unit(s) for: {$product->name} (Stock: {$oldNumber} → {$newNumber})";
        }

        // Log the stock adjustment (critical audit trail with previous and new stock)
        ActivityService::logStockAdjust(
            $product->id,
            $baseQuantity,
            $description,
            $product->store_id,
            $oldNumber,
            $newNumber,
            $isMultiple ? ($product->base_unit ?: null) : null
        );

        return response()->json([
            'message' => 'Stock updated successfully',
            'new_stock' => $newNumber,
        ]);
    }

    /**
     * Bulk import products (Standard and Multiple UOM).
     *
     * The Inventory page parses the .xlsx/.csv file in the browser (store header
     * rows, column header detection, example-row skipping) and posts the rows as
     * JSON, the same contract used before Multiple UOM was introduced:
     *   products[]: sku, name, category_name, price, wholesale_price, cost_price,
     *               stock_quantity, selling_method?, base_unit?, default_unit?, rowNum?
     *   units[]:    sku, unit_name, conversion_factor, retail_price,
     *               wholesale_price, is_default, sort_order, rowNum?   (optional)
     * Rows without a selling method are treated as Standard so old 7-column
     * templates and exports keep importing.
     *
     * Existing products (matched by SKU): `overwrite` updates their details, otherwise
     * they are skipped. Their stock is kept unless `update_stock` is true (e.g. after a
     * physical count); then it is set from the file and logged as a stock adjustment.
     * A blank stock cell never changes an existing product's stock.
     */
    public function bulkImport(Request $request)
    {
        $request->validate([
            'products' => 'required|array|min:1',
            'units' => 'nullable|array',
            'overwrite' => 'nullable|boolean',
            'update_stock' => 'nullable|boolean',
            'file_name' => 'nullable|string|max:255',
        ]);

        $productRows = $request->input('products', []);
        $unitRows = $request->input('units', []) ?? [];
        $overwrite = $request->boolean('overwrite');
        $updateStock = $overwrite && $request->boolean('update_stock');
        $fileName = $request->input('file_name') ?: 'import file';
        $storeId = \App\Support\CurrentStore::id() ?? (Auth::user() ? Auth::user()->store_id : null);

        $normalizeNumber = function ($v) {
            if ($v === null || $v === '') return null;
            if (is_numeric($v)) return $v;
            $s = trim((string) $v);
            $s = preg_replace('/[^0-9,\.\-]/u', '', $s);
            if ($s === '') return null;
            if (strpos($s, ',') !== false && strpos($s, '.') !== false) {
                $s = str_replace(',', '', $s);
            } elseif (strpos($s, ',') !== false && strpos($s, '.') === false) {
                $s = str_replace(',', '.', $s);
            }
            return is_numeric($s) ? $s : null;
        };
        $isYes = function ($v) {
            if (is_bool($v)) return $v;
            return in_array(strtolower(trim((string) $v)), ['yes', 'y', 'true', '1'], true);
        };
        $toCents = fn ($v) => Quantity::toInt(Quantity::multiply($v, '100'));

        // Group units by SKU and normalize to the shape syncUnits() expects
        $unitsBySku = [];
        foreach ($unitRows as $unit) {
            $sku = trim((string) ($unit['sku'] ?? ''));
            if ($sku === '') continue;
            $unitsBySku[$sku][] = [
                'rowNum' => $unit['rowNum'] ?? null,
                'name' => trim((string) ($unit['unit_name'] ?? $unit['name'] ?? '')),
                'conversion_factor' => $normalizeNumber($unit['conversion_factor'] ?? null),
                'price' => $normalizeNumber($unit['retail_price'] ?? $unit['price'] ?? null),
                'wholesale_price' => $normalizeNumber($unit['wholesale_price'] ?? null),
                'is_default' => $isYes($unit['is_default'] ?? false),
                'sort_order' => $normalizeNumber($unit['sort_order'] ?? null),
            ];
        }

        DB::beginTransaction();

        try {
            $importedCount = 0;
            $updatedCount = 0;
            $skippedCount = 0;
            $skippedSkus = [];
            $stockUpdatedCount = 0;
            $errors = [];
            $warnings = [];
            $importedSkus = [];

            foreach ($productRows as $index => $item) {
                $displayRow = $item['rowNum'] ?? ($index + 2);
                $rowErrors = [];

                $sku = trim((string) ($item['sku'] ?? ''));
                $name = trim((string) ($item['name'] ?? ''));
                $categoryName = trim((string) ($item['category_name'] ?? ''));
                $rawMethod = strtolower(trim((string) ($item['selling_method'] ?? '')));
                $baseUnit = trim((string) ($item['base_unit'] ?? ''));
                $defaultUnit = trim((string) ($item['default_unit'] ?? ''));

                $price = $normalizeNumber($item['price'] ?? null);
                $wholesalePrice = $normalizeNumber($item['wholesale_price'] ?? null);
                $costPrice = $normalizeNumber($item['cost_price'] ?? null);
                $stockQuantity = $normalizeNumber($item['stock_quantity'] ?? null);
                $stockProvided = $stockQuantity !== null;

                if ($sku === '') $rowErrors[] = 'SKU is empty';
                if ($name === '') $rowErrors[] = 'Product Name is empty';
                if ($categoryName === '') $rowErrors[] = 'Category Name is empty';

                // Blank selling method = Standard (old 7-column templates/exports have no such column)
                if ($rawMethod === '') $rawMethod = 'standard';
                if (!in_array($rawMethod, ['standard', 'multiple uom', 'multiple'], true)) {
                    $rowErrors[] = "Selling Method must be 'Standard' or 'Multiple UOM'";
                }
                $isMultiple = in_array($rawMethod, ['multiple uom', 'multiple'], true);
                $sellingMethod = $isMultiple ? 'multiple' : 'standard';

                if ($isMultiple) {
                    if ($baseUnit === '') $rowErrors[] = 'Base Unit is required for Multiple UOM products';
                    if ($defaultUnit === '') $rowErrors[] = 'Default Unit is required for Multiple UOM products';
                    if ($costPrice === null || $costPrice < 0) $rowErrors[] = 'Cost Price (per base unit) is required for Multiple UOM products';
                    if ($stockQuantity === null || $stockQuantity < 0) $rowErrors[] = 'Stock Quantity (in base units) is required for Multiple UOM products';

                    $productUnits = $unitsBySku[$sku] ?? [];
                    if (empty($productUnits)) {
                        $rowErrors[] = "Multiple UOM product '{$sku}' must have at least one unit in Product Units sheet";
                    } else {
                        $defaultCount = 0;
                        $unitNames = [];
                        foreach ($productUnits as $unit) {
                            $unitName = $unit['name'];
                            if ($unitName === '') {
                                $rowErrors[] = "Unit name is empty for product '{$sku}'";
                            } elseif (in_array(strtolower($unitName), $unitNames, true)) {
                                $rowErrors[] = "Duplicate unit name '{$unitName}' for product '{$sku}'";
                            }
                            $unitNames[] = strtolower($unitName);

                            if ($unit['conversion_factor'] === null || $unit['conversion_factor'] <= 0) {
                                $rowErrors[] = "Conversion factor must be > 0 for unit '{$unitName}' of product '{$sku}'";
                            }
                            if ($unit['price'] === null || $unit['price'] < 0) {
                                $rowErrors[] = "Retail price required for unit '{$unitName}' of product '{$sku}'";
                            }
                            if ($unit['wholesale_price'] === null || $unit['wholesale_price'] < 0) {
                                $rowErrors[] = "Wholesale price required for unit '{$unitName}' of product '{$sku}'";
                            }
                            if ($unit['is_default']) $defaultCount++;
                        }
                        if ($defaultCount !== 1) {
                            $rowErrors[] = "Product '{$sku}' must have exactly one default unit (Is Default = Yes)";
                        }
                    }
                } else {
                    // Standard: blank wholesale/cost/stock default to 0, as before
                    $wholesalePrice = $wholesalePrice ?? 0;
                    $costPrice = $costPrice ?? 0;
                    $stockQuantity = $stockQuantity ?? 0;

                    if ($price === null || $price < 0) $rowErrors[] = 'Retail Price is required for Standard products';
                    if ($wholesalePrice < 0) $rowErrors[] = 'Wholesale Price cannot be negative';
                    if ($costPrice < 0) $rowErrors[] = 'Cost Price cannot be negative';
                    if ($stockQuantity < 0) $rowErrors[] = 'Stock Quantity cannot be negative';
                    if (!empty($unitsBySku[$sku])) {
                        $warnings[] = "Row {$displayRow}: Units found for Standard product '{$sku}' - they will be ignored";
                    }
                }

                if (!empty($rowErrors)) {
                    foreach ($rowErrors as $err) {
                        $errors[] = "Row {$displayRow} (SKU: {$sku}): {$err}";
                    }
                    continue;
                }

                $importedSkus[$sku] = true;

                $category = \App\Models\Category::where('name', $categoryName)->where('store_id', $storeId)->first();
                if (!$category) {
                    $category = \App\Models\Category::create([
                        'name' => $categoryName,
                        'color' => '#' . substr(md5($categoryName), 0, 6),
                        'store_id' => $storeId,
                    ]);
                }

                $existingProduct = Product::where('sku', $sku)->where('store_id', $storeId)->first();

                if ($existingProduct) {
                    if (!$overwrite) {
                        $skippedCount++;
                        $skippedSkus[] = $sku . ' - ' . $name;
                        continue;
                    }

                    // Stock is only changed when update_stock is requested (see below)
                    $oldStock = Quantity::normalize($existingProduct->getRawOriginal('stock_quantity'));
                    $beforeSnapshot = $this->auditSnapshot($existingProduct);

                    $existingProduct->update([
                        'name' => $name,
                        'category_id' => $category->id,
                        'selling_method' => $sellingMethod,
                        'base_unit' => $isMultiple ? $baseUnit : null,
                        'price' => $isMultiple ? null : $toCents($price),
                        'wholesale_price' => $isMultiple ? null : $toCents($wholesalePrice),
                        'cost_price' => $toCents($costPrice),
                        'is_active' => true,
                    ]);

                    if ($isMultiple) {
                        $this->syncUnits($existingProduct, $unitsBySku[$sku]);
                    } else {
                        $existingProduct->units()->delete();
                    }

                    if ($updateStock && $stockProvided) {
                        $newStock = Quantity::normalize($stockQuantity);
                        if (Quantity::compare($newStock, $oldStock) !== 0) {
                            $existingProduct->update(['stock_quantity' => $newStock]);

                            $oldNumber = Quantity::toNumber($oldStock);
                            $newNumber = Quantity::toNumber($newStock);
                            $unitLabel = $isMultiple ? " {$baseUnit}" : '';
                            ActivityService::logStockAdjust(
                                $existingProduct->id,
                                Quantity::subtract($newStock, $oldStock),
                                "Stock set from import for: {$name} (Stock: {$oldNumber}{$unitLabel} → {$newNumber}{$unitLabel})",
                                $storeId,
                                $oldNumber,
                                $newNumber,
                                $isMultiple ? $baseUnit : null
                            );
                            $stockUpdatedCount++;
                        }
                    }

                    // Audit detail changes (stock changes are logged above as stock adjustments)
                    $afterSnapshot = $this->auditSnapshot($existingProduct->refresh());
                    unset($beforeSnapshot['stock_quantity'], $afterSnapshot['stock_quantity']);
                    if ($beforeSnapshot != $afterSnapshot) {
                        ActivityService::logUpdate(
                            'Product',
                            $existingProduct->id,
                            "Updated product via import ({$fileName}): {$name} (SKU: {$sku})",
                            $beforeSnapshot,
                            $afterSnapshot
                        );
                    }

                    $updatedCount++;
                    continue;
                }

                $product = Product::create([
                    'name' => $name,
                    'category_id' => $category->id,
                    'sku' => $sku,
                    'selling_method' => $sellingMethod,
                    'base_unit' => $isMultiple ? $baseUnit : null,
                    'price' => $isMultiple ? null : $toCents($price),
                    'wholesale_price' => $isMultiple ? null : $toCents($wholesalePrice),
                    'cost_price' => $toCents($costPrice),
                    'stock_quantity' => Quantity::normalize($stockQuantity),
                    'is_active' => true,
                    'store_id' => $storeId,
                ]);

                if ($isMultiple) {
                    $this->syncUnits($product, $unitsBySku[$sku]);
                }

                ActivityService::logCreate(
                    'Product',
                    $product->id,
                    "Imported product from {$fileName}: {$name} (SKU: {$sku})",
                    $this->auditSnapshot($product->refresh())
                );

                $importedCount++;
            }

            // Units referencing SKUs that are neither in the import nor in the database
            foreach (array_keys($unitsBySku) as $sku) {
                $sku = (string) $sku;
                $inImport = collect($productRows)->contains(fn ($row) => trim((string) ($row['sku'] ?? '')) === $sku);
                if (!$inImport && !Product::where('sku', $sku)->where('store_id', $storeId)->exists()) {
                    $errors[] = "Product Units sheet references unknown SKU '{$sku}' (not in Products sheet or database)";
                }
            }

            if (!empty($errors)) {
                DB::rollBack();
                ActivityService::log('inventory.import', 'import_failed', 'Inventory', null,
                    "Import of {$fileName} was rejected (" . count($errors) . ' error(s)); nothing was saved',
                    null,
                    ['file_name' => $fileName, 'rows' => count($productRows), 'errors' => array_slice($errors, 0, 20)]
                );
                return response()->json([
                    'success' => false,
                    'message' => 'Import validation failed. Please correct the file and try again.',
                    'errors' => $errors,
                    'warnings' => $warnings,
                ], 422);
            }

            ActivityService::log('inventory.import', 'import', 'Inventory', null,
                "Imported {$fileName}: {$importedCount} new, {$updatedCount} updated"
                    . ($stockUpdatedCount ? " ({$stockUpdatedCount} stock change(s))" : '')
                    . ($skippedCount ? ", {$skippedCount} skipped" : ''),
                null,
                [
                    'file_name' => $fileName,
                    'rows' => count($productRows),
                    'units_rows' => count($unitRows),
                    'new_products' => $importedCount,
                    'updated_products' => $updatedCount,
                    'skipped_products' => $skippedCount,
                    'stock_changes' => $stockUpdatedCount,
                    'existing_products' => $overwrite ? 'Update details' : 'Skip',
                    'update_stock' => $updateStock,
                ]
            );

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => 'Successfully processed import.',
                'imported_count' => $importedCount,
                'updated_count' => $updatedCount,
                'stock_updated_count' => $stockUpdatedCount,
                'skipped_count' => $skippedCount,
                'skipped_skus' => $skippedSkus,
                'warnings' => $warnings,
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();
            Log::error('Bulk import failed: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            return response()->json([
                'success' => false,
                'message' => 'Failed to import products: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Audit an inventory export done in the browser (Excel / PDF / ledger / activity feed).
     * Exports carry store data out of the system, so who exported what and when is logged.
     */
    public function logExport(Request $request)
    {
        $data = $request->validate([
            'type' => 'required|in:inventory_excel,inventory_pdf,stock_ledger_excel,activity_excel',
            'count' => 'nullable|integer|min:0',
            'units_count' => 'nullable|integer|min:0',
            'filters' => 'nullable|string|max:500',
            'product_id' => 'nullable|integer',
            'file_name' => 'nullable|string|max:255',
        ]);

        $count = (int) ($data['count'] ?? 0);
        $product = !empty($data['product_id']) ? Product::find($data['product_id']) : null;

        $description = match ($data['type']) {
            'inventory_excel' => "Exported inventory to Excel ({$count} product(s)"
                . (!empty($data['units_count']) ? ", {$data['units_count']} selling unit(s)" : '') . ')',
            'inventory_pdf' => "Exported inventory report to PDF ({$count} product(s))"
                . (!empty($data['filters']) ? " - {$data['filters']}" : ''),
            'stock_ledger_excel' => 'Exported stock ledger to Excel for '
                . ($product ? "{$product->name} (SKU: {$product->sku})" : 'a product') . " ({$count} movement(s))",
            'activity_excel' => "Exported inventory activity feed to Excel ({$count} entr" . ($count === 1 ? 'y' : 'ies') . ')',
        };

        // Logged on Inventory without a model id so it never shows inside a product's stock ledger
        ActivityService::log('inventory.export', 'export', 'Inventory', null, $description, null, array_filter([
            'export_type' => $data['type'],
            'file_name' => $data['file_name'] ?? null,
            'records' => $count,
            'selling_units' => $data['units_count'] ?? null,
            'filters' => $data['filters'] ?? null,
            'product' => $product ? "{$product->name} (SKU: {$product->sku})" : null,
        ], fn ($v) => $v !== null && $v !== ''));

        return response()->json(['success' => true]);
    }

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
            $product = Product::with(['category', 'units'])->findOrFail($id);

            return response()->json(['success' => true] + \App\Services\InventoryLedgerService::historyFor($product));
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

            return response()->json([
                'success' => true,
                'data' => \App\Services\InventoryLedgerService::recentActivity($storeId),
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
        $isMultiple = $product->selling_method === Product::SELLING_METHOD_MULTIPLE;

        $snapshot = [
            'name' => $product->name,
            'sku' => $product->sku,
            'description' => $product->description,
            'category' => $category,
            'selling_method' => $isMultiple ? 'Multiple UOM' : 'Standard',
            'base_unit' => $isMultiple ? $product->base_unit : null,
            'quantity_decimals' => $isMultiple ? $product->quantity_precision : null,
            'price' => $product->price !== null ? $product->price / 100 : null,
            'cost_price' => $product->cost_price !== null ? $product->cost_price / 100 : null,
            'wholesale_price' => $product->wholesale_price !== null ? $product->wholesale_price / 100 : null,
            'stock_quantity' => Quantity::toNumber($product->getRawOriginal('stock_quantity') ?? $product->stock_quantity),
            'low_stock_threshold' => $product->low_stock_threshold,
            'is_active' => (bool) $product->is_active,
            'image_path' => $product->image_path,
            'store_id' => $product->store_id,
        ];

        if ($isMultiple) {
            // Read fresh from the database so before/after snapshots reflect the saved units
            $baseUnit = $product->base_unit ?: 'unit(s)';
            $snapshot['units'] = ProductUnit::where('product_id', $product->id)
                ->orderBy('sort_order')->orderBy('id')->get()
                ->map(fn ($u) => sprintf(
                    '%s = %s %s @ ₱%s (WS ₱%s)%s',
                    $u->name,
                    Quantity::format($u->conversion_factor),
                    $baseUnit,
                    number_format($u->price / 100, 2),
                    number_format($u->wholesale_price / 100, 2),
                    $u->is_default ? ' [default]' : ''
                ))
                ->values()
                ->all();
        }

        return $snapshot;
    }
}
