<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * SaleItem Model
 * * Represents an individual line item within a transaction,
 * capturing the specific product, quantity, and price at the time of sale.
 */
class SaleItem extends Model
{
    use HasFactory, BelongsToStore;

    protected $appends = [
        'display_name',
    ];

    /**
     * The attributes that are mass assignable.
     * * * Includes links to the parent sale and product,
     * along with volume and pricing data in cents.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'sale_id',
        'product_id',
        'custom_name',
        'quantity',
        'unit_price',
        'subtotal',
    ];

    /**
     * Relationship: Each line item belongs to a parent Sale (Receipt).
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function sale()
    {
        return $this->belongsTo(Sale::class);
    }

    /**
     * Relationship: Each line item is an instance of a specific Product.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function product()
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * Human-readable line item name for receipts and history views.
     */
    public function getDisplayNameAttribute(): string
    {
        if (!empty($this->product?->name)) {
            return $this->product->name;
        }

        if (!empty($this->custom_name) && $this->custom_name !== 'Custom Item') {
            return $this->custom_name;
        }

        return $this->custom_name ?: 'Item';
    }
}
