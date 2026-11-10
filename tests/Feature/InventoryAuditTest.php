<?php

use App\Models\ActivityLog;
use App\Models\Product;

beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
});

function importWire(array $overrides = []): Product
{
    test()->postJson('/api/products/import', [
        'file_name' => 'wire.xlsx',
        'products' => [array_replace([
            'sku' => 'WIRE-1', 'name' => 'Wire', 'category_name' => 'Electrical', 'cost_price' => 5,
            'stock_quantity' => 100.5, 'selling_method' => 'multiple', 'base_unit' => 'Meter', 'default_unit' => 'Meter',
        ], $overrides)],
        'units' => [
            ['sku' => 'WIRE-1', 'unit_name' => 'Meter', 'conversion_factor' => 1, 'retail_price' => 8, 'wholesale_price' => 7, 'is_default' => 'yes'],
            ['sku' => 'WIRE-1', 'unit_name' => 'Feet', 'conversion_factor' => 0.3048, 'retail_price' => 3, 'wholesale_price' => 2, 'is_default' => 'no'],
            ['sku' => 'WIRE-1', 'unit_name' => 'Roll', 'conversion_factor' => 100, 'retail_price' => 700, 'wholesale_price' => 650, 'is_default' => 'no'],
        ],
        'overwrite' => true,
    ])->assertOk();

    return Product::where('sku', 'WIRE-1')->with('units')->firstOrFail();
}

test('the inventory form can create and edit multiple-uom products with decimal conversion factors', function () {
    $cat = $this->postJson('/api/categories', ['name' => 'Fabric'])->json();
    $catId = $cat['id'] ?? $cat['category']['id'] ?? $cat['data']['id'];

    // Same shape the Inventory form sends: multipart fields, units as a JSON string, numbers as strings
    $form = fn (array $units) => [
        'name' => 'Satin', 'category_id' => (string) $catId, 'cost_price' => '2', 'stock_quantity' => '100',
        'sku' => 'SAT-1', 'is_active' => '1', 'selling_method' => 'multiple', 'base_unit' => 'Meter',
        'units' => json_encode($units),
    ];

    $this->post('/api/products', $form([
        ['name' => 'Meter', 'conversion_factor' => '1', 'price' => '5', 'wholesale_price' => '4', 'is_default' => true],
    ]), ['Accept' => 'application/json'])->assertSuccessful();
    $product = Product::where('sku', 'SAT-1')->firstOrFail();

    $this->post("/api/products/{$product->id}", ['_method' => 'PUT'] + $form([
        ['name' => 'Meter', 'conversion_factor' => '1', 'price' => '5', 'wholesale_price' => '4', 'is_default' => true],
        ['name' => 'Yard', 'conversion_factor' => '1.5', 'price' => '7', 'wholesale_price' => '6', 'is_default' => false],
    ]), ['Accept' => 'application/json'])->assertOk();

    $yard = $product->fresh('units')->units->firstWhere('name', 'Yard');
    expect($yard)->not->toBeNull()
        ->and((float) $yard->conversion_factor)->toBe(1.5);

    // Selling 3 Yards deducts 4.5 Meter
    $this->postJson('/api/checkout', [
        'cart' => [['id' => $product->id, 'product_unit_id' => $yard->id, 'quantity' => 3, 'price' => 7, 'name' => 'Satin']],
        'payment_method' => 'cash', 'cash_given' => 100, 'change' => 79,
    ])->assertOk();
    expect($product->fresh()->stock_quantity)->toBe(95.5);
});

test('restocking in a fractional selling unit adds the exact base quantity and logs the units', function () {
    $wire = importWire();
    $feet = $wire->units->firstWhere('name', 'Feet');

    $this->postJson("/api/products/{$wire->id}/stock", ['quantity' => 1, 'unit_id' => $feet->id])
        ->assertOk()->assertJsonPath('new_stock', 100.8048);

    expect($wire->fresh()->stock_quantity)->toBe(100.8048);

    $log = ActivityLog::where('action', 'stock_adjust')->where('model_id', $wire->id)->latest('id')->first();
    expect($log->description)->toBe('Received 1 Feet (+0.3048 Meter) for: Wire (Stock: 100.5 → 100.8048 Meter)')
        ->and($log->new_values['unit'])->toBe('Meter')
        ->and($log->new_values['quantity_change'])->toBe(0.3048);
});

test('stock history API reports sales in base units with the selling unit', function () {
    $wire = importWire();
    $roll = $wire->units->firstWhere('name', 'Roll');

    $this->postJson('/api/checkout', [
        'cart' => [['id' => $wire->id, 'product_unit_id' => $roll->id, 'quantity' => 1, 'price' => 700, 'name' => $wire->name]],
        'payment_method' => 'cash',
        'cash_given' => 1000,
        'change' => 300,
    ])->assertOk()->assertJsonPath('success', true);

    $history = $this->getJson("/api/products/{$wire->id}/history")->assertOk()->json();
    $sale = collect($history['timeline'])->firstWhere('type', 'sale');

    expect($history['product']['base_unit'])->toBe('Meter')
        ->and($history['product']['units'])->toHaveCount(3)
        ->and($history['stats']['unit_label'])->toBe('Meter')
        ->and($history['stats']['total_sold_units'])->toEqual(100)
        ->and($history['stats']['total_revenue'])->toBe(70000) // cents, same as the page preload
        ->and($sale['quantity_change'])->toEqual(-100)
        ->and($sale['unit_name'])->toBe('Roll')
        ->and($sale['description'])->toStartWith('Sold 1 Roll (100 Meter) via POS');

    $feed = collect($this->getJson('/api/inventory/recent-activity')->json('data'))->firstWhere('action', 'stock.sale');
    expect($feed['description'])->toStartWith('Sold 1 Roll (100 Meter) of Wire via POS');
});

