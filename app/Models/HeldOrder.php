<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * HeldOrder Model
 * * Represents a temporarily saved shopping cart for later recall.
 */
class HeldOrder extends Model
{
    use HasFactory, BelongsToStore;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'reference_note',
        'cart_data',
        'total_amount'
    ];

    /**
     * The attributes that should be cast to native types.
     * * * 'cart_data' is stored as JSON in the database and automatically
     * converted to a PHP array when accessed.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'cart_data' => 'array',
    ];
}
