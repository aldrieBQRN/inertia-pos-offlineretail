<?php

use App\Models\ActivityLog;
use App\Models\Store;

/**
 * System Activity Logs (restored from main) on the single-Admin standalone POS.
 */
function activityLogsPage(): array
{
    $page = null;
    test()->withoutVite()->get('/activity-logs')->assertOk()->assertInertia(function ($p) use (&$page) {
        $p->component('ActivityLogs')->has('initial_logs')->has('initial_settings')->missing('staff_members');
        $page = $p->toArray();
    });

    return $page['props'];
}

function loggedActions(): array
{
    return collect(activityLogsPage()['initial_logs'])->pluck('action')->all();
}

test('guests are sent to the unlock screen', function () {
    setupPos();

    $this->get('/activity-logs')->assertRedirect('/login');
});

test('the admin can open system activity logs and sees the security trail', function () {
    setupPos('pin4', '2580');
    $this->post('/login', ['credential' => '9137']);   // failed unlock
    $this->post('/login', ['credential' => '2580']);   // successful unlock

    $props = activityLogsPage();
    $actions = collect($props['initial_logs'])->pluck('action');

    expect($actions)->toContain('setup_completed', 'login_failed', 'login_success');

    $login = collect($props['initial_logs'])->firstWhere('action', 'login_success');
    expect($login['category'])->toBe('Security')
        ->and($login['user_name'])->toBe('Store Owner')
        ->and($login['user_account_number'])->not->toBeNull()
        ->and($login)->not->toHaveKey('user_role');

    expect($props['initial_settings']['store_name'])->toBe('Corner Store');
});

test('existing historical records are still shown, newest first', function () {
    $admin = setupPos();
    $this->post('/login', ['credential' => '2580']);

    // A record written by the old multi-user version (e.g. a staff invite) stays viewable
    $old = ActivityLog::create([
        'user_id' => $admin->id,
        'store_id' => Store::current()->id,
        'action' => 'invite_sent',
        'model_type' => 'User',
        'model_id' => $admin->id,
        'description' => 'Legacy: invited a cashier',
        'new_values' => ['email' => 'cashier@example.com'],
    ]);
    $old->forceFill(['created_at' => now()->subYear()])->save();

    $logs = collect(activityLogsPage()['initial_logs']);
    $legacy = $logs->firstWhere('id', $old->id);

    expect($legacy['description'])->toBe('Legacy: invited a cashier')
        ->and($legacy['category'])->toBe('User Management')
        ->and($legacy['new_values'])->toBe(['email' => 'cashier@example.com'])
        ->and($logs->last()['id'])->toBe($old->id);
});

test('only this store\'s activity is listed', function () {
    $admin = setupPos();
    $this->post('/login', ['credential' => '2580']);

    $otherStore = Store::create(['name' => 'Imported Branch', 'status' => true]);
    ActivityLog::create([
        'user_id' => $admin->id,
        'store_id' => $otherStore->id,
        'action' => 'create',
        'model_type' => 'Product',
        'description' => 'Belongs to another store',
    ]);

    $descriptions = collect(activityLogsPage()['initial_logs'])->pluck('description');
    expect($descriptions)->not->toContain('Belongs to another store');
});

