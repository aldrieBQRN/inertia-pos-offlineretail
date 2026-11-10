<?php

namespace App\Models;

use App\Support\Quantity;
use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Casts\Attribute;
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
        'display_unit',
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
        'product_unit_id',
        'custom_name',
        'unit_name',
        'conversion_factor',
        'base_quantity',
        'quantity',
        'unit_price',
        'cost_price_snapshot',
        'subtotal',
    ];

    protected $casts = [
        'unit_price' => 'integer',
        'cost_price_snapshot' => 'integer',
        'subtotal' => 'integer',
    ];

    protected function quantity(): Attribute
    {
        return Attribute::make(
            get: fn ($value) => Quantity::toNumber($value)
        );
    }

    protected function baseQuantity(): Attribute
    {
        return Attribute::make(
            get: fn ($value) => $value === null ? null : Quantity::toNumber($value)
        );
    }

    protected function conversionFactor(): Attribute
    {
        return Attribute::make(
            get: fn ($value) => $value === null ? null : Quantity::toNumber($value)
        );
    }

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

    public function productUnit()
    {
        return $this->belongsTo(ProductUnit::class);
    }

    public function getDisplayUnitAttribute(): ?string
    {
        return $this->unit_name ?: null;
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
