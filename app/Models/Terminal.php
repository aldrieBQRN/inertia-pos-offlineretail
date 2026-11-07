<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Terminal Model
 * Represents a physical POS register, counter lane, or workstation within a store.
 */
class Terminal extends Model
{
    use HasFactory, BelongsToStore;

    protected $fillable = [
        'store_id',
        'name',
        'code',
        'is_active',
        'notes'
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function shifts()
    {
        return $this->hasMany(Shift::class);
    }

    public function activeShift()
    {
        return $this->hasOne(Shift::class)->where('status', 'open')->latest('start_time');
    }

    public function cashMovements()
    {
        return $this->hasMany(CashMovement::class);
    }

    public function sales()
    {
        return $this->hasMany(Sale::class);
    }
}
