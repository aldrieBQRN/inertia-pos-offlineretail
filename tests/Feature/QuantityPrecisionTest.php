<?php

use App\Models\Product;
use App\Support\Quantity;

beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
});

function precisionProduct(string $baseUnit, ?string $decimals, array $units): Product
{
    $cat = test()->postJson('/api/categories', ['name' => 'Cat ' . uniqid()])->json();
    $catId = $cat['id'] ?? $cat['category']['id'] ?? $cat['data']['id'];
    $sku = 'P-' . uniqid();

    // Same shape the Inventory form sends (multipart, units as JSON)
    test()->post('/api/products', [
        'name' => "Item {$sku}", 'category_id' => (string) $catId, 'cost_price' => '1', 'stock_quantity' => '1000',
        'sku' => $sku, 'is_active' => '1', 'selling_method' => 'multiple', 'base_unit' => $baseUnit,
        'quantity_decimals' => $decimals ?? '',
        'units' => json_encode($units),
    ], ['Accept' => 'application/json'])->assertSuccessful();

    return Product::where('sku', $sku)->with('units')->firstOrFail();
}

function sell(Product $product, string $unitName, $quantity)
{
    $unit = $product->units->firstWhere('name', $unitName);

    return test()->postJson('/api/checkout', [
        'cart' => [['id' => $product->id, 'product_unit_id' => $unit->id, 'quantity' => $quantity, 'price' => $unit->price / 100, 'name' => $product->name]],
        'payment_method' => 'cash', 'cash_given' => 100000, 'change' => 0,
    ]);
}

test('decimal places helper', function () {
    expect(Quantity::decimalPlaces('2.50'))->toBe(1)
        ->and(Quantity::decimalPlaces(3))->toBe(0)
        ->and(Quantity::decimalPlaces('0.3048'))->toBe(4)
        ->and(Quantity::decimalPlaces('12.75000000'))->toBe(2);
});

test('quantity precision defaults from the base unit and can be overridden', function () {
    expect(Product::defaultQuantityDecimals('Piece'))->toBe(0)
        ->and(Product::defaultQuantityDecimals('pcs'))->toBe(0)
        ->and(Product::defaultQuantityDecimals('Meter'))->toBe(2)
        ->and(Product::defaultQuantityDecimals('kg'))->toBe(3)
        ->and(Product::defaultQuantityDecimals('Liter'))->toBe(3)
        ->and(Product::defaultQuantityDecimals('Bundle'))->toBe(2);

    $auto = precisionProduct('Meter', null, [['name' => 'Meter', 'conversion_factor' => '1', 'price' => '10', 'wholesale_price' => '9', 'is_default' => true]]);
    expect($auto->quantity_decimals)->toBeNull()
        ->and($auto->quantity_precision)->toBe(2);

    $custom = precisionProduct('Meter', '1', [['name' => 'Meter', 'conversion_factor' => '1', 'price' => '10', 'wholesale_price' => '9', 'is_default' => true]]);
    expect($custom->quantity_decimals)->toBe(1)
        ->and($custom->quantity_precision)->toBe(1)
        ->and($custom->toArray()['quantity_precision'])->toBe(1);

    // Standard products are always whole numbers
    expect((new Product(['selling_method' => 'standard']))->quantity_precision)->toBe(0);
});

test('checkout enforces the product quantity decimals while deducting exact base stock', function () {
    $wire = precisionProduct('Meter', null, [
        ['name' => 'Meter', 'conversion_factor' => '1', 'price' => '10', 'wholesale_price' => '9', 'is_default' => true],
        ['name' => 'Feet', 'conversion_factor' => '0.3048', 'price' => '3', 'wholesale_price' => '2', 'is_default' => false],
    ]);

    sell($wire, 'Meter', 2.555)->assertStatus(400)->assertJsonFragment(['message' => "{$wire->name} allows up to 2 decimal place(s) per quantity."]);
    expect($wire->fresh()->stock_quantity)->toBe(1000);

    // 2.5 Feet is within 2 decimals; deduction stays exact (0.762 m)
    sell($wire, 'Feet', 2.5)->assertOk();
    expect($wire->fresh()->stock_quantity)->toBe(999.238);

    $nails = precisionProduct('Piece', null, [
        ['name' => 'Piece', 'conversion_factor' => '1', 'price' => '2', 'wholesale_price' => '1.5', 'is_default' => true],
        ['name' => 'Kilo', 'conversion_factor' => '150', 'price' => '180', 'wholesale_price' => '165', 'is_default' => false],
    ]);
    sell($nails, 'Kilo', 1.5)->assertStatus(400)->assertJsonFragment(['message' => "{$nails->name} is sold in whole quantities only."]);
    sell($nails, 'Kilo', 2)->assertOk();
    expect($nails->fresh()->stock_quantity)->toBe(700);
});