test('inventory, shift and cash actions create activity records', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);

    $category = $this->postJson('/api/categories', ['name' => 'Beverages'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];
    $this->postJson('/api/products', [
        'name' => 'Iced Tea 500ml', 'category_id' => $categoryId, 'price' => 35, 'cost_price' => 20,
        'wholesale_price' => 30, 'stock_quantity' => 10, 'sku' => 'TEA-500',
    ])->assertSuccessful();

    $this->postJson('/api/shift/open', ['starting_cash' => 1000])->assertCreated();
    $this->postJson('/api/shift/cash-movement', ['type' => 'cash_in', 'amount' => 50, 'reason' => 'Coins'])->assertCreated();
    $this->post('/api/settings', ['store_name' => 'Corner Store', 'phone' => '0917 123 4567'])->assertSessionHasNoErrors();  // saves, then redirects back

    $logs = collect(activityLogsPage()['initial_logs']);

    expect($logs->pluck('action'))->toContain('create', 'shift.open', 'cash_movement.create')
        ->and($logs->pluck('model_type'))->toContain('Store');
    expect($logs->firstWhere('model_type', 'Product')['category'])->toBe('Product Management')
        ->and($logs->firstWhere('model_type', 'Category')['category'])->toBe('Category Management')
        ->and($logs->firstWhere('action', 'cash_movement.create')['category'])->toBe('Cash & Shifts')
        ->and($logs->firstWhere('model_type', 'Store')['category'])->toBe('Store Settings');

    // Each action is recorded once (no duplicate entries)
    expect($logs->where('action', 'cash_movement.create'))->toHaveCount(1)
        ->and($logs->where('action', 'shift.open'))->toHaveCount(1);
});

test('credential changes and offline account recovery are recorded', function () {
    setupPos();

    $this->post('/recover/verify', ['answers' => ['wrong', 'wrong', 'wrong']]);
    $this->post('/recover/verify', ['answers' => ['Bantay', 'Cebu City', 'Blue']]);
    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691']);

    $this->post('/login', ['credential' => '3691']);
    $this->put('/profile/credential', [
        'current_credential' => '3691',
        'auth_type' => 'pin6',
        'credential' => '480913',
        'credential_confirmation' => '480913',
    ])->assertSessionHasNoErrors();

    expect(loggedActions())->toContain('recovery_failed', 'credential_recovered', 'password_change');
});

test('signing out is recorded', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $this->post('/logout');
    $this->post('/login', ['credential' => '2580']);

    expect(loggedActions())->toContain('logout');
});

/* ---------------- Product audit details & deep links ---------------- */

