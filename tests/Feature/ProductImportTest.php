<?php

use App\Models\Product;

beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
});

test('old 7-column rows import as standard products with blank wholesale/cost defaulting to 0', function () {
    $this->postJson('/api/products/import', [
        'products' => [
            ['rowNum' => 7, 'sku' => 'ABC', 'name' => 'Hammer', 'category_name' => 'Tools', 'price' => 250, 'wholesale_price' => null, 'cost_price' => null, 'stock_quantity' => 12],
        ],
        'overwrite' => true,
    ])->assertOk()->assertJsonPath('imported_count', 1);

    $product = Product::where('sku', 'ABC')->firstOrFail();
    expect($product->selling_method)->toBe('standard')
        ->and($product->price)->toBe(25000)
        ->and($product->wholesale_price)->toBe(0)
        ->and($product->cost_price)->toBe(0)
        ->and($product->stock_quantity)->toBe(12);
});

test('exported multiple-uom rows import with their units and re-import preserves stock', function () {
    $payload = [
        'products' => [
            ['rowNum' => 7, 'sku' => 'STD-1', 'name' => 'Cement', 'category_name' => 'Construction', 'price' => 220, 'wholesale_price' => 200, 'cost_price' => 180, 'stock_quantity' => 50, 'selling_method' => 'standard'],
            ['rowNum' => 8, 'sku' => 'WIRE-9', 'name' => 'Wire', 'category_name' => 'Electrical', 'price' => null, 'wholesale_price' => null, 'cost_price' => 5, 'stock_quantity' => 1000.5, 'selling_method' => 'multiple', 'base_unit' => 'Meter', 'default_unit' => 'Meter'],
        ],
        'units' => [
            ['rowNum' => 7, 'sku' => 'WIRE-9', 'unit_name' => 'Meter', 'conversion_factor' => 1, 'retail_price' => 8, 'wholesale_price' => 7, 'is_default' => 'yes', 'sort_order' => 1],
            ['rowNum' => 8, 'sku' => 'WIRE-9', 'unit_name' => 'Feet', 'conversion_factor' => 0.3048, 'retail_price' => 2.5, 'wholesale_price' => 2.2, 'is_default' => 'no', 'sort_order' => 2],
        ],
        'overwrite' => true,
    ];

    $this->postJson('/api/products/import', $payload)->assertOk()->assertJsonPath('imported_count', 2);

    $wire = Product::where('sku', 'WIRE-9')->firstOrFail();
    expect($wire->selling_method)->toBe('multiple')
        ->and($wire->base_unit)->toBe('Meter')
        ->and($wire->cost_price)->toBe(500)
        ->and($wire->stock_quantity)->toBe(1000.5)
        ->and($wire->units)->toHaveCount(2)
        ->and($wire->units->firstWhere('name', 'Meter')->is_default)->toBeTrue()
        ->and($wire->units->firstWhere('name', 'Feet')->is_default)->toBeFalse()
        ->and($wire->units->firstWhere('name', 'Feet')->price)->toBe(250);

    // Re-import (export -> edit -> import): details update, stock is preserved
    $payload['products'][1]['stock_quantity'] = 1;
    $payload['products'][1]['name'] = 'Wire Updated';
    $this->postJson('/api/products/import', $payload)->assertOk()->assertJsonPath('updated_count', 2);

    $wire->refresh();
    expect($wire->name)->toBe('Wire Updated')
        ->and($wire->stock_quantity)->toBe(1000.5)
        ->and($wire->units)->toHaveCount(2);
});

test('update_stock sets existing stock from the file and logs a stock adjustment', function () {
    $row = ['sku' => 'CNT-1', 'name' => 'Counted Item', 'category_name' => 'Tools', 'price' => 10, 'wholesale_price' => 9, 'cost_price' => 5, 'stock_quantity' => 50];
    $this->postJson('/api/products/import', ['products' => [$row], 'overwrite' => true])->assertOk();
    $product = Product::where('sku', 'CNT-1')->firstOrFail();

    // Without update_stock the file stock is ignored
    $this->postJson('/api/products/import', ['products' => [[...$row, 'stock_quantity' => 10]], 'overwrite' => true])
        ->assertOk()->assertJsonPath('stock_updated_count', 0);
    expect($product->fresh()->stock_quantity)->toBe(50);

    // With update_stock it is set and logged
    $this->postJson('/api/products/import', ['products' => [[...$row, 'stock_quantity' => 47]], 'overwrite' => true, 'update_stock' => true])
        ->assertOk()->assertJsonPath('stock_updated_count', 1);
    expect($product->fresh()->stock_quantity)->toBe(47);

    $log = \App\Models\ActivityLog::where('model_type', 'Product')->where('model_id', $product->id)
        ->where('action', 'stock_adjust')->latest('id')->first();
    expect($log)->not->toBeNull()
        ->and($log->old_values['stock_quantity'])->toBe(50)
        ->and($log->new_values['stock_quantity'])->toBe(47)
        ->and($log->new_values['quantity_change'])->toBe(-3);

    // A blank stock cell never changes stock, even with update_stock
    $this->postJson('/api/products/import', ['products' => [[...$row, 'stock_quantity' => null]], 'overwrite' => true, 'update_stock' => true])
        ->assertOk()->assertJsonPath('stock_updated_count', 0);
    expect($product->fresh()->stock_quantity)->toBe(47);

    // Skip mode leaves the product untouched
    $this->postJson('/api/products/import', ['products' => [[...$row, 'name' => 'Renamed', 'stock_quantity' => 1]], 'overwrite' => false, 'update_stock' => true])
        ->assertOk()->assertJsonPath('skipped_count', 1);
    expect($product->fresh()->name)->toBe('Counted Item')
        ->and($product->fresh()->stock_quantity)->toBe(47);
});

test('the product list endpoint includes units so polling keeps multiple-uom prices', function () {
    $this->postJson('/api/products/import', [
        'products' => [
            ['sku' => 'WIRE-9', 'name' => 'Wire', 'category_name' => 'Electrical', 'cost_price' => 5, 'stock_quantity' => 100, 'selling_method' => 'multiple', 'base_unit' => 'Meter', 'default_unit' => 'Meter'],
        ],
        'units' => [
            ['sku' => 'WIRE-9', 'unit_name' => 'Meter', 'conversion_factor' => 1, 'retail_price' => 20, 'wholesale_price' => 50, 'is_default' => 'yes'],
            ['sku' => 'WIRE-9', 'unit_name' => 'Roll', 'conversion_factor' => 100, 'retail_price' => 1500, 'wholesale_price' => 1400, 'is_default' => 'no'],
        ],
    ])->assertOk();

    $wire = collect($this->getJson('/api/products?all=1')->assertOk()->json())->firstWhere('sku', 'WIRE-9');
    expect($wire['units'])->toHaveCount(2);
});

test('multiple-uom rows without exactly one default unit are rejected', function () {
    $this->postJson('/api/products/import', [
        'products' => [
            ['sku' => 'W', 'name' => 'Wire', 'category_name' => 'E', 'cost_price' => 5, 'stock_quantity' => 10, 'selling_method' => 'Multiple UOM', 'base_unit' => 'Meter', 'default_unit' => 'Meter'],
        ],
        'units' => [
            ['sku' => 'W', 'unit_name' => 'Meter', 'conversion_factor' => 1, 'retail_price' => 8, 'wholesale_price' => 7, 'is_default' => 'no'],
        ],
    ])->assertStatus(422);

    expect(Product::where('sku', 'W')->exists())->toBeFalse();
});
