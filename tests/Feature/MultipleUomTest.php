<?php

use App\Models\Product;
use App\Models\ProductUnit;
use App\Models\Sale;
use App\Models\SaleItem;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
});

function createCategoryForUom(): int
{
    $category = test()->postJson('/api/categories', ['name' => 'Ribbons'])->assertSuccessful()->json();

    return $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];
}

function createMultipleUomProduct(array $overrides = []): Product
{
    $categoryId = createCategoryForUom();

    test()->postJson('/api/products', array_replace([
        'name' => 'Satin Ribbon',
        'category_id' => $categoryId,
        'sku' => 'RIB-0001',
        'selling_method' => 'multiple',
        'base_unit' => 'meter',
        'cost_price' => 2,
        'stock_quantity' => 1000,
        'low_stock_threshold' => 100,
        'units' => [
            ['name' => 'Roll', 'conversion_factor' => 100, 'price' => 500, 'wholesale_price' => 450, 'is_default' => true],
            ['name' => 'Half Roll', 'conversion_factor' => 50, 'price' => 260, 'wholesale_price' => 240, 'is_default' => false],
        ],
    ], $overrides))->assertSuccessful();

    return Product::where('sku', $overrides['sku'] ?? 'RIB-0001')->firstOrFail();
}

test('a multiple-uom product stores selling prices per unit and a base-unit cost', function () {
    $product = createMultipleUomProduct();

    expect($product->selling_method)->toBe(Product::SELLING_METHOD_MULTIPLE)
        ->and($product->base_unit)->toBe('meter')
        ->and($product->price)->toBeNull()
        ->and($product->wholesale_price)->toBeNull()
        ->and($product->cost_price)->toBe(200)
        ->and($product->stock_quantity)->toBe(1000)
        ->and($product->units)->toHaveCount(2);

    $roll = $product->units->firstWhere('name', 'Roll');
    expect($roll)->not->toBeNull()
        ->and($roll->is_default)->toBeTrue()
        ->and((string) $roll->conversion_factor)->toStartWith('100')
        ->and($roll->price)->toBe(50000)
        ->and($roll->wholesale_price)->toBe(45000);
});

test('receiving stock in a selling unit converts to base inventory units', function () {
    $product = createMultipleUomProduct();
    $roll = $product->units->firstWhere('name', 'Roll');

    $this->postJson("/api/products/{$product->id}/stock", [
        'quantity' => 1.5,
        'unit_id' => $roll->id,
    ])->assertOk()->assertJsonPath('new_stock', 1150);

    expect($product->fresh()->stock_quantity)->toBe(1150);
});

test('checkout deducts converted base stock and freezes unit, quantity, price and cost snapshots', function () {
    $product = createMultipleUomProduct();
    $roll = $product->units->firstWhere('name', 'Roll');

    $this->postJson('/api/checkout', [
        'cart' => [[
            'id' => $product->id,
            'product_unit_id' => $roll->id,
            'quantity' => 2,
            'price' => 500,
            'name' => $product->name,
        ]],
        'payment_method' => 'cash',
        'cash_given' => 1000,
        'change' => 0,
    ])->assertOk()->assertJsonPath('success', true);

    expect($product->fresh()->stock_quantity)->toBe(800);

    $sale = Sale::with('items')->firstOrFail();
    $item = $sale->items->first();

    expect($sale->total_amount)->toBe(100000)
        ->and($item->product_unit_id)->toBe($roll->id)
        ->and($item->unit_name)->toBe('Roll')
        ->and($item->quantity)->toBe(2)
        ->and($item->base_quantity)->toBe(200)
        ->and($item->unit_price)->toBe(50000)
        ->and($item->cost_price_snapshot)->toBe(200)
        ->and($item->subtotal)->toBe(100000);

    // Selling prices are historical snapshots and do not change with the catalogue.
    $roll->update(['price' => 60000]);

    $detail = $this->getJson("/api/transactions/{$sale->id}")->assertOk()->json();
    expect($detail['items'][0]['unit_price'])->toBe(50000)
        ->and($detail['items'][0]['unit_name'])->toBe('Roll');
});

