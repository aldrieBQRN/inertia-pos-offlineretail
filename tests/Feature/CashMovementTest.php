<?php

use App\Models\CashMovement;
use App\Models\Terminal;

/**
 * Cash In / Cash Out on the single cash drawer of the standalone POS (no register selection).
 */
beforeEach(function () {
    $this->admin = setupPos('pin4', '2580');
    $this->actingAs($this->admin);
    $this->register = Terminal::query()->sole();
});

function openShift(float $float = 1000): array
{
    return test()->postJson('/api/shift/open', [
        'starting_cash' => $float,
        'terminal_id' => test()->register->id,
    ])->assertCreated()->json('shift');
}

function drawerBalance(): float
{
    $open = test()->getJson('/api/shifts/active')->assertOk()->json();
    if (count($open) > 0) {
        return (float) $open[0]['current_drawer_cash'];
    }

    return (float) test()->getJson('/api/terminals')->assertOk()->json('0.current_drawer_cash');
}

test('cash in is recorded on the open shift without choosing a register', function () {
    $shift = openShift(1000);

    $movement = $this->postJson('/api/shift/cash-movement', [
        'type' => 'cash_in',
        'amount' => 300,
        'reason' => 'Change fund deposit',
    ])->assertCreated()->json('movement');

    expect($movement['shift_id'])->toBe($shift['id'])
        ->and($movement['type'])->toBe('cash_in')
        ->and((float) $movement['amount'])->toBe(300.0)
        ->and($movement['reason'])->toBe('Change fund deposit')
        ->and($movement['user_id'])->toBe($this->admin->id)
        ->and(drawerBalance())->toBe(1300.0);
});

test('cash out is recorded on the open shift without choosing a register', function () {
    $shift = openShift(1000);

    $movement = $this->postJson('/api/shift/cash-movement', [
        'type' => 'cash_out',
        'amount' => 125.5,
        'reason' => 'Store cleaning supplies',
    ])->assertCreated()->json('movement');

    expect($movement['shift_id'])->toBe($shift['id'])
        ->and(drawerBalance())->toBe(874.5);
});

test('a cash out larger than the drawer is still rejected', function () {
    openShift(1000);

    $this->postJson('/api/shift/cash-movement', [
        'type' => 'cash_out',
        'amount' => 1000.01,
        'reason' => 'Too much',
    ])->assertStatus(422)->assertJson(['message' => 'Insufficient cash in the cash drawer (Shift #1). Cannot deduct ₱1,000.01 because available balance is only ₱1,000.00.']);

    expect(CashMovement::count())->toBe(0)->and(drawerBalance())->toBe(1000.0);
});

test('register or shift ids sent by an old client are ignored', function () {
    $shift = openShift(500);

    $movement = $this->postJson('/api/shift/cash-movement', [
        'type' => 'cash_in',
        'amount' => 50,
        'reason' => 'Legacy payload',
        'shift_id' => 999,
        'terminal_id' => 999,
    ])->assertCreated()->json('movement');

    expect($movement['shift_id'])->toBe($shift['id'])
        ->and($movement['terminal_id'])->toBe($this->register->id);
});

test('between shifts, cash in and out go to the single drawer and carry into the next shift', function () {
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 800, 'reason' => 'Opening float from safe'])
        ->assertCreated()
        ->assertJsonPath('movement.shift_id', null)
        ->assertJsonPath('movement.terminal_id', $this->register->id);
    expect(drawerBalance())->toBe(800.0);

    $this->postJson('/api/shift/cash-movement', ['type' => 'safe_drop', 'amount' => 200, 'reason' => 'Move excess to safe'])
        ->assertCreated();
    expect(drawerBalance())->toBe(600.0);

    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_out', 'amount' => 600.01, 'reason' => 'Too much'])
        ->assertStatus(422);

    // The next shift expects the drawer to hold the carried-over cash
    $this->getJson('/api/shift/current?terminal_id=' . $this->register->id)
        ->assertOk()
        ->assertJsonPath('expected_opening_cash', 600);
});

