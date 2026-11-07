<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Shift Model
 * * Tracks cashier work sessions, including starting float,
 * total sales, and final cash reconciliation (overages/shortages).
 */
class Shift extends Model
{
    use HasFactory, BelongsToStore;

    /**
     * The attributes that are mass assignable.
     * * * Captures time-tracking, financial totals, and shift status.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'store_id',
        'user_id',
        'terminal_id',
        'start_time',
        'end_time',
        'expected_opening_cash',
        'starting_cash',
        'opening_discrepancy',
        'cash_sales',
        'cash_in',
        'cash_out',
        'expenses',
        'expected_cash',
        'actual_cash',
        'difference',
        'status',
        'opening_notes',
        'closing_notes'
    ];

    /**
     * The attributes that should be cast to native types.
     * * * Ensures start and end times are treated as Carbon datetime objects.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'start_time' => 'datetime',
        'end_time'   => 'datetime',
        'expected_opening_cash' => 'decimal:2',
        'starting_cash' => 'decimal:2',
        'opening_discrepancy' => 'decimal:2',
        'cash_sales' => 'decimal:2',
        'cash_in' => 'decimal:2',
        'cash_out' => 'decimal:2',
        'expenses' => 'decimal:2',
        'expected_cash' => 'decimal:2',
        'actual_cash' => 'decimal:2',
        'difference' => 'decimal:2',
    ];

    /**
     * Get the user (cashier) that owns the shift.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the terminal / register assigned to the shift.
     */
    public function terminal()
    {
        return $this->belongsTo(Terminal::class);
    }

    /**
     * Get the intermediate and in-shift cash movements for this shift.
     */
    public function cashMovements()
    {
        return $this->hasMany(CashMovement::class);
    }
}
