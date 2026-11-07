<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HeldOrder;
use Illuminate\Http\Request;

/**
 * Handles the logic for "Holding" or parking active carts for later checkout.
 * Scoped to the local store via Global Scopes.
 */
class HeldOrderController extends Controller
{
    /**
     * Retrieve all held orders, newest first.
     * SAAS NOTE: Automatically filtered to the current store via Global Scope.
     */
    public function index()
    {
        return HeldOrder::orderBy('created_at', 'desc')->get();
    }

    /**
     * Save a current cart as a held order.
     */
    public function store(Request $request)
    {
        // Validate cart data and total amount (in cents)
        $request->validate([
            'cart' => 'required|array',
            'total' => 'required|integer'
        ]);

        // Create the held order entry
        // SAAS NOTE: 'store_id' is automatically injected by the BelongsToStore Trait.
        HeldOrder::create([
            'reference_note' => $request->note ?? 'Unnamed Order',
            'cart_data' => $request->cart,
            'total_amount' => $request->total
        ]);

        return response()->json(['message' => 'Order held successfully']);
    }

    /**
     * Delete a held order once it is recalled or canceled.
     */
    public function destroy($id)
    {
        // UPDATED: Using findOrFail ensures a 404 error is thrown if a user
        // tries to delete an order that belongs to a different store!
        $order = HeldOrder::findOrFail($id);
        $order->delete();

        return response()->json(['message' => 'Order removed']);
    }
}
