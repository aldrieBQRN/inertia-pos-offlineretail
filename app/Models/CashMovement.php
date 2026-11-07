<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * CashMovement Model
 * Tracks intermediate and mid-shift cash drawer adjustments (Owner Draws, Safe Drops, Petty Cash, Float Topups).
 */
class CashMovement extends Model
{
    use HasFactory, BelongsToStore;

    protected $fillable = [
        'store_id',
        'user_id',
        'shift_id',
        'terminal_id',
        'type',
        'amount',
        'reason'
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function shift()
    {
        return $this->belongsTo(Shift::class);
    }

    public function terminal()
    {
        return $this->belongsTo(Terminal::class);
    }
}