test('voiding a multiple-uom sale restores the frozen base quantity', function () {
    $product = createMultipleUomProduct();
    $roll = $product->units->firstWhere('name', 'Roll');

    $this->postJson('/api/checkout', [
        'cart' => [[
            'id' => $product->id,
            'product_unit_id' => $roll->id,
            'quantity' => 2,
            'price' => 500,
            'name' => $product->name,
        ]],
        'payment_method' => 'cash',
        'cash_given' => 1000,
        'change' => 0,
    ])->assertOk();

    $sale = Sale::firstOrFail();
    expect($product->fresh()->stock_quantity)->toBe(800);

    $this->postJson("/api/transactions/{$sale->id}/void")->assertOk();

    expect($product->fresh()->stock_quantity)->toBe(1000);
});

test('reports use base quantities and cost snapshots for cogs', function () {
    $product = createMultipleUomProduct();
    $roll = $product->units->firstWhere('name', 'Roll');

    $this->postJson('/api/checkout', [
        'cart' => [[
            'id' => $product->id,
            'product_unit_id' => $roll->id,
            'quantity' => 2,
            'price' => 500,
            'name' => $product->name,
        ]],
        'payment_method' => 'cash',
        'cash_given' => 1000,
        'change' => 0,
    ])->assertOk();

    // Changing the live cost must not rewrite historical COGS.
    $product->update(['cost_price' => 300]);

    $reports = $this->getJson('/api/reports')->assertOk()->json();

    expect($reports['summary']['total_cogs'])->toBe(40000)
        ->and($reports['summary']['total_units_sold'])->toBe(200);

    $productRow = collect($reports['product_report']['products'])->firstWhere('product_id', $product->id);
    expect($productRow)->not->toBeNull()
        ->and($productRow['units_sold'])->toBe(200)
        ->and($productRow['has_missing_cost'])->toBeFalse()
        ->and($productRow['total_cost'])->toBe(40000);
});

test('inventory reports flag multiple-uom products without a cost price', function () {
    $product = createMultipleUomProduct();

    DB::table('products')->where('id', $product->id)->update(['cost_price' => null]);

    $reports = $this->getJson('/api/reports')->assertOk()->json();
    $row = collect($reports['inventory_report']['items'])->firstWhere('id', $product->id);

    expect($row)->not->toBeNull()
        ->and($row['has_cost_price'])->toBeFalse()
        ->and($row['base_unit'])->toBe('meter')
        ->and($reports['inventory_report']['missing_cost_count'])->toBe(1);
});

test('standard products still reject fractional checkout quantities', function () {
    $categoryId = createCategoryForUom();

    $this->postJson('/api/products', [
        'name' => 'Canned Soda',
        'category_id' => $categoryId,
        'sku' => 'STD-0001',
        'price' => 35,
        'cost_price' => 20,
        'wholesale_price' => 30,
        'stock_quantity' => 10,
    ])->assertSuccessful();

    $product = Product::where('sku', 'STD-0001')->firstOrFail();

    $response = $this->postJson('/api/checkout', [
        'cart' => [[
            'id' => $product->id,
            'quantity' => 1.5,
            'price' => 35,
            'name' => $product->name,
        ]],
        'payment_method' => 'cash',
        'cash_given' => 100,
        'change' => 0,
    ]);

    $response->assertStatus(400)->assertJsonPath('success', false);
    expect($response->json('message'))->toContain('whole numbers')
        ->and($product->fresh()->stock_quantity)->toBe(10)
        ->and(Sale::count())->toBe(0);
});

test('standard product sales still record base snapshots without changing the visible quantity', function () {
    $categoryId = createCategoryForUom();

    $this->postJson('/api/products', [
        'name' => 'Bottled Water',
        'category_id' => $categoryId,
        'sku' => 'STD-0002',
        'price' => 20,
        'cost_price' => 10,
        'wholesale_price' => 18,
        'stock_quantity' => 10,
    ])->assertSuccessful();

    $product = Product::where('sku', 'STD-0002')->firstOrFail();

    $this->postJson('/api/checkout', [
        'cart' => [[
            'id' => $product->id,
            'quantity' => 3,
            'price' => 20,
            'name' => $product->name,
        ]],
        'payment_method' => 'cash',
        'cash_given' => 100,
        'change' => 40,
    ])->assertOk();

    $item = SaleItem::firstOrFail();
    expect($item->quantity)->toBe(3)
        ->and($item->base_quantity)->toBe(3)
        ->and($item->unit_name)->toBeNull()
        ->and($item->cost_price_snapshot)->toBe(1000)
        ->and($product->fresh()->stock_quantity)->toBe(7);
});
