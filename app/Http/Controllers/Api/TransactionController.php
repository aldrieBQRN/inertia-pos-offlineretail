<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sale;
use App\Models\Product;
use App\Support\Quantity;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * Handles transaction history management, including filtering,
 * summary statistics, and voiding sales.
 */
class TransactionController extends Controller
{
    /**
     * Fetch a list of transactions with optional filtering and summary stats.
     * Supports date ranges, payment methods, search by invoice/cashier, and full data export.
     */
    public function index(Request $request)
    {
        $query = Sale::with(['items.product', 'cashier'])
            ->orderBy('created_at', 'desc');

        // 1. Apply Date Range Filters
        if ($request->start_date && $request->end_date) {
            $query->whereBetween('created_at', [
                Carbon::parse($request->start_date)->startOfDay(),
                Carbon::parse($request->end_date)->endOfDay()
            ]);
        } elseif ($request->start_date) {
            $query->where('created_at', '>=', Carbon::parse($request->start_date)->startOfDay());
        } elseif ($request->end_date) {
            $query->where('created_at', '<=', Carbon::parse($request->end_date)->endOfDay());
        }

        // 2. Apply Payment Method Filter
        if ($request->payment_method) {
            $query->where('payment_method', $request->payment_method);
        }

        // 3. Apply Search Filter (Invoice Number or Cashier Name)
        if ($request->search) {
            $search = $request->search;
            $query->where(function ($q) use ($search) {
                $q->where('invoice_number', 'like', "%$search%")
                    ->orWhereHas('cashier', function ($q2) use ($search) {
                        $q2->where('name', 'like', "%$search%");
                    });
            });
        }

        // Return un-paginated results for report exports and Hybrid Client Engine
        if ($request->has('all')) {
            return $query->get();
        }

        // 4. Generate Summary statistics for completed transactions
        $statsQuery = clone $query;
        $statsQuery->where('status', 'completed');

        $summary = [
            'total_sales' => $statsQuery->sum('total_amount'),
            'transaction_count' => $statsQuery->count(),
            'cash_sales' => (clone $statsQuery)->where('payment_method', 'cash')->sum('total_amount'),
            'gcash_sales' => (clone $statsQuery)->where('payment_method', 'gcash')->sum('total_amount'),
            'maya_sales' => (clone $statsQuery)->where('payment_method', 'maya')->sum('total_amount'),
            'credit_card_sales' => (clone $statsQuery)->where('payment_method', 'credit_card')->sum('total_amount'),
            'debit_card_sales' => (clone $statsQuery)->where('payment_method', 'debit_card')->sum('total_amount'),
        ];

        $sales = $query->paginate(10);

        return response()->json([
            'sales' => $sales,
            'summary' => $summary
        ]);
    }

    /**
     * Retrieve full details for a single transaction.
     */
    public function show($id)
    {
        $sale = Sale::with(['items.product', 'cashier'])->findOrFail($id);
        return response()->json($sale);
    }

    /**
     * Void a transaction and restore associated item quantities to inventory.
     */
    public function void($id)
    {
        DB::beginTransaction();
        try {
            $sale = Sale::with('items')->findOrFail($id);

            // Prevent re-voiding already voided sales
            if ($sale->status === 'void') {
                DB::rollBack();
                return response()->json(['message' => 'Transaction is already void.'], 400);
            }

            // Restore stock for each item in the transaction. Multi-UOM sales
            // restore the frozen base quantity, never the selling-unit quantity.
            $stockReturns = [];
            foreach ($sale->items as $item) {
                $product = Product::find($item->product_id);
                if ($product) {
                    $quantityToRestore = $item->base_quantity !== null
                        ? $item->base_quantity
                        : $item->quantity;
                    $oldStock = Quantity::normalize($product->getRawOriginal('stock_quantity'));
                    $newStock = Quantity::add($oldStock, $quantityToRestore);
                    $product->update(['stock_quantity' => $newStock]);
                    $stockReturns[] = [$product, $item, $quantityToRestore, $oldStock, $newStock];
                }
            }

            $sale->update(['status' => 'void']);

            DB::commit();

            // Audit the void only after it succeeded, and only once per sale.
            $alreadyLogged = \App\Models\ActivityLog::where('model_type', 'Sale')
                ->where('model_id', $sale->id)
                ->where('action', 'sale_voided')
                ->exists();

            if (!$alreadyLogged) {
                // One stock movement per returned item so each product's stock ledger reconciles
                foreach ($stockReturns as [$product, $item, $qty, $oldStock, $newStock]) {
                    $isMulti = $product->selling_method === Product::SELLING_METHOD_MULTIPLE;
                    $unitLabel = $isMulti ? ' ' . ($product->base_unit ?: 'units') : '';
                    $oldNumber = Quantity::toNumber($oldStock);
                    $newNumber = Quantity::toNumber($newStock);
                    \App\Services\ActivityService::log(
                        'product.stock_adjust',
                        'stock_void_return',
                        'Product',
                        $product->id,
                        "Sale voided ({$sale->invoice_number}): returned "
                            . \App\Services\InventoryLedgerService::saleQuantityText($item, $product)
                            . " of {$product->name} (Stock: {$oldNumber} → {$newNumber}{$unitLabel})",
                        ['stock_quantity' => $oldNumber, 'quantity_added' => 0],
                        array_filter([
                            'stock_quantity' => $newNumber,
                            'quantity_added' => Quantity::toNumber($qty),
                            'quantity_change' => Quantity::toNumber($qty),
                            'unit' => $isMulti ? ($product->base_unit ?: null) : null,
                            'invoice_number' => $sale->invoice_number,
                            'store_id' => $sale->store_id,
                        ], fn ($v) => $v !== null)
                    );
                }

                \App\Services\ActivityService::log(
                    'sale.void',
                    'sale_voided',
                    'Sale',
                    $sale->id,
                    "Voided transaction {$sale->invoice_number}",
                    ['status' => 'completed'],
                    [
                        'status' => 'void',
                        'invoice_number' => $sale->invoice_number,
                        'total_amount' => $sale->total_amount,
                        'payment_method' => $sale->payment_method,
                        'cashier_id' => $sale->cashier_id,
                        'store_id' => $sale->store_id,
                    ]
                );
            }

            return response()->json(['message' => 'Transaction voided and inventory returned.']);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json(['message' => 'Error voiding transaction'], 500);
        }
    }
}