test('cash movements appear in shift accountability and history', function () {
    $shift = openShift(1000);
    $in = $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 300, 'reason' => 'Deposit'])->json('movement');
    $out = $this->postJson('/api/shift/cash-movement', ['type' => 'owner_draw', 'amount' => 100, 'reason' => 'Owner pickup'])->json('movement');

    $history = collect($this->getJson('/api/shifts?all=1')->assertOk()->json())->firstWhere('id', $shift['id']);
    expect(collect($history['cash_movements'])->pluck('id')->all())->toEqualCanonicalizing([$in['id'], $out['id']]);
    $entry = collect($history['cash_movements'])->firstWhere('id', $in['id']);
    expect($entry['reason'])->toBe('Deposit')->and($entry['user']['name'])->toBe('Store Owner');

    $this->withoutVite()->get('/shifts')->assertOk()->assertInertia(fn ($page) => $page
        ->component('ShiftHistory')
        ->has("initial_shift_details.{$shift['id']}.cash_movements", 2));
});

test('amount, reason and type validation is unchanged', function (array $payload, string $field) {
    openShift(1000);

    $this->postJson('/api/shift/cash-movement', $payload)->assertStatus(422)->assertJsonValidationErrors($field);
})->with([
    'zero amount' => [['type' => 'cash_in', 'amount' => 0, 'reason' => 'x'], 'amount'],
    'missing reason' => [['type' => 'cash_in', 'amount' => 10], 'reason'],
    'unknown type' => [['type' => 'transfer', 'amount' => 10, 'reason' => 'x'], 'type'],
]);

test('the shifts page provides the general cash movement history and labels it Cash Movement', function () {
    $shift = openShift(1000);
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 300, 'reason' => 'Deposit'])->assertCreated();
    $this->postJson('/api/shift/cash-movement', ['type' => 'owner_draw', 'amount' => 100, 'reason' => 'Owner pickup'])->assertCreated();

    // Close the shift, then record a no-shift movement
    $this->postJson('/api/shift/close', ['actual_cash' => 1200])->assertOk();
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 50, 'reason' => 'Change before opening'])->assertCreated();

    $this->withoutVite()->get('/shifts')->assertOk()->assertInertia(function ($page) use ($shift) {
        $page->component('ShiftHistory')
            ->has('initial_cash_movements', 3);
        $movements = collect($page->toArray()['props']['initial_cash_movements']);
        expect($movements->whereNotNull('shift_id')->pluck('shift_id')->unique()->all())->toBe([$shift['id']])
            ->and($movements->whereNull('shift_id'))->toHaveCount(1)
            ->and($movements->whereNull('shift_id')->first()['reason'])->toBe('Change before opening');
    });

    $source = file_get_contents(resource_path('js/Pages/ShiftHistory.jsx'));
    expect($source)->toContain('>Cash In / Cash Out<')
        ->and($source)->not->toContain('Record Owner Draw, Safe Drop, Cash In, or Expense')
        ->and($source)->not->toContain('General Cash Movement History');

    $modalSource = file_get_contents(resource_path('js/Components/CashMovementHistoryModal.jsx'));
    expect($modalSource)->toContain('General / No Shift');
});

test('loại Cash Movement không tạo shift giả và không thay đổi hành vi cashMovement()', function () {
    $shiftCountBefore = \App\Models\Shift::count();

    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 500, 'reason' => 'Starting Cash'])
        ->assertCreated()
        ->assertJsonPath('movement.shift_id', null);

    expect(\App\Models\Shift::count())->toBe($shiftCountBefore)
        ->and(CashMovement::sole()->shift_id)->toBeNull();
});

test('cash out without an active shift is validated against the register drawer', function () {
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 800, 'reason' => 'Float'])->assertCreated();

    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_out', 'amount' => 801, 'reason' => 'Too much'])
        ->assertStatus(422);

    $movement = $this->postJson('/api/shift/cash-movement', ['type' => 'cash_out', 'amount' => 800, 'reason' => 'Exact'])
        ->assertCreated()->json('movement');

    expect($movement['shift_id'])->toBeNull();
});

test('a cash movement still writes the cash_movement.create audit record', function () {
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 200, 'reason' => 'Float top-up'])->assertCreated();

    $log = \App\Models\ActivityLog::where('action', 'cash_movement.create')->sole();
    expect($log->new_values['type'])->toBe('cash_in')
        ->and((float) $log->new_values['amount'])->toBe(200.0)
        ->and($log->new_values['reason'])->toBe('Float top-up');
});

test('the pos terminal still exposes cash in/out via F4', function () {
    $source = file_get_contents(resource_path('js/Pages/PosTerminal.jsx'));
    expect($source)->toContain("else if (e.key === 'F4')")
        ->and($source)->toContain('<CashMovementModal');
});

