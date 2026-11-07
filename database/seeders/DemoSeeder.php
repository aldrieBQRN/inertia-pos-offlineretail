<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;

/**
 * DemoSeeder — Seeds realistic demo data for the InfinityFree live demo.
 */
class DemoSeeder extends Seeder
{
    public function run(): void
    {
        $this->command?->info('🌱 Seeding demo data...');

        Schema::disableForeignKeyConstraints();

        // ── Clean slate ──────────────────────────────────────────────────────
        $tables = [
            'sale_items', 'sales', 'held_orders', 'cash_movements',
            'shifts', 'products', 'categories', 'users', 'stores',
            'settings', 'activity_logs', 'terminals',
        ];
        foreach ($tables as $table) {
            if (Schema::hasTable($table)) {
                DB::table($table)->truncate();
            }
        }

        Schema::enableForeignKeyConstraints();

        $now = Carbon::now();

        // ── 1. Store ─────────────────────────────────────────────────────────
        $storeId = DB::table('stores')->insertGetId([
            'name'       => 'Demo Retail Store',
            'address'    => '123 Sample Street, Demo City',
            'phone'      => '+63 912 345 6789',
            'status'     => true,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->command?->info("  ✓ Store created (ID: {$storeId})");

        // ── 2. Users ─────────────────────────────────────────────────────────
        DB::table('users')->insert([
            [
                'name'             => 'Admin User',
                'email'            => 'admin@demo.com',
                'password'         => Hash::make('demo1234'),
                'auth_type'        => 'password',
                'role'             => 'admin',
                'is_admin'         => true,
                'store_id'         => $storeId,
                'account_number'   => '10000001',
                'is_active'        => true,
                'terms_accepted_at'=> $now,
                'created_at'       => $now,
                'updated_at'       => $now,
            ],
            [
                'name'             => 'Jane Cashier',
                'email'            => 'cashier@demo.com',
                'password'         => Hash::make('demo1234'),
                'auth_type'        => 'password',
                'role'             => 'cashier',
                'is_admin'         => false,
                'store_id'         => $storeId,
                'account_number'   => '10000002',
                'is_active'        => true,
                'terms_accepted_at'=> $now,
                'created_at'       => $now,
                'updated_at'       => $now,
            ],
        ]);

        $this->command?->info("  ✓ Users created (admin + cashier)");

        // ── 3. Categories ────────────────────────────────────────────────────
        $categoryData = [
            ['Fresh Produce', '#22c55e'],
            ['Meat & Seafood', '#ef4444'],
            ['Dairy & Eggs',   '#f59e0b'],
            ['Beverages',      '#3b82f6'],
            ['Snacks & Sweets','#a855f7'],
            ['Household',      '#6b7280'],
        ];

        foreach ($categoryData as [$name, $color]) {
            DB::table('categories')->insert([
                'store_id'   => $storeId,
                'name'       => $name,
                'color'      => $color,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $catIds = DB::table('categories')
            ->where('store_id', $storeId)
            ->pluck('id', 'name');

        $this->command?->info("  ✓ Categories created (" . count($categoryData) . ")");

        // ── 4. Products (price & cost_price stored in cents) ─────────────────
        // [name, category, price_pesos, cost_pesos, stock, sku]
        $products = [
            // Fresh Produce
            ['Red Apple (kg)',       'Fresh Produce',  350,  200,  50, 'PROD-001'],
            ['Banana (Bunch)',       'Fresh Produce',  250,  150,  45, 'PROD-002'],
            ['Carrots (500g)',       'Fresh Produce',  180,   90,  60, 'PROD-003'],
            ['Potatoes (kg)',        'Fresh Produce',  220,  100, 100, 'PROD-004'],
            // Meat & Seafood
            ['Chicken Breast (kg)', 'Meat & Seafood',  850,  600,  30, 'MEAT-001'],
            ['Ground Beef (kg)',    'Meat & Seafood', 1200,  900,  25, 'MEAT-002'],
            ['Pork Liempo (kg)',    'Meat & Seafood',  780,  550,  20, 'MEAT-003'],
            ['Tilapia (kg)',        'Meat & Seafood',  380,  220,  15, 'MEAT-004'],
            // Dairy & Eggs
            ['Fresh Milk (1L)',     'Dairy & Eggs',   120,   80,  40, 'DAIR-001'],
            ['Cheese Slice (10s)', 'Dairy & Eggs',    220,  140,  25, 'DAIR-002'],
            ['Dozen Eggs',         'Dairy & Eggs',    120,   85,  12, 'DAIR-003'],
            ['Butter (Salted)',    'Dairy & Eggs',    280,  200,  18, 'DAIR-004'],
            // Beverages
            ['Orange Juice (1L)',  'Beverages',       120,   75,  40, 'BEV-001'],
            ['Coca-Cola (1.5L)',   'Beverages',        75,   45, 100, 'BEV-002'],
            ['Mineral Water (6s)', 'Beverages',        80,   45, 120, 'BEV-003'],
            ['Iced Coffee Can',    'Beverages',        75,   40,  60, 'BEV-004'],
            // Snacks
            ['Lays Chips (40g)',   'Snacks & Sweets',  45,   28,  80, 'SNAK-001'],
            ['Rebisco Crackers',   'Snacks & Sweets',  18,   10, 150, 'SNAK-002'],
            ['Toblerone (200g)',   'Snacks & Sweets', 350,  220,  30, 'SNAK-003'],
            ['Oreo (137g)',        'Snacks & Sweets',  65,   40,  60, 'SNAK-004'],
            // Household
            ['Tide Powder (1kg)',  'Household',       180,  120,  35, 'HOUS-001'],
            ['Joy Dishwashing',   'Household',        95,   60,  40, 'HOUS-002'],
            ['Safeguard Bar',     'Household',        78,   48,  50, 'HOUS-003'],
            ['Downy Fabric Soft', 'Household',       105,   65,  30, 'HOUS-004'],
        ];

        foreach ($products as [$name, $cat, $price, $cost, $stock, $sku]) {
            DB::table('products')->insert([
                'store_id'            => $storeId,
                'category_id'         => $catIds[$cat],
                'name'                => $name,
                'sku'                 => $sku,
                'price'               => (int) ($price * 100),
                'cost_price'          => (int) ($cost * 100),
                'stock_quantity'      => $stock,
                'low_stock_threshold' => 10,
                'is_active'           => true,
                'created_at'          => $now,
                'updated_at'          => $now,
            ]);
        }

        $this->command?->info("  ✓ Products created (" . count($products) . ")");

        // ── 5. Terminal ──────────────────────────────────────────────────────
        if (Schema::hasTable('terminals')) {
            DB::table('terminals')->insert([
                'store_id'   => $storeId,
                'name'       => 'Main Terminal',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        $this->command?->info('');
        $this->command?->info('🎉 Demo seeding complete!');
        $this->command?->info('');
        $this->command?->info('🔑 Login credentials:');
        $this->command?->info('   Admin   → admin@demo.com   / demo1234');
        $this->command?->info('   Cashier → cashier@demo.com / demo1234');
    }
}
