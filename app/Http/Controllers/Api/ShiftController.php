<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Shift;
use App\Models\Sale;
use App\Models\CashMovement;
use App\Models\Terminal;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * Manages cashier shift lifecycles with industry-standard cash drawer accounting:
 * Open Shift -> Intermediate Cash Movements -> Active Sales -> Close Shift & Z-Read.
 */
class ShiftController extends Controller
{
    public function index(Request $request)
    {
        $query = Shift::with(['user', 'terminal', 'cashMovements.user'])->orderBy('id', 'desc');

        if ($request->filled('start_date')) {
            $query->whereDate('start_time', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->whereDate('start_time', '<=', $request->end_date);
        }
        if ($request->filled('terminal_id') && $request->terminal_id !== 'all') {
            $query->where('terminal_id', $request->terminal_id);
        }
        if ($request->filled('search')) {
            $query->whereHas('user', function ($q) use ($request) {
                $q->where('name', 'like', "%{$request->search}%");
            });
        }

        if ($request->has('all')) {
            return $query->get();
        }

        return $query->paginate(10);
    }

    /**
     * Check active shift state and calculate expected opening drawer balance.
     */
    public function current(Request $request)
    {
        $user = Auth::user();
        $storeId = \App\Support\CurrentStore::id() ?? $user->store_id;
        $terminalId = $request->terminal_id;

        // 1. Check if this cashier or terminal has an active open shift
        $query = Shift::where('store_id', $storeId)->where('status', 'open');
        if ($terminalId) {
            $query->where(function($q) use ($user, $terminalId) {
                $q->where('user_id', $user->id)->orWhere('terminal_id', $terminalId);
            });
        } else {
            $query->where('user_id', $user->id);
        }

        $activeShift = $query->with('terminal')->latest('start_time')->first();

        if ($activeShift) {
            // Calculate running metrics during this active shift
            $sales = Sale::where('cashier_id', $activeShift->user_id)
                ->where('status', 'completed')
                ->where('created_at', '>=', $activeShift->start_time)
                ->get();

            $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
            $cashIn = (float) CashMovement::where('shift_id', $activeShift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
            $cashOut = (float) CashMovement::where('shift_id', $activeShift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
            
            $runningExpected = (float) $activeShift->starting_cash + $cashSales + $cashIn - $cashOut - (float) ($activeShift->expenses ?? 0);

            return response()->json([
                'has_active_shift'      => true,
                'shift'                 => $activeShift,
                'terminal'              => $activeShift->terminal,
                'start_time'            => $activeShift->start_time->format('m/d/Y h:i A'),
                'starting_cash'         => (float) $activeShift->starting_cash,
                'opening_discrepancy'   => (float) $activeShift->opening_discrepancy,
                'cash_sales'            => $cashSales,
                'cash_in'               => $cashIn,
                'cash_out'              => $cashOut,
                'running_expected_cash' => $runningExpected,
                'transactions_count'    => $sales->count(),
                'total_gross_sales'     => (float) $sales->sum('total_amount') / 100,
            ]);
        }

        // 2. No active shift: Calculate expected opening cash from last closed shift + intermediate cash movements
        $lastShiftQuery = Shift::where('store_id', $storeId)->where('status', 'closed');
        if ($terminalId) {
            $lastShiftQuery->where('terminal_id', $terminalId);
        }
        $lastShift = $lastShiftQuery->latest('end_time')->first();

        // Fallback to latest overall shift if this terminal has no previous shift record
        if (!$lastShift) {
            $lastShift = Shift::where('store_id', $storeId)->where('status', 'closed')->latest('end_time')->first();
        }

        $lastClosingCash = $lastShift ? (float) $lastShift->actual_cash : 0.00;
        $lastClosedTime = $lastShift && $lastShift->end_time ? $lastShift->end_time : Carbon::parse('2000-01-01 00:00:00');

        // Fetch any intermediate cash movements that occurred since the last shift closed
        $movementsQuery = CashMovement::where('store_id', $storeId)
            ->where(function ($q) use ($lastClosedTime) {
                $q->whereNull('shift_id')->orWhere('created_at', '>=', $lastClosedTime);
            })
            ->where('created_at', '>=', $lastClosedTime);

        if ($terminalId) {
            $movementsQuery->where(function($q) use ($terminalId) {
                $q->where('terminal_id', $terminalId)->orWhereNull('terminal_id');
            });
        }

        $intermediateMovements = $movementsQuery->with(['user', 'terminal'])->orderBy('created_at', 'desc')->get();

        $intermediateCashIn = (float) $intermediateMovements->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
        $intermediateCashOut = (float) $intermediateMovements->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');

        $expectedOpeningCash = max(0, $lastClosingCash + $intermediateCashIn - $intermediateCashOut);

        return response()->json([
            'has_active_shift'      => false,
            'expected_opening_cash' => $expectedOpeningCash,
            'previous_closing_cash' => $lastClosingCash,
            'intermediate_cash_in'  => $intermediateCashIn,
            'intermediate_cash_out' => $intermediateCashOut,
            'recent_movements'      => $intermediateMovements,
            'last_shift'            => $lastShift ? [
                'id'            => $lastShift->id,
                'closed_at'     => $lastShift->end_time ? $lastShift->end_time->format('m/d/Y h:i A') : '—',
                'cashier'       => $lastShift->user?->name,
                'terminal'      => $lastShift->terminal?->name,
                'actual_cash'   => (float) $lastShift->actual_cash,
                'difference'    => (float) $lastShift->difference,
            ] : null,
        ]);
    }

    /**
     * Open a new shift with counted starting cash.
     */
    public function open(Request $request)
    {
        $request->validate([
            'starting_cash' => 'required|numeric|min:0',
            'opening_notes' => 'nullable|string|max:500',
            'terminal_id'   => 'nullable|exists:terminals,id'
        ]);

        $user = Auth::user();
        $storeId = \App\Support\CurrentStore::id() ?? $user->store_id;
        $terminalId = $request->terminal_id;

        // Prevent opening duplicate active shifts on this user or terminal
        $existingQuery = Shift::where('store_id', $storeId)->where('status', 'open');
        if ($terminalId) {
            $existingQuery->where(function($q) use ($user, $terminalId) {
                $q->where('user_id', $user->id)->orWhere('terminal_id', $terminalId);
            });
        } else {
            $existingQuery->where('user_id', $user->id);
        }

        $existingShift = $existingQuery->first();

        if ($existingShift) {
            return response()->json([
                'message' => 'There is already an active open shift on this user or terminal.',
                'shift'   => $existingShift
            ], 422);
        }

        return DB::transaction(function () use ($request, $user, $storeId, $terminalId) {
            // Find last closed shift for this terminal
            $lastShiftQuery = Shift::where('store_id', $storeId)->where('status', 'closed');
            if ($terminalId) {
                $lastShiftQuery->where('terminal_id', $terminalId);
            }
            $lastShift = $lastShiftQuery->latest('end_time')->first();
            if (!$lastShift) {
                $lastShift = Shift::where('store_id', $storeId)->where('status', 'closed')->latest('end_time')->first();
            }

            $lastClosingCash = $lastShift ? (float) $lastShift->actual_cash : 0.00;
            $lastClosedTime = $lastShift && $lastShift->end_time ? $lastShift->end_time : Carbon::parse('2000-01-01 00:00:00');

            $movementsQuery = CashMovement::where('store_id', $storeId)
                ->where(function ($q) use ($lastClosedTime) {
                    $q->whereNull('shift_id')->orWhere('created_at', '>=', $lastClosedTime);
                })
                ->where('created_at', '>=', $lastClosedTime);

            if ($terminalId) {
                $movementsQuery->where(function($q) use ($terminalId) {
                    $q->where('terminal_id', $terminalId)->orWhereNull('terminal_id');
                });
            }

            $intermediateMovements = $movementsQuery->get();

            $intermediateIn = (float) $intermediateMovements->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
            $intermediateOut = (float) $intermediateMovements->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
            $expectedOpeningCash = max(0, $lastClosingCash + $intermediateIn - $intermediateOut);

            $startingCash = (float) $request->starting_cash;
            $openingDiscrepancy = $startingCash - $expectedOpeningCash;

            $shift = Shift::create([
                'store_id'              => $storeId,
                'user_id'               => $user->id,
                'terminal_id'           => $terminalId,
                'start_time'            => now(),
                'expected_opening_cash' => $expectedOpeningCash,
                'starting_cash'         => $startingCash,
                'opening_discrepancy'   => $openingDiscrepancy,
                'opening_notes'         => $request->opening_notes,
                'cash_sales'            => 0,
                'cash_in'               => 0,
                'cash_out'              => 0,
                'expenses'              => 0,
                'expected_cash'         => $startingCash,
                'status'                => 'open'
            ]);

            $shift->load(['user', 'terminal']);

            try {
                \App\Services\ActivityService::log(
                    'shift.open',
                    'shift.open',
                    'Shift',
                    $shift->id,
                    "Opened shift #{$shift->id} with starting cash ₱" . number_format($startingCash, 2),
                    null,
                    [
                        'starting_cash' => $startingCash,
                        'expected_opening_cash' => $expectedOpeningCash,
                        'discrepancy' => $openingDiscrepancy,
                        'terminal_id' => $terminalId
                    ]
                );
            } catch (\Exception $logEx) {
                // Silently swallow log errors
            }

            return response()->json([
                'message' => 'Shift opened successfully.',
                'shift'   => $shift
            ], 201);
        });
    }

    /**
     * Get all currently active/open shifts across the store (for Admin drawer management).
     */
    public function activeShifts(Request $request)
    {
        $user = Auth::user();
        $storeId = \App\Support\CurrentStore::id() ?? $user->store_id;

        $openShifts = Shift::where('store_id', $storeId)
            ->where('status', 'open')
            ->with(['user', 'terminal'])
            ->orderBy('start_time', 'desc')
            ->get();

        foreach ($openShifts as $shift) {
            $sales = Sale::where('cashier_id', $shift->user_id)
                ->where('status', 'completed')
                ->where('created_at', '>=', $shift->start_time)
                ->get();
            $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
            $cashIn = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
            $cashOut = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
            $currentCash = max(0, (float) $shift->starting_cash + $cashSales + $cashIn - $cashOut - (float) ($shift->expenses ?? 0));
            
            $shift->current_drawer_cash = $currentCash;
            $shift->cash_sales = $cashSales;
        }

        return response()->json($openShifts);
    }

    /**
     * Record a cash movement (Owner Draw, Safe Drop, Petty Cash, Cash In/Out).
     */
    public function cashMovement(Request $request)
    {
        $request->validate([
            'type'        => 'required|string|in:cash_in,cash_out,owner_draw,safe_drop,float_topup,expense',
            'amount'      => 'required|numeric|min:0.01',
            'reason'      => 'required|string|max:255',
        ]);

        $user = Auth::user();
        $storeId = \App\Support\CurrentStore::id() ?? $user->store_id;

        // Standalone POS: one cash drawer. The movement goes to the open shift, or, between
        // shifts, to the store's register drawer (picked up when the next shift opens).
        $activeShift = Shift::where('store_id', $storeId)
            ->where('status', 'open')
            ->latest('start_time')
            ->first();
        $targetShiftId = $activeShift?->id;
        $targetTerminalId = $activeShift
            ? $activeShift->terminal_id
            : Terminal::where('store_id', $storeId)->orderBy('id')->value('id');

        // Validate available drawer funds for deductions to prevent negative drawer
        $isDeduction = in_array($request->type, ['cash_out', 'owner_draw', 'safe_drop', 'expense']);
        if ($isDeduction) {
            $availableCash = 0;
            $locationName = 'the cash drawer';

            if ($targetShiftId) {
                $shift = Shift::find($targetShiftId);
                if ($shift) {
                    $locationName = "the cash drawer (Shift #{$shift->id})";
                    $sales = Sale::where('cashier_id', $shift->user_id)
                        ->where('status', 'completed')
                        ->where('created_at', '>=', $shift->start_time)
                        ->get();
                    $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
                    $cashIn = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
                    $cashOut = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
                    $availableCash = max(0, (float) $shift->starting_cash + $cashSales + $cashIn - $cashOut - (float) ($shift->expenses ?? 0));
                }
            } else if ($targetTerminalId) {
                $lastShift = Shift::where('store_id', $storeId)->where('status', 'closed')->where('terminal_id', $targetTerminalId)->latest('end_time')->first();
                $lastClosingCash = $lastShift ? (float) $lastShift->actual_cash : 0.00;
                $lastClosedTime = $lastShift && $lastShift->end_time ? $lastShift->end_time : Carbon::parse('2000-01-01 00:00:00');

                $movements = CashMovement::where('store_id', $storeId)->where('terminal_id', $targetTerminalId)->where('created_at', '>=', $lastClosedTime)->get();
                $in = (float) $movements->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
                $out = (float) $movements->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
                $availableCash = max(0, $lastClosingCash + $in - $out);
            }

            if ((float) $request->amount > $availableCash) {
                return response()->json([
                    'message' => "Insufficient cash in {$locationName}. Cannot deduct ₱" . number_format($request->amount, 2) . " because available balance is only ₱" . number_format($availableCash, 2) . "."
                ], 422);
            }
        }

        $movement = CashMovement::create([
            'store_id'    => $storeId,
            'user_id'     => $user->id,
            'shift_id'    => $targetShiftId,
            'terminal_id' => $targetTerminalId,
            'type'        => $request->type,
            'amount'      => $request->amount,
            'reason'      => $request->reason
        ]);

        try {
            $formattedType = str_replace('_', ' ', strtoupper($request->type));
            \App\Services\ActivityService::log(
                'cash_movement.create',
                'cash_movement.create',
                'CashMovement',
                $movement->id,
                "Recorded {$formattedType} of ₱" . number_format($request->amount, 2) . " (Reason: {$request->reason})",
                null,
                [
                    'type' => $request->type,
                    'amount' => (float) $request->amount,
                    'reason' => $request->reason,
                    'shift_id' => $targetShiftId,
                    'terminal_id' => $targetTerminalId
                ]
            );
        } catch (\Exception $logEx) {
            // Silently swallow log errors
        }

        return response()->json([
            'message'  => 'Cash movement recorded successfully.',
            'movement' => $movement->load(['user', 'terminal'])
        ], 201);
    }

    /**
     * Close the active shift with full cash reconciliation and Z-Read data generation.
     */
    public function close(Request $request)
    {
        $request->validate([
            'actual_cash'   => 'required|numeric|min:0',
            'expenses'      => 'nullable|numeric|min:0',
            'closing_notes' => 'nullable|string|max:500'
        ]);

        $user = Auth::user();

        return DB::transaction(function () use ($request, $user) {
            // 1. Find active open shift for this user
            $shift = Shift::where('user_id', $user->id)
                ->where('status', 'open')
                ->latest('start_time')
                ->first();

            $startTime = $shift ? $shift->start_time : Carbon::parse('2000-01-01 00:00:00');
            $startingCash = $shift ? (float) $shift->starting_cash : 0.00;

            // 2. Calculate Cash & Digital Sales
            $sales = Sale::where('cashier_id', $user->id)
                ->where('status', 'completed')
                ->where('created_at', '>=', $startTime)
                ->get();

            $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
            $gcashSales = (float) $sales->where('payment_method', 'gcash')->sum('total_amount') / 100;
            $mayaSales = (float) $sales->where('payment_method', 'maya')->sum('total_amount') / 100;
            $creditCardSales = (float) $sales->where('payment_method', 'credit_card')->sum('total_amount') / 100;
            $debitCardSales = (float) $sales->where('payment_method', 'debit_card')->sum('total_amount') / 100;
            $totalSales = (float) $sales->sum('total_amount') / 100;

            // 3. Calculate Mid-Shift Cash In / Cash Out
            $cashIn = 0;
            $cashOut = 0;
            if ($shift) {
                $cashIn = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
                $cashOut = (float) CashMovement::where('shift_id', $shift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');
            }

            $expenses = (float) ($request->expenses ?? 0);
            $actualCash = (float) $request->actual_cash;
            $expectedCash = $startingCash + $cashSales + $cashIn - $cashOut - $expenses;
            $difference = $actualCash - $expectedCash;

            if ($shift) {
                $shift->update([
                    'end_time'      => now(),
                    'cash_sales'    => $cashSales,
                    'cash_in'       => $cashIn,
                    'cash_out'      => $cashOut,
                    'expenses'      => $expenses,
                    'expected_cash' => $expectedCash,
                    'actual_cash'   => $actualCash,
                    'difference'    => $difference,
                    'closing_notes' => $request->closing_notes,
                    'status'        => 'closed'
                ]);
            } else {
                // Fallback: create closed shift
                $shift = Shift::create([
                    'store_id'      => $user->store_id,
                    'user_id'       => $user->id,
                    'start_time'    => $startTime,
                    'end_time'      => now(),
                    'starting_cash' => $startingCash,
                    'cash_sales'    => $cashSales,
                    'cash_in'       => $cashIn,
                    'cash_out'      => $cashOut,
                    'expenses'      => $expenses,
                    'expected_cash' => $expectedCash,
                    'actual_cash'   => $actualCash,
                    'difference'    => $difference,
                    'closing_notes' => $request->closing_notes,
                    'status'        => 'closed'
                ]);
            }

            // Append dynamic breakdown fields for Z-Read report
            $shift->gcash_sales = $gcashSales;
            $shift->maya_sales = $mayaSales;
            $shift->credit_card_sales = $creditCardSales;
            $shift->debit_card_sales = $debitCardSales;
            $shift->total_sales = $totalSales;
            $shift->transactions_count = $sales->count();
            $shift->load(['user', 'cashMovements.user']);

            try {
                \App\Services\ActivityService::log(
                    'shift.close',
                    'shift.close',
                    'Shift',
                    $shift->id,
                    "Closed shift #{$shift->id} with actual cash ₱" . number_format($actualCash, 2) . " (Variance: ₱" . number_format($difference, 2) . ")",
                    null,
                    [
                        'actual_cash' => $actualCash,
                        'expected_cash' => $expectedCash,
                        'difference' => $difference,
                        'total_sales' => $totalSales,
                        'transactions_count' => $sales->count()
                    ]
                );
            } catch (\Exception $logEx) {
                // Silently swallow log errors
            }

            return response()->json($shift);
        });
    }

    /**
     * Retrieve aggregated report data for a specific shift audit modal.
     */
    public function data($id)
    {
        $shift = Shift::with(['user', 'cashMovements.user'])->findOrFail($id);

        $sales = Sale::where('cashier_id', $shift->user_id)
            ->where('status', 'completed')
            ->whereBetween('created_at', [$shift->start_time, $shift->end_time ?? now()])
            ->get();

        $cashSales = (float) $sales->where('payment_method', 'cash')->sum('total_amount') / 100;
        $gcashSales = (float) $sales->where('payment_method', 'gcash')->sum('total_amount') / 100;
        $mayaSales = (float) $sales->where('payment_method', 'maya')->sum('total_amount') / 100;
        $creditCardSales = (float) $sales->where('payment_method', 'credit_card')->sum('total_amount') / 100;
        $debitCardSales = (float) $sales->where('payment_method', 'debit_card')->sum('total_amount') / 100;

        return response()->json([
            'id'                    => $shift->id,
            'staff_name'            => $shift->user->name,
            'start_time'            => $shift->start_time,
            'end_time'              => $shift->end_time,
            'start'                 => $shift->start_time->format('m/d/Y h:i A'),
            'end'                   => $shift->end_time ? $shift->end_time->format('m/d/Y h:i A') : 'ACTIVE',
            'printed_at'            => now()->format('m/d/Y h:i A'),
            'expected_opening_cash' => (float) $shift->expected_opening_cash,
            'starting_cash'         => (float) $shift->starting_cash,
            'opening_discrepancy'   => (float) $shift->opening_discrepancy,
            'opening_notes'         => $shift->opening_notes,
            'closing_notes'         => $shift->closing_notes,
            'cash_sales'            => $cashSales,
            'gcash_sales'           => $gcashSales,
            'maya_sales'            => $mayaSales,
            'credit_card_sales'     => $creditCardSales,
            'debit_card_sales'      => $debitCardSales,
            'cash_in'               => (float) $shift->cash_in,
            'cash_out'              => (float) $shift->cash_out,
            'expenses'              => (float) ($shift->expenses ?? 0),
            'expected_cash'         => (float) $shift->expected_cash,
            'actual_cash'           => (float) $shift->actual_cash,
            'difference'            => (float) $shift->difference,
            'status'                => $shift->status,
            'transactions_count'    => $sales->count(),
            'total_sales'           => (float) $sales->sum('total_amount') / 100,
            'cash_movements'        => $shift->cashMovements,
        ]);
    }
}
