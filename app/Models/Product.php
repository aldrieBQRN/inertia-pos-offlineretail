<?php

namespace App\Models;

use App\Support\Quantity;
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

    public const SELLING_METHOD_STANDARD = 'standard';
    public const SELLING_METHOD_MULTIPLE = 'multiple';

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
        'selling_method',
        'base_unit',
        'quantity_decimals',
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
        'price' => 'integer',
        'cost_price' => 'integer',
        'wholesale_price' => 'integer',
        'low_stock_threshold' => 'integer',
        'quantity_decimals' => 'integer',
    ];

    protected $appends = [
        'is_multi_unit',
        'base_unit_label',
        'quantity_precision',
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
     * Selling units configured for a Multiple-UOM product.
     */
    public function units()
    {
        return $this->hasMany(ProductUnit::class)->orderBy('sort_order')->orderBy('id');
    }

    public function defaultUnit()
    {
        return $this->units->firstWhere('is_default', true) ?? $this->units->first();
    }

    /**
     * Stock is stored as an exact decimal; expose whole values as ints so the
     * existing standard-product contract is preserved.
     */
    protected function stockQuantity(): Attribute
    {
        return Attribute::make(
            get: fn ($value) => Quantity::toNumber($value)
        );
    }

    protected function isMultiUnit(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->selling_method === self::SELLING_METHOD_MULTIPLE
        );
    }

    /**
     * Max decimal places for quantities of this product (cashier input and display).
     * Standard products are whole numbers; Multiple UOM use the saved setting or a
     * default derived from the base unit. Stored stock is always kept exact.
     */
    protected function quantityPrecision(): Attribute
    {
        return Attribute::make(get: function () {
            if ($this->selling_method !== self::SELLING_METHOD_MULTIPLE) {
                return 0;
            }

            return $this->quantity_decimals ?? self::defaultQuantityDecimals($this->base_unit);
        });
    }

    /** Sensible default precision for a base unit name (piece -> 0, meter -> 2, kg -> 3). */
    public static function defaultQuantityDecimals(?string $unit): int
    {
        $u = strtolower(trim((string) $unit));
        $u = rtrim($u, '.');

        $whole = ['pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'each', 'ea', 'box', 'boxes', 'pack', 'packs', 'pk',
            'bottle', 'bottles', 'can', 'cans', 'sachet', 'sachets', 'roll', 'rolls', 'set', 'sets', 'pair', 'pairs',
            'dozen', 'tray', 'trays', 'sack', 'sacks', 'bag', 'bags', 'g', 'gram', 'grams', 'gm', 'ml', 'milliliter',
            'milliliters', 'mm', 'millimeter', 'millimeters', 'tablet', 'tablets', 'capsule', 'capsules', 'stick', 'sticks'];
        $three = ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms', 'l', 'liter', 'liters', 'litre', 'litres',
            'lb', 'lbs', 'pound', 'pounds', 'gal', 'gallon', 'gallons', 'ton', 'tons', 'oz', 'ounce', 'ounces'];

        if (in_array($u, $whole, true)) return 0;
        if (in_array($u, $three, true)) return 3;

        return 2; // meter, feet, yard, inch, cm and anything else
    }

    protected function baseUnitLabel(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->base_unit ?: ($this->is_multi_unit ? 'Unit' : null)
        );
    }

    /**
     * Accessor: Formats the integer price (cents) into a human-readable decimal.
     * Usage: $product->display_price
     */
    protected function displayPrice(): Attribute
    {
        return Attribute::make(
            get: fn() => $this->price !== null ? number_format($this->price / 100, 2) : null
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
