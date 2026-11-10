<?php

use App\Models\Product;
use App\Models\User;
use App\Support\Quantity;
use Database\Seeders\DemoSeeder;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    activateLicense();
    $this->seed(DemoSeeder::class);
    $this->actingAs(User::where('role', 'admin')->firstOrFail());
});

test('demo seeder builds a store with standard and multiple-uom products', function () {
    expect(User::count())->toBe(2)
        ->and(Product::where('selling_method', 'multiple')->count())->toBe(7)
        ->and(Product::where('selling_method', 'standard')->count())->toBe(14)
        ->and(DB::table('product_units')->count())->toBe(18);

    $nails = Product::where('sku', 'UOM-NAIL-2')->firstOrFail();
    expect($nails->quantity_precision)->toBe(1)
        ->and($nails->defaultUnit()->name)->toBe('Kilo');

    // A few products end low / out of stock for the demo
    expect(Product::where('sku', 'MEAT-002')->value('stock_quantity'))->toEqual(0)
        ->and(Product::where('sku', 'UOM-EGG-L')->firstOrFail()->stock_quantity)->toEqual(18);
});

test('every product stock ledger adds up to its current stock', function () {
    foreach (Product::all() as $product) {
        $history = $this->getJson("/api/products/{$product->id}/history")->assertOk()->json();
        $sum = collect($history['timeline'])->reduce(fn ($c, $row) => Quantity::add($c, $row['quantity_change']), '0');

        expect(Quantity::compare($sum, $product->stock_quantity))->toBe(0, "{$product->sku}: ledger {$sum} vs stock {$product->stock_quantity}");
    }
});

test('sales use selling-unit snapshots and voids are recorded', function () {
    $multiItems = DB::table('sale_items')->whereNotNull('product_unit_id')->get();
    expect($multiItems)->not->toBeEmpty();

    foreach ($multiItems as $item) {
        expect(Quantity::compare(Quantity::multiply($item->quantity, $item->conversion_factor), $item->base_quantity))->toBe(0)
            ->and($item->unit_name)->not->toBeNull();
    }

    expect(DB::table('sales')->where('status', 'void')->count())->toBe(2)
        ->and(DB::table('activity_logs')->where('action', 'stock_void_return')->count())->toBeGreaterThan(0)
        ->and(DB::table('activity_logs')->where('action', 'sale_voided')->count())->toBe(2);
});

test('shifts reconcile like the close-shift screen', function () {
    $closed = DB::table('shifts')->where('status', 'closed')->orderBy('start_time')->get();
    expect($closed)->toHaveCount(14)
        ->and(DB::table('shifts')->where('status', 'open')->count())->toBe(1);

    $previousActual = null;
    foreach ($closed as $shift) {
        // Same formula as ShiftController::close (sales by this cashier since the shift opened)
        $cashSales = DB::table('sales')->where('cashier_id', $shift->user_id)->where('status', 'completed')
            ->where('payment_method', 'cash')->whereBetween('created_at', [$shift->start_time, $shift->end_time])->sum('total_amount') / 100;
        $in = DB::table('cash_movements')->where('shift_id', $shift->id)->whereIn('type', ['cash_in', 'float_topup'])->sum('amount');
        $out = DB::table('cash_movements')->where('shift_id', $shift->id)->whereIn('type', ['cash_out', 'owner_draw', 'safe_drop', 'expense'])->sum('amount');

        expect(round((float) $shift->cash_sales, 2))->toBe(round($cashSales, 2))
            ->and(round((float) $shift->expected_cash, 2))->toBe(round($shift->starting_cash + $cashSales + $in - $out, 2))
            ->and(round((float) $shift->difference, 2))->toBe(round($shift->actual_cash - $shift->expected_cash, 2));

        // Each shift starts with what the previous one counted
        if ($previousActual !== null) {
            expect(round((float) $shift->starting_cash, 2))->toBe(round($previousActual, 2));
        }
        $previousActual = (float) $shift->actual_cash;
    }
});

test('the main pages and reports load with the demo data', function () {
    $this->withoutVite();
    foreach (['/dashboard', '/inventory', '/pos', '/transactions', '/reports'] as $url) {
        $this->get($url)->assertOk();
    }
    $this->getJson('/api/reports')->assertOk();
    $this->getJson('/api/inventory/recent-activity')->assertOk();
});
