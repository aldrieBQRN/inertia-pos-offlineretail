<?php

use App\Models\Category;
use App\Models\Product;

beforeEach(function () {
    setupPos();
    $this->post('/login', ['credential' => '2580']);
});

function feedFromPage(): array
{
    $feed = null;
    test()->withoutVite()->get('/inventory')->assertOk()->assertInertia(function ($page) use (&$feed) {
        $feed = $page->toArray()['props']['initial_recent_activity'];
    });

    return $feed;
}

function feedFromApi(): array
{
    return test()->getJson('/api/inventory/recent-activity')->assertOk()->json('data');
}

test('adding a product shows one "new product" entry, plus the separate category entry', function () {
    $category = $this->postJson('/api/categories', ['name' => 'Test 1'])->assertSuccessful()->json();
    $categoryId = $category['id'] ?? $category['category']['id'] ?? $category['data']['id'];
    $this->postJson('/api/products', [
        'name' => 'Leah Newman', 'category_id' => $categoryId, 'price' => 50, 'cost_price' => 30,
        'wholesale_price' => 45, 'stock_quantity' => 340, 'sku' => 'LEAH-1',
    ])->assertSuccessful();

    foreach (['page' => feedFromPage(), 'api' => feedFromApi()] as $source => $feed) {
        $feed = collect($feed);
        $productEntries = $feed->filter(fn ($e) => str_contains($e['description'], 'Leah Newman'));

        expect($productEntries, $source)->toHaveCount(1)
            ->and($productEntries->first()['description'])->toBe('Created product: Leah Newman (SKU: LEAH-1)')
            ->and($feed->pluck('description'))->not->toContain('Registered new product: Leah Newman (SKU: LEAH-1) with 340 units')
            ->and($feed->where('model_type', 'Category')->pluck('description')->all())->toBe(['Created category: Test 1']);
    }
});

test('products without a creation log (seeded or imported) are still listed once', function () {
    $category = Category::create(['name' => 'Imported']);
    Product::create([
        'name' => 'Legacy Soap', 'category_id' => $category->id, 'price' => 2500, 'cost_price' => 1500,
        'stock_quantity' => 12, 'sku' => 'LEG-1', 'is_active' => true,
    ]);

    foreach ([feedFromPage(), feedFromApi()] as $feed) {
        $entries = collect($feed)->filter(fn ($e) => str_contains($e['description'], 'Legacy Soap'));
        expect($entries)->toHaveCount(1)
            ->and($entries->first()['description'])->toBe('Registered new product: Legacy Soap (SKU: LEG-1) with 12 units');
    }
});