test('voiding a sale logs the returned stock so the stock ledger reconciles', function () {
    $wire = importWire();
    $roll = $wire->units->firstWhere('name', 'Roll');

    $this->postJson('/api/checkout', [
        'cart' => [['id' => $wire->id, 'product_unit_id' => $roll->id, 'quantity' => 1, 'price' => 700, 'name' => $wire->name]],
        'payment_method' => 'cash', 'cash_given' => 1000, 'change' => 300,
    ])->assertOk();
    $sale = \App\Models\Sale::latest('id')->firstOrFail();
    expect($wire->fresh()->stock_quantity)->toBe(0.5);

    $this->postJson("/api/transactions/{$sale->id}/void")->assertOk();
    expect($wire->fresh()->stock_quantity)->toBe(100.5);

    $log = ActivityLog::where('model_id', $wire->id)->where('action', 'stock_void_return')->first();
    expect($log)->not->toBeNull()
        ->and($log->description)->toBe("Sale voided ({$sale->invoice_number}): returned 1 Roll (100 Meter) of Wire (Stock: 0.5 → 100.5 Meter)")
        ->and($log->new_values['quantity_change'])->toEqual(100)
        ->and($log->new_values['unit'])->toBe('Meter');

    // Ledger: initial 100.5, sale -100, void return +100 -> sums to the current 100.5
    $history = $this->getJson("/api/products/{$wire->id}/history")->assertOk()->json();
    $return = collect($history['timeline'])->firstWhere('subtype', 'void_return');
    expect($return['type'])->toBe('adjustment')
        ->and($return['quantity_change'])->toEqual(100)
        ->and(collect($history['timeline'])->sum('quantity_change'))->toEqual(100.5);
});

test('reports include each product quantity precision', function () {
    $wire = importWire();
    $roll = $wire->units->firstWhere('name', 'Roll');
    $this->postJson('/api/checkout', [
        'cart' => [['id' => $wire->id, 'product_unit_id' => $roll->id, 'quantity' => 1, 'price' => 700, 'name' => $wire->name]],
        'payment_method' => 'cash', 'cash_given' => 1000, 'change' => 300,
    ])->assertOk();

    $report = $this->getJson('/api/reports')->assertOk()->json();
    $item = collect($report['inventory_report']['items'])->firstWhere('sku', 'WIRE-1');
    $sold = collect($report['product_report']['products'])->firstWhere('sku', 'WIRE-1');

    expect($item['quantity_precision'])->toBe(2)
        ->and($item['base_unit'])->toBe('Meter')
        ->and($sold['quantity_precision'])->toBe(2)
        ->and($sold['units_sold'])->toEqual(100);
});

test('imports are audited per product and as a summary', function () {
    $wire = importWire();

    $create = ActivityLog::where('model_type', 'Product')->where('model_id', $wire->id)->where('action', 'create')->first();
    expect($create)->not->toBeNull()
        ->and($create->description)->toBe('Imported product from wire.xlsx: Wire (SKU: WIRE-1)')
        ->and($create->new_values['selling_method'])->toBe('Multiple UOM')
        ->and($create->new_values['stock_quantity'])->toBe(100.5)
        ->and($create->new_values['units'])->toContain('Roll = 100 Meter @ ₱700.00 (WS ₱650.00)');

    $summary = ActivityLog::where('model_type', 'Inventory')->where('action', 'import')->latest('id')->first();
    expect($summary->description)->toBe('Imported wire.xlsx: 1 new, 0 updated')
        ->and($summary->new_values['new_products'])->toBe(1);

    // Re-import with a changed name: one update log with before/after, no update log when nothing changed
    importWire(['name' => 'Wire #14']);
    $update = ActivityLog::where('model_id', $wire->id)->where('action', 'update')->latest('id')->first();
    expect($update->old_values['name'])->toBe('Wire')
        ->and($update->new_values['name'])->toBe('Wire #14');

    $updatesBefore = ActivityLog::where('model_id', $wire->id)->where('action', 'update')->count();
    importWire(['name' => 'Wire #14']);
    expect(ActivityLog::where('model_id', $wire->id)->where('action', 'update')->count())->toBe($updatesBefore);
});

test('rejected imports are audited without saving anything', function () {
    $this->postJson('/api/products/import', [
        'file_name' => 'bad.xlsx',
        'products' => [['sku' => 'BAD-1', 'name' => '', 'category_name' => 'X', 'price' => 1]],
    ])->assertStatus(422);

    expect(Product::where('sku', 'BAD-1')->exists())->toBeFalse();
    $log = ActivityLog::where('action', 'import_failed')->latest('id')->first();
    expect($log)->not->toBeNull()
        ->and($log->description)->toContain('bad.xlsx was rejected');
});

test('exports are audited', function () {
    $wire = importWire();

    $this->postJson('/api/inventory/export-log', ['type' => 'inventory_excel', 'count' => 12, 'units_count' => 3, 'file_name' => 'x.xlsx'])->assertOk();
    $this->postJson('/api/inventory/export-log', ['type' => 'stock_ledger_excel', 'count' => 4, 'product_id' => $wire->id])->assertOk();
    $this->postJson('/api/inventory/export-log', ['type' => 'nope'])->assertStatus(422);

    $logs = ActivityLog::where('action', 'export')->orderBy('id')->get();
    expect($logs)->toHaveCount(2)
        ->and($logs[0]->description)->toBe('Exported inventory to Excel (12 product(s), 3 selling unit(s))')
        ->and($logs[1]->description)->toBe('Exported stock ledger to Excel for Wire (SKU: WIRE-1) (4 movement(s))')
        ->and($logs[1]->model_id)->toBeNull();
});