function createAuditedProduct(array $extra = []): array
{
    $category = test()->postJson('/api/categories', ['name' => 'Snacks'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];

    $product = test()->post('/api/products', array_merge([
        'name' => 'Choco Bar', 'category_id' => $categoryId, 'price' => 25, 'cost_price' => 15,
        'wholesale_price' => 22, 'stock_quantity' => 40, 'sku' => 'CHOCO-1',
        'low_stock_threshold' => 5, 'description' => 'Milk chocolate',
    ], $extra), ['Accept' => 'application/json'])->assertSuccessful()->json();

    return $product;
}

test('a created product is logged with every field, including its image', function () {
    Illuminate\Support\Facades\Storage::fake('public');
    $this->app->usePublicPath(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pos-test-public');
    setupPos();
    $this->post('/login', ['credential' => '2580']);

    $product = createAuditedProduct(['image' => Illuminate\Http\UploadedFile::fake()->image('choco.png', 200, 200)]);

    $log = ActivityLog::where('model_type', 'Product')->where('action', 'create')->sole();
    expect($log->description)->toBe('Created product: Choco Bar (SKU: CHOCO-1) with product image')
        ->and($log->new_values)->toMatchArray([
            'name' => 'Choco Bar', 'sku' => 'CHOCO-1', 'description' => 'Milk chocolate', 'category' => 'Snacks',
            'price' => 25, 'cost_price' => 15, 'wholesale_price' => 22, 'stock_quantity' => 40,
            'low_stock_threshold' => 5, 'is_active' => true,
        ])
        ->and($log->new_values['image_path'])->toStartWith('/storage/products/');

    // The stock ledger still reads the initial stock from the creation log
    $history = $this->getJson("/api/products/{$product['id']}/history")->assertOk()->json();
    $creation = collect($history['timeline'] ?? $history['data']['timeline'] ?? [])->firstWhere('type', 'creation');
    expect($creation['quantity_change'])->toBe(40);
});

test('updating a product logs the full record before and after, and audits image changes', function () {
    Illuminate\Support\Facades\Storage::fake('public');
    $this->app->usePublicPath(sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'pos-test-public');
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $product = createAuditedProduct();

    // Adding an image
    $this->post("/api/products/{$product['id']}", [
        '_method' => 'PUT', 'price' => 30, 'image' => Illuminate\Http\UploadedFile::fake()->image('a.png', 100, 100),
    ], ['Accept' => 'application/json'])->assertSuccessful();

    $added = ActivityLog::where('action', 'update')->latest('id')->first();
    expect($added->description)->toBe('Updated product: Choco Bar (SKU: CHOCO-1) (product image added)')
        ->and($added->old_values)->toMatchArray(['price' => 25, 'image_path' => null, 'category' => 'Snacks', 'stock_quantity' => 40])
        ->and($added->new_values)->toMatchArray(['price' => 30, 'category' => 'Snacks', 'stock_quantity' => 40])
        ->and($added->new_values['image_path'])->toStartWith('/storage/products/');

    // Replacing the image keeps the previous file so the log can still show it
    $firstImage = $added->new_values['image_path'];
    $this->post("/api/products/{$product['id']}", [
        '_method' => 'PUT', 'image' => Illuminate\Http\UploadedFile::fake()->image('b.png', 100, 100),
    ], ['Accept' => 'application/json'])->assertSuccessful();

    $replaced = ActivityLog::where('action', 'update')->latest('id')->first();
    expect($replaced->description)->toEndWith('(product image replaced)')
        ->and($replaced->old_values['image_path'])->toBe($firstImage)
        ->and($replaced->new_values['image_path'])->not->toBe($firstImage);
    Illuminate\Support\Facades\Storage::disk('public')->assertExists(ltrim(str_replace('/storage/', '', $firstImage), '/'));
});

test('archiving a product logs the correct before and after status', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $product = createAuditedProduct();

    $this->patchJson("/api/products/{$product['id']}/toggle-active")->assertOk();

    $log = ActivityLog::where('action', 'update')->latest('id')->first();
    expect($log->old_values['is_active'])->toBeTrue()
        ->and($log->new_values['is_active'])->toBeFalse()
        ->and($log->new_values['name'])->toBe('Choco Bar');
});

test('a LOG reference opens System Activity Logs focused on that entry, even when it is older', function () {
    $admin = setupPos();
    $this->post('/login', ['credential' => '2580']);
    $storeId = Store::current()->id;

    $old = ActivityLog::create([
        'user_id' => $admin->id, 'store_id' => $storeId, 'action' => 'create',
        'model_type' => 'Product', 'model_id' => 1, 'description' => 'Old product entry',
    ]);
    $old->forceFill(['created_at' => now()->subYears(2)])->save();

    // Push it beyond the newest-500 window
    $rows = array_fill(0, 505, [
        'user_id' => $admin->id, 'store_id' => $storeId, 'action' => 'login_success', 'model_type' => 'security',
        'description' => 'Admin signed in', 'created_at' => now(), 'updated_at' => now(),
    ]);
    ActivityLog::insert($rows);

    $this->withoutVite()->get('/activity-logs')->assertInertia(fn ($p) => $p
        ->where('focus_log_id', null)
        ->where('initial_logs', fn ($logs) => !collect($logs)->contains('id', $old->id)));

    $this->withoutVite()->get("/activity-logs?log={$old->id}")->assertInertia(fn ($p) => $p
        ->where('focus_log_id', $old->id)
        ->where('initial_logs', fn ($logs) => collect($logs)->contains('id', $old->id)));

    // Unknown ids are ignored
    $this->withoutVite()->get('/activity-logs?log=999999')->assertInertia(fn ($p) => $p->where('focus_log_id', null));
});

/* ---------------- Transaction void audit ---------------- */

function createCompletedSale(): \App\Models\Sale
{
    test()->postJson('/api/categories', ['name' => 'Beverages'])->assertSuccessful();
    $product = test()->postJson('/api/products', [
        'name' => 'Iced Tea 500ml', 'category_id' => \App\Models\Category::firstOrFail()->id,
        'price' => 35, 'cost_price' => 20, 'wholesale_price' => 30,
        'stock_quantity' => 50, 'sku' => 'BEV-0001',
    ])->assertSuccessful();
    $productId = \App\Models\Product::firstOrFail()->id;
    $terminal = \App\Models\Terminal::firstOrFail();

    test()->postJson('/api/shift/open', ['starting_cash' => 1000, 'terminal_id' => $terminal->id])->assertSuccessful();
    test()->postJson('/api/checkout', [
        'cart' => [['id' => $productId, 'quantity' => 3, 'price' => 35, 'name' => 'Iced Tea 500ml']],
        'payment_method' => 'cash', 'cash_given' => 200, 'change' => 95,
        'terminal_id' => $terminal->id,
    ])->assertSuccessful();

    return \App\Models\Sale::with('items')->latest('id')->firstOrFail();
}

test('voiding a transaction creates a sale_voided activity log', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $sale = createCompletedSale();

    $this->postJson("/api/transactions/{$sale->id}/void")->assertOk();

    $log = ActivityLog::where('action', 'sale_voided')->sole();
    expect($log->model_type)->toBe('Sale')
        ->and($log->model_id)->toBe($sale->id)
        ->and($log->category)->toBe('Sales')
        ->and($log->description)->toContain($sale->invoice_number)
        ->and($log->new_values['status'])->toBe('void')
        ->and($log->new_values['invoice_number'])->toBe($sale->invoice_number)
        ->and($log->new_values['total_amount'])->toBe($sale->total_amount)
        ->and($log->new_values['payment_method'])->toBe('cash')
        ->and($log->user_id)->toBe(\App\Models\User::admin()->id);
});

