<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * A selling unit configured for a Multiple Units of Measurement product.
 *
 * conversion_factor is the equivalent quantity in the product's base
 * inventory unit (e.g. 1 Roll = 100 Meter).
 */
class ProductUnit extends Model
{
    use HasFactory, BelongsToStore;

    protected $fillable = [
        'product_id',
        'store_id',
        'name',
        'conversion_factor',
        'price',
        'wholesale_price',
        'is_default',
        'sort_order',
    ];

    protected $casts = [
        'conversion_factor' => 'decimal:8',
        'price' => 'integer',
        'wholesale_price' => 'integer',
        'is_default' => 'boolean',
        'sort_order' => 'integer',
    ];

    public function product()
    {
        return $this->belongsTo(Product::class);
    }
}
