<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use App\Models\Category;
use App\Models\Store;

class ProductSeeder extends Seeder
{
    public function run(): void
    {
        // Get the first store to attach products to
        $store = Store::first();
        if (!$store) {
            $this->command->info('No store found! Run DatabaseSeeder first.');
            return;
        }
        $storeId = $store->id;

        // Helper to get ID (or create if missing, ensuring it belongs to the store)
        $getCatId = function ($name) use ($storeId) {
            return Category::firstOrCreate([
                'name' => $name,
                'store_id' => $storeId
            ])->id;
        };

        DB::table('products')->insert([
            [
                'store_id' => $storeId,
                'name' => 'Espresso Shot',
                'sku'  => 'BEV-001',
                'price' => 250,
                'stock_quantity' => 100,
                'category_id' => $getCatId('Beverages'),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'store_id' => $storeId,
                'name' => 'Blueberry Muffin',
                'sku'  => 'BAK-001',
                'price' => 300,
                'stock_quantity' => 50,
                'category_id' => $getCatId('Bakery'),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'store_id' => $storeId,
                'name' => 'Club Sandwich',
                'sku'  => 'FOD-001',
                'price' => 850,
                'stock_quantity' => 20,
                'category_id' => $getCatId('Food'),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'store_id' => $storeId,
                'name' => 'Vanilla Latte',
                'sku'  => 'BEV-002',
                'price' => 450,
                'stock_quantity' => 75,
                'category_id' => $getCatId('Beverages'),
                'created_at' => now(),
                'updated_at' => now(),
            ]
        ]);

        for ($i = 0; $i < 10; $i++) {
            DB::table('products')->insert([
                'store_id' => $storeId,
                'name' => 'Generic Item ' . $i,
                'sku' => 'GEN-' . rand(1000, 9999),
                'price' => rand(100, 5000),
                'stock_quantity' => rand(10, 100),
                'category_id' => $getCatId('General'),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