test('a repeated or failed void does not add another audit record', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $sale = createCompletedSale();

    $this->postJson("/api/transactions/{$sale->id}/void")->assertOk();
    $this->postJson("/api/transactions/{$sale->id}/void")->assertStatus(400);
    $this->postJson('/api/transactions/999999/void')->assertStatus(500);

    expect(ActivityLog::where('action', 'sale_voided')->count())->toBe(1);
});

/* ---------------- Category audit details ---------------- */

test('creating a category does not log a fake color', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);

    $this->postJson('/api/categories', ['name' => 'Beverages'])->assertSuccessful();

    $log = ActivityLog::where('model_type', 'Category')->where('action', 'create')->sole();
    expect($log->new_values)->toHaveKey('name', 'Beverages')
        ->and($log->new_values)->not->toHaveKey('color')
        ->and($log->description)->toContain('Beverages');
});

test('updating a category audit omits the color field', function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
    $category = $this->postJson('/api/categories', ['name' => 'Beverages'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];

    $this->putJson("/api/categories/{$categoryId}", ['name' => 'Drinks'])->assertOk();

    $log = ActivityLog::where('model_type', 'Category')->where('action', 'update')->sole();
    expect($log->old_values)->not->toHaveKey('color')
        ->and($log->new_values)->not->toHaveKey('color')
        ->and($log->new_values)->toHaveKey('name', 'Drinks');
});

/* ---------------- Profile update audit ---------------- */

test('updating the admin profile records only changed fields', function () {
    $admin = setupPos();
    $this->actingAs($admin);

    $this->patch('/profile', [
        'name' => 'Maria Santos',
        'city' => 'Quezon City',
    ])->assertSessionHasNoErrors();

    $log = ActivityLog::where('model_type', 'User')->where('action', 'update')->sole();
    expect($log->description)->toBe('Updated profile')
        ->and($log->new_values['name'])->toBe('Maria Santos')
        ->and($log->new_values['city'])->toBe('Quezon City')
        ->and($log->old_values['name'])->toBe('Store Owner')
        ->and($log->old_values['city'])->toBe('Makati');
});

test('a no-op profile save does not create a profile audit', function () {
    $admin = setupPos();
    $this->actingAs($admin);

    $this->patch('/profile', [
        'name' => $admin->name,
        'phone_number' => $admin->phone_number,
        'address' => $admin->address,
        'city' => $admin->city,
        'province' => $admin->province,
        'country' => $admin->country,
    ])->assertSessionHasNoErrors();

    expect(ActivityLog::where('model_type', 'User')->where('action', 'update')->count())->toBe(0);
});

