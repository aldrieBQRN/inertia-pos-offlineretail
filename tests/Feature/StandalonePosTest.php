<?php

use App\Models\Product;
use App\Models\Sale;
use App\Models\Terminal;

beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
});

test('every page of the app renders for the admin', function (string $uri) {
    $this->withoutVite()->get($uri)->assertOk();
})->with(['/dashboard', '/pos', '/inventory', '/transactions', '/shifts', '/reports', '/settings', '/profile', '/activity-logs']);

test('removed multi-user, branch and developer pages are gone', function (string $uri) {
    $this->get($uri)->assertNotFound();
})->with(['/users', '/developer', '/portal/billing', '/register', '/forgot-password', '/artisan-migrate']);

test('a full sale can be rung up and is stored locally', function () {
    $category = $this->postJson('/api/categories', ['name' => 'Beverages'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'] ?? null;
    expect($categoryId)->not->toBeNull();

    $this->postJson('/api/products', [
        'name' => 'Iced Tea 500ml',
        'category_id' => $categoryId,
        'price' => 35,
        'cost_price' => 20,
        'wholesale_price' => 30,
        'stock_quantity' => 50,
        'sku' => 'BEV-0001',
    ])->assertSuccessful();

    $product = Product::where('sku', 'BEV-0001')->firstOrFail();
    $terminal = Terminal::firstOrFail();

    $this->postJson('/api/shift/open', ['starting_cash' => 1000, 'terminal_id' => $terminal->id])->assertSuccessful();

    $this->postJson('/api/checkout', [
        'cart' => [['id' => $product->id, 'quantity' => 3, 'price' => 35, 'name' => $product->name]],
        'payment_method' => 'cash',
        'cash_given' => 200,
        'change' => 95,
        'terminal_id' => $terminal->id,
    ])->assertSuccessful();

    $sale = Sale::with('items')->firstOrFail();
    expect($sale->total_amount)->toBe(10500)
        ->and($sale->cashier_id)->toBe($this->admin->id)
        ->and($sale->items)->toHaveCount(1)
        ->and($product->refresh()->stock_quantity)->toBe(47);

    $this->getJson('/api/dashboard')->assertOk();
    $this->getJson('/api/reports')->assertOk();
    $this->getJson('/api/transactions')->assertOk();

    $this->postJson('/api/shift/close', ['actual_cash' => 1105])->assertSuccessful();
});

test('pages render without any external asset or network reference', function () {
    $html = $this->withoutVite()->get('/pos')->getContent();

    expect($html)->not->toContain('fonts.googleapis.com')
        ->not->toContain('fonts.bunny.net')
        ->not->toContain('fonts.gstatic.com')
        ->not->toMatch('#<(script|link)[^>]+(src|href)="https?://#i');
});

test('pos terminal exposes cash in/out immediately before close shift and wires F4 to the shared modal', function () {
    $source = file_get_contents(resource_path('js/Pages/PosTerminal.jsx'));

    // Button ordering: Cash In / Out appears before the Close/Open Shift button
    $cashIdx = strpos($source, '{/* Cash In / Cash Out (F4) */}');
    $shiftIdx = strpos($source, '{/* Close / Open Shift (F5) */}');
    expect($cashIdx)->not->toBeFalse()
        ->and($shiftIdx)->not->toBeFalse()
        ->and($cashIdx)->toBeLessThan($shiftIdx);

    // F4 opens the shared modal state (not a duplicate implementation)
    expect($source)->toContain("else if (e.key === 'F4')")
        ->and($source)->toContain('setShowCashMovementModal(true)')
        ->and($source)->toContain("import CashMovementModal from '@/Components/CashMovementModal'")
        ->and(substr_count($source, '<CashMovementModal'))->toBe(1);

    // The modal-open guard suspends POS shortcuts while the cash modal is open
    expect($source)->toContain('showCloseShiftModal || showCashMovementModal');
});

test('the pos page renders for the admin with cash movement access', function () {
    $this->withoutVite()->get('/pos')->assertOk()->assertInertia(fn ($page) => $page
        ->component('PosTerminal')
        ->has('initial_terminals')
        ->has('initial_shift_data'));
});

test('the content security policy only allows local resources', function () {
    $csp = $this->withoutVite()->get('/dashboard')->headers->get('Content-Security-Policy');

    expect($csp)->toContain("default-src 'self'")
        ->not->toContain('https:')
        ->not->toContain('googleapis');
});