test('the shifts toolbar has cash movement before data & export and opens the global history modal', function () {
    $source = file_get_contents(resource_path('js/Pages/ShiftHistory.jsx'));

    $cashMovementIdx = strpos($source, '<span>Cash In / Cash Out</span>');
    $historyIdx = strpos($source, '<span>Cash Movement History</span>');
    $dataExportIdx = strpos($source, '<span>Data & Export</span>');
    expect($cashMovementIdx)->not->toBeFalse()
        ->and($historyIdx)->not->toBeFalse()
        ->and($dataExportIdx)->not->toBeFalse()
        ->and($cashMovementIdx)->toBeLessThan($historyIdx)
        ->and($historyIdx)->toBeLessThan($dataExportIdx);

    // Toolbar trigger state + global modal wired with the FULL, unfiltered collection
    expect($source)->toContain('setShowCashMovementHistoryModal(true)')
        ->and($source)->toContain('<CashMovementHistoryModal')
        ->and($source)->toContain('cashMovements={cashMovements}')
        ->and($source)->not->toContain('cashMovements.filter(movement => movement.shift_id === selectedShift');

    // The history modal is read-only: no create form or cash-movement POST inside it
    $modalSource = file_get_contents(resource_path('js/Components/CashMovementHistoryModal.jsx'));
    // The history modal renders movement cards, not a table
    expect($modalSource)->toContain('Cash Movement History')
        ->and($modalSource)->toContain('General / No Shift')
        ->and($modalSource)->not->toContain('axios.post')
        ->and($modalSource)->not->toContain('cash-movement')
        ->and($modalSource)->not->toContain('<table');
});

test('the shifts page carries mixed-shift and no-shift movements and paginates by 10', function () {
    $shift = openShift(1000);
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 300, 'reason' => 'Deposit'])->assertCreated();
    $this->postJson('/api/shift/close', ['actual_cash' => 1300])->assertOk();
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 50, 'reason' => 'Float before opening'])->assertCreated();

    $this->withoutVite()->get('/shifts')->assertOk()->assertInertia(function ($page) use ($shift) {
        $movements = collect($page->toArray()['props']['initial_cash_movements']);
        $withShift = $movements->whereNotNull('shift_id');
        $withoutShift = $movements->whereNull('shift_id');
        expect($withShift)->toHaveCount(1)
            ->and($withShift->first()['shift_id'])->toBe($shift['id'])
            ->and($withoutShift)->toHaveCount(1)
            ->and($withoutShift->first()['reason'])->toBe('Float before opening');
    });

    expect(file_get_contents(resource_path('js/Components/CashMovementHistoryModal.jsx')))
        ->toContain('const itemsPerPage = 10;');
});

test('the shift view drawer cash adjustments section remains', function () {
    $source = file_get_contents(resource_path('js/Pages/ShiftHistory.jsx'));
    expect($source)->toContain('Drawer Cash Adjustments');
});

test('the dashboard live shift card includes cash sales and Cash In/Out recorded during the shift', function () {
    $shift = openShift(1000);

    // One cash sale of ₱100
    $category = $this->postJson('/api/categories', ['name' => 'Snacks'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];
    $product = $this->postJson('/api/products', [
        'name' => 'Chips', 'category_id' => $categoryId, 'price' => 100, 'cost_price' => 60,
        'wholesale_price' => 90, 'stock_quantity' => 10, 'sku' => 'CHIPS-1',
    ])->assertSuccessful()->json();
    $productId = $product['id'] ?? $product['product']['id'] ?? $product['data']['id'];
    $this->postJson('/api/checkout', [
        'cart' => [['id' => $productId, 'quantity' => 1, 'price' => 100]],
        'payment_method' => 'cash', 'cash_given' => 100, 'change' => 0,
        'terminal_id' => $this->register->id,
    ])->assertSuccessful();

    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 300, 'reason' => 'Deposit'])->assertCreated();
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_out', 'amount' => 125.5, 'reason' => 'Supplies'])->assertCreated();

    $card = $this->getJson('/api/dashboard')->assertOk()->json('active_shift');

    expect($card['id'])->toBe($shift['id'])
        ->and((float) $card['starting_cash'])->toBe(1000.0)
        ->and((float) $card['cash_sales'])->toBe(100.0)
        ->and((float) $card['cash_in'])->toBe(300.0)
        ->and((float) $card['cash_out'])->toBe(125.5)
        ->and((float) $card['expected_cash'])->toBe(1274.5)
        ->and((float) $card['expected_cash'])->toBe(drawerBalance())   // same figure the POS shows
        ->and($card['movements_count'])->toBe(2);
});