test('the profile audit never exposes credentials or recovery data', function () {
    $admin = setupPos();
    $this->actingAs($admin);

    $this->patch('/profile', ['name' => 'Maria Santos'])->assertSessionHasNoErrors();

    $log = ActivityLog::where('model_type', 'User')->where('action', 'update')->sole();
    $keys = strtolower(implode(',', array_merge(
        array_keys($log->old_values ?? []),
        array_keys($log->new_values ?? [])
    )));
    expect($keys)->not->toContain('password', 'pin', 'credential', 'recovery', 'answer', 'token', 'secret');

    $raw = strtolower(json_encode([$log->description, $log->old_values, $log->new_values]));
    expect($raw)->not->toContain('3691', '2580');
});

/* ---------------- Receipt customization audit ---------------- */

test('saving receipt customization settings creates an audit with previous and new values', function () {
    $admin = setupPos();
    $this->actingAs($admin);

    $store = \App\Models\Store::current();
    $store->forceFill(['receipt_tagline' => 'Old Tagline', 'receipt_footer' => 'Old footer', 'receipt_paper_width' => '80mm'])->save();

    $this->postJson('/api/settings/receipt', [
        'receipt_tagline' => 'New Tagline',
        'receipt_footer' => 'Old footer',
        'receipt_paper_width' => '58mm',
    ])->assertOk();

    $log = ActivityLog::where('model_type', 'Store')->where('action', 'update')->sole();
    expect($log->description)->toContain('receipt')
        ->and($log->old_values)->toMatchArray(['receipt_tagline' => 'Old Tagline', 'receipt_paper_width' => '80mm'])
        ->and($log->new_values)->toMatchArray(['receipt_tagline' => 'New Tagline', 'receipt_paper_width' => '58mm'])
        ->and($log->new_values)->not->toHaveKey('receipt_footer');

    expect($store->refresh()->receipt_tagline)->toBe('New Tagline')
        ->and($store->receipt_paper_width)->toBe('58mm');
});

test('saving unchanged receipt settings does not create a duplicate audit', function () {
    $admin = setupPos();
    $this->actingAs($admin);

    $store = \App\Models\Store::current();
    $store->forceFill(['receipt_tagline' => 'Same Tagline', 'receipt_footer' => 'Same footer', 'receipt_paper_width' => '80mm'])->save();

    $this->postJson('/api/settings/receipt', [
        'receipt_tagline' => 'Same Tagline',
        'receipt_footer' => 'Same footer',
        'receipt_paper_width' => '80mm',
    ])->assertOk();

    expect(ActivityLog::where('model_type', 'Store')->where('action', 'update')->count())->toBe(0);
});

/* ---------------- Credential recovery audit ---------------- */

test('successful credential recovery is audited without exposing secrets', function () {
    setupPos();

    $this->post('/recover/verify', ['answers' => ['Bantay', 'Cebu City', 'Blue']]);
    $this->post('/recover/reset', ['auth_type' => 'pin4', 'credential' => '3691', 'credential_confirmation' => '3691']);

    $log = ActivityLog::where('action', 'credential_recovered')->sole();
    expect($log->description)->toBe('Admin sign-in reset through account recovery')
        ->and($log->new_values['auth_type'])->toBe('pin4');

    $keys = strtolower(implode(',', array_merge(
        array_keys($log->old_values ?? []),
        array_keys($log->new_values ?? [])
    )));
    expect($keys)->not->toContain('password', 'pin', 'answer', 'token', 'secret', 'credential');

    $raw = strtolower(json_encode([$log->description, $log->old_values, $log->new_values]));
    expect($raw)->not->toContain('3691', '2580', 'bantay', 'cebu', 'blue')
        ->and(ActivityLog::where('action', 'credential_recovered')->count())->toBe(1);
});
