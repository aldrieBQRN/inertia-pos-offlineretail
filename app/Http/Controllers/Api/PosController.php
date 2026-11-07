<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Product;
use App\Models\Sale;
use App\Models\SaleItem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;

/**
 * Handles core POS terminal operations like checkout and stock synchronization.
 * Scoped to the local store via Global Scopes.
 */
class PosController extends Controller
{
    /**
     * Process a checkout transaction.
     * Handles stock validation, database transaction safety,
     * Senior/PWD discount logic, and record creation.
     */
    public function checkout(Request $request)
    {
        // 1. Validation for cart contents and payment info
        $request->validate([
            'cart' => 'required|array|min:1',
            'cart.*.id' => 'nullable|exists:products,id',
            'cart.*.quantity' => 'required|numeric|min:0.01',
            'cart.*.name' => 'nullable|string',
            'cart.*.price' => 'required|numeric',
            // ADDED CREDIT AND DEBIT CARDS
            'payment_method' => 'required|string|in:cash,gcash,maya,card,credit_card,debit_card',
            'cash_given' => 'nullable|numeric',
            'change' => 'nullable|numeric',
            // DYNAMIC DISCOUNT FIELDS
            'discount_type' => 'nullable|string|max:50',
            'discount_rate' => 'nullable|numeric|min:0|max:100',
            'discount_amount' => 'nullable|numeric|min:0',
            'customer_name' => 'nullable|string|max:150',
            'customer_id_number' => 'nullable|string|max:100',
            'discount_reason' => 'nullable|string|max:255',
            'is_senior' => 'nullable|boolean',
        ]);

        // Start transaction to ensure data integrity
        DB::beginTransaction();

        try {
            // Convert cash inputs to cents for consistent storage
            $cashGiven = $request->payment_method === 'cash' ? ($request->cash_given * 100) : null;
            $change = $request->payment_method === 'cash' ? ($request->change * 100) : 0;

            // 2. Initialize the main Sale record
            // Get the local store ID to prefix the invoice
            $storeId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;

            // Format: INV-[STORE_ID]-[YEAR][MONTH][DAY]-
            // Example: INV-001-20260329-
            $todayPrefix = 'INV-' . str_pad($storeId, 3, '0', STR_PAD_LEFT) . '-' . date('Ymd') . '-';

            // Find the last sale for THIS specific store today
            $lastSale = Sale::where('invoice_number', 'like', $todayPrefix . '%')
                ->lockForUpdate()
                ->orderBy('id', 'desc')
                ->first();

            $nextSequence = 1;
            if ($lastSale) {
                // Extract the last 4 digits of the invoice string and increment by 1
                $lastSequence = (int) substr($lastSale->invoice_number, -4);
                $nextSequence = $lastSequence + 1;
            }

            // Combine prefix and the new padded sequence (e.g., INV-001-20260329-0001)
            $invoiceNumber = $todayPrefix . str_pad($nextSequence, 4, '0', STR_PAD_LEFT);

            $isSeniorOrPwd = (bool) (
                $request->is_senior || 
                in_array(strtolower($request->discount_type ?? ''), ['senior', 'senior_citizen', 'pwd'])
            );

            $sale = Sale::create([
                'invoice_number' => $invoiceNumber,
                'cashier_id' => Auth::id(),
                'terminal_id' => $request->terminal_id ?? null,
                'total_amount' => 0,
                'payment_method' => $request->payment_method,
                'payment_reference' => $request->reference ?? null,
                'is_senior' => $isSeniorOrPwd,
                'cash_given' => $cashGiven,
                'change' => $change,
                'transaction_date' => now(),
            ]);

            $calculatedTotal = 0;
            $saleItemsToInsert = [];
            $now = now();

            // 3. Batch fetch & lock all product catalog items in a SINGLE database query
            $productIds = collect($request->cart)->pluck('id')->filter(function ($id) {
                return $id !== null && !is_string($id);
            })->unique()->values()->toArray();

            $products = count($productIds) > 0
                ? Product::whereIn('id', $productIds)->lockForUpdate()->get()->keyBy('id')
                : collect();

            // Resolve store_id once for all line items.
            // SaleItem::insert() bypasses the Eloquent 'creating' hook that normally
            // auto-populates store_id via BelongsToStore. Without an explicit store_id,
            // the global scope filters the items out when queried, causing "0 items".
            $resolvedStoreId = \App\Support\CurrentStore::id() ?? Auth::user()->store_id;

            // Process cart items in memory
            foreach ($request->cart as $item) {
                $unitPrice = (int) round($item['price'] * 100);
                $quantity = (float) $item['quantity'];

                if (isset($item['id']) && $item['id'] !== null && !is_string($item['id'])) {
                    if ((int) $quantity != $quantity) {
                        throw new \Exception('Product quantities must be whole numbers.');
                    }

                    $quantity = (int) $quantity;
                    $product = $products->get($item['id']);

                    if (!$product) {
                        throw new \Exception("Item no longer available in catalog.");
                    }

                    if ($product->stock_quantity < $quantity) {
                        throw new \Exception("Insufficient stock for {$product->name}. Only {$product->stock_quantity} remaining.");
                    }

                    // Decrement inventory level
                    $product->decrement('stock_quantity', $quantity);

                    $subtotal = $unitPrice * $quantity;

                    $saleItemsToInsert[] = [
                        'sale_id' => $sale->id,
                        'product_id' => $product->id,
                        'custom_name' => $product->name,
                        'quantity' => $quantity,
                        'unit_price' => $unitPrice,
                        'subtotal' => $subtotal,
                        'store_id' => $resolvedStoreId,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                } else {
                    // Custom item
                    $subtotal = (int) round($unitPrice * $quantity);
                    $customName = trim((string) ($item['name'] ?? ''));

                    $saleItemsToInsert[] = [
                        'sale_id' => $sale->id,
                        'product_id' => null,
                        'custom_name' => $customName !== '' ? $customName : 'Custom Item',
                        'quantity' => $quantity,
                        'unit_price' => $unitPrice,
                        'subtotal' => $subtotal,
                        'store_id' => $resolvedStoreId,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ];
                }

                $calculatedTotal += $subtotal;
            }

            // Execute single bulk INSERT for all line items
            if (count($saleItemsToInsert) > 0) {
                SaleItem::insert($saleItemsToInsert);
            }

            // 4. Dynamic Discount Calculation (Percentage, Presets, Fixed Amounts, or Senior/PWD)
            $discountAmount = 0;
            $discountType = $request->discount_type ?? ($request->is_senior ? 'senior' : null);
            $discountRate = $request->has('discount_rate') && $request->discount_rate !== null 
                ? (float) $request->discount_rate 
                : ($request->is_senior ? 20.00 : null);

            if ($discountType === 'custom_fixed' || ($request->has('discount_amount') && $request->discount_amount > 0 && $discountRate === null)) {
                // Fixed amount discount in cents
                $requestedDiscountCents = (int) round($request->discount_amount);
                $discountAmount = min($calculatedTotal, max(0, $requestedDiscountCents));
            } elseif ($discountRate !== null && $discountRate > 0) {
                // Percentage based discount
                $clampedRate = min(100, max(0, $discountRate));
                $discountAmount = (int) round($calculatedTotal * ($clampedRate / 100));
            } elseif ($request->is_senior) {
                // Fallback for legacy requests
                $discountAmount = (int) round($calculatedTotal * 0.20);
                $discountRate = 20.00;
                $discountType = 'senior';
            }

            // Safety bounds check
            $discountAmount = min($calculatedTotal, max(0, $discountAmount));
            $finalPayableTotal = max(0, $calculatedTotal - $discountAmount);

            // Store the final calculated total and discount metadata
            $sale->update([
                'total_amount' => $finalPayableTotal,
                'discount_amount' => $discountAmount,
                'discount_type' => $discountAmount > 0 ? $discountType : null,
                'discount_rate' => $discountAmount > 0 ? $discountRate : null,
                'customer_name' => $discountAmount > 0 ? $request->customer_name : null,
                'customer_id_number' => $discountAmount > 0 ? $request->customer_id_number : null,
                'discount_reason' => $discountAmount > 0 ? $request->discount_reason : null,
            ]);

            DB::commit();

            // Log sale transaction in background
            try {
                $discountLabel = match ($discountType) {
                    'senior' => 'Senior Citizen (20%)',
                    'pwd' => 'PWD (20%)',
                    'national_athlete' => 'National Athlete (20%)',
                    'solo_parent' => 'Solo Parent (10%)',
                    'loyalty_10' => 'Loyalty Reward (10%)',
                    'damaged_15' => 'Damaged / Clearance (15%)',
                    'custom_percentage' => 'Custom Discount (' . ($discountRate ?? 0) . '%)',
                    'custom_fixed' => 'Custom Fixed Amount',
                    default => $discountType ? ucwords(str_replace('_', ' ', $discountType)) : 'Custom Discount'
                };

                \App\Services\ActivityService::logCreate('Sale', $sale->id, "Completed checkout sale {$invoiceNumber} for ₱" . number_format($finalPayableTotal / 100, 2) . ($discountAmount > 0 ? " (Discount: ₱" . number_format($discountAmount / 100, 2) . " - {$discountLabel})" : ""), [
                    'invoice_number' => $invoiceNumber,
                    'total_amount' => $finalPayableTotal / 100,
                    'discount_amount' => $discountAmount / 100,
                    'discount_type' => $discountType,
                    'payment_method' => $request->payment_method,
                    'items_count' => count($request->cart)
                ]);
            } catch (\Exception $logEx) {
                // Silently swallow log errors to never disrupt cashier checkout
            }

            return response()->json([
                'success' => true,
                'sale_id' => $sale->id,
                'invoice' => $invoiceNumber,
                'message' => 'Transaction successful!'
            ]);
        } catch (\Exception $e) {
            // Roll back all database changes
            DB::rollBack();

            return response()->json([
                'success' => false,
                'message' => $e->getMessage()
            ], 400);
        }
    }
}
