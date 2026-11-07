<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Sale;
use App\Models\Product;
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

            // Restore stock for each item in the transaction
            foreach ($sale->items as $item) {
                $product = Product::find($item->product_id);
                if ($product) {
                    $product->increment('stock_quantity', $item->quantity);
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
