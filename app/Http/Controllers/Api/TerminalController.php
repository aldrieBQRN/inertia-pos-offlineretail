<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Terminal;
use App\Models\Shift;
use Illuminate\Http\Request;

class TerminalController extends Controller
{
    /**
     * List the store's cash register (the standalone POS runs a single register on this device).
     */
    public function index(Request $request)
    {
        $storeId = \App\Support\CurrentStore::id();

        $terminals = Terminal::where('store_id', $storeId)
            ->with(['activeShift.user'])
            ->orderBy('name', 'asc')
            ->get();

        // If no register exists yet, automatically create the device's "Main Register"
        if ($terminals->isEmpty()) {
            Terminal::create([
                'store_id'  => $storeId,
                'name'      => 'Main Register',
                'code'      => 'REG-01',
                'is_active' => true,
                'notes'     => 'This device'
            ]);
            $terminals = Terminal::where('store_id', $storeId)
                ->with(['activeShift.user'])
                ->get();
        }

        foreach ($terminals as $term) {
            if ($term->activeShift) {
                $shift = $term->activeShift;
                $sales = \App\Models\Sale::where('cashier_id', $shift->user_id)
                    ->where('status', 'completed')
                    ->where('created_at', '>=', $shift->start_time)
                    ->get();
                $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
                $cashIn = (float) \App\Models\CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
                $cashOut = (float) \App\Models\CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
                $term->current_drawer_cash = max(0, (float) $shift->starting_cash + $cashSales + $cashIn - $cashOut - (float) ($shift->expenses ?? 0));
            } else {
                $lastShift = Shift::where('store_id', $storeId)
                    ->where('status', 'closed')
                    ->where('terminal_id', $term->id)
                    ->latest('end_time')
                    ->first();
                $lastClosingCash = $lastShift ? (float) $lastShift->actual_cash : 0.00;
                $lastClosedTime = $lastShift && $lastShift->end_time ? $lastShift->end_time : \Carbon\Carbon::parse('2000-01-01 00:00:00');

                $movements = \App\Models\CashMovement::where('store_id', $storeId)
                    ->where('terminal_id', $term->id)
                    ->where('created_at', '>=', $lastClosedTime)
                    ->get();
                $in = (float) $movements->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
                $out = (float) $movements->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
                $term->current_drawer_cash = max(0, $lastClosingCash + $in - $out);
            }
        }

        return response()->json($terminals);
    }
}
