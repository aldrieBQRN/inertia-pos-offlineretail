<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Storage;

/**
 * Product Model
 * * Represents an inventory item within the POS system.
 * * Handles normalized pricing (cents), stock levels, and categorization.
 */
class Product extends Model
{
    use HasFactory, BelongsToStore;

    /**
     * The attributes that are mass assignable.
     * * Includes identification (SKU), financial data, and inventory tracking.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'description',
        'sku',
        'price',
        'cost_price',
        'wholesale_price',
        'stock_quantity',
        'low_stock_threshold',
        'category_id',
        'store_id',
        'image_path',
        'is_active',
    ];

    /**
     * The attributes that should be cast to native types.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'is_active' => 'boolean',
        'stock_quantity' => 'integer',
        'price' => 'integer',
        'wholesale_price' => 'integer',
    ];

    /**
     * Relationship: Each product belongs to a specific category.
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function category()
    {
        return $this->belongsTo(Category::class);
    }

    /**
     * Accessor: Formats the integer price (cents) into a human-readable decimal.
     * Usage: $product->display_price
     */
    protected function displayPrice(): Attribute
    {
        return Attribute::make(
            get: fn() => number_format($this->price / 100, 2)
        );
    }

    /**
     * Accessor: Formats the integer wholesale price (cents) into a human-readable decimal.
     * Usage: $product->display_wholesale_price
     */
    protected function displayWholesalePrice(): Attribute
    {
        return Attribute::make(
            get: fn() => $this->wholesale_price !== null ? number_format($this->wholesale_price / 100, 2) : null
        );
    }

    /**
     * Accessor: Automatically generates a fully qualified URL for the image path.
     * * This ensures that the frontend receives a valid path via the storage symlink.
     * Usage: $product->image_path
     */
    protected function imagePath(): Attribute
    {
        return Attribute::make(
            get: function ($value) {
                if (!$value) return null;

                // If the path already contains 'storage/', return it as is to avoid duplication
                if (str_starts_with($value, '/storage/')) {
                    return $value;
                }

                return Storage::url($value);
            }
        );
    }
}
