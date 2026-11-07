<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Carbon\Carbon;

/**
 * DemoSeeder — Seeds realistic demo data for the InfinityFree live demo.
 *
 * Run via web:
 *   https://yourdomain.com/migrate.php?token=TOKEN&action=seed
 *
 * Or locally:
 *   php artisan db:seed --class=DemoSeeder
 *
 * Creates:
 *  - 1 store (Demo Retail Store)
 *  - 2 users: admin + cashier
 *  - 6 categories, 24 products
 *  - 1 completed shift with sample sales
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

        $adminId   = DB::table('users')->where('email', 'admin@demo.com')->value('id');
        $cashierId = DB::table('users')->where('email', 'cashier@demo.com')->value('id');

        $this->command?->info("  ✓ Users created (admin + cashier)");

        // ── 3. Settings ──────────────────────────────────────────────────────
        if (Schema::hasTable('settings')) {
            DB::table('settings')->insert([
                'store_id'   => $storeId,
                'key'        => 'currency',
                'value'      => 'PHP',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // ── 4. Categories ────────────────────────────────────────────────────
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

        // ── 5. Products ──────────────────────────────────────────────────────
        // Format: [name, category, price, cost, stock]
        $products = [
            // Fresh Produce
            ['Red Apple (kg)',       'Fresh Produce',  350,  200,  50],
            ['Banana (Bunch)',       'Fresh Produce',  250,  150,  45],
            ['Carrots (500g)',       'Fresh Produce',  180,   90,  60],
            ['Potatoes (kg)',        'Fresh Produce',  220,  100, 100],
            // Meat & Seafood
            ['Chicken Breast (kg)', 'Meat & Seafood',  850,  600,  30],
            ['Ground Beef (kg)',    'Meat & Seafood', 1200,  900,  25],
            ['Pork Liempo (kg)',    'Meat & Seafood',  780,  550,  20],
            ['Tilapia (kg)',        'Meat & Seafood',  380,  220,  15],
            // Dairy & Eggs
            ['Fresh Milk (1L)',     'Dairy & Eggs',   120,   80,  40],
            ['Cheese Slice (10s)', 'Dairy & Eggs',    220,  140,  25],
            ['Dozen Eggs',         'Dairy & Eggs',    120,   85,  12],
            ['Butter (Salted)',    'Dairy & Eggs',    280,  200,  18],
            // Beverages
            ['Orange Juice (1L)',  'Beverages',       120,   75,  40],
            ['Coca-Cola (1.5L)',   'Beverages',        75,   45, 100],
            ['Mineral Water (6s)', 'Beverages',        80,   45, 120],
            ['Iced Coffee Can',    'Beverages',        75,   40,  60],
            // Snacks
            ['Lays Chips (40g)',   'Snacks & Sweets',  45,   28,  80],
            ['Rebisco Crackers',   'Snacks & Sweets',  18,   10, 150],
            ['Toblerone (200g)',   'Snacks & Sweets', 350,  220,  30],
            ['Oreo (137g)',        'Snacks & Sweets',  65,   40,  60],
            // Household
            ['Tide Powder (1kg)',  'Household',       180,  120,  35],
            ['Joy Dishwashing',   'Household',        95,   60,  40],
            ['Safeguard Bar',     'Household',        78,   48,  50],
            ['Downy Fabric Soft', 'Household',       105,   65,  30],
        ];

        foreach ($products as [$name, $cat, $price, $cost, $stock]) {
            DB::table('products')->insert([
                'store_id'    => $storeId,
                'category_id' => $catIds[$cat],
                'name'        => $name,
                'price'       => $price,
                'cost'        => $cost,
                'stock'       => $stock,
                'is_active'   => true,
                'created_at'  => $now,
                'updated_at'  => $now,
            ]);
        }

        $this->command?->info("  ✓ Products created (" . count($products) . ")");

        // ── 6. Terminal ──────────────────────────────────────────────────────
        $terminalId = null;
        if (Schema::hasTable('terminals')) {
            $terminalId = DB::table('terminals')->insertGetId([
                'store_id'   => $storeId,
                'name'       => 'Main Terminal',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        // ── 7. Sample Shift with Sales ───────────────────────────────────────
        $shiftStart = Carbon::now()->subHours(6);
        $shiftEnd   = Carbon::now()->subHours(1);

        $shiftId = DB::table('shifts')->insertGetId([
            'user_id'         => $cashierId,
            'store_id'        => $storeId,
            'terminal_id'     => $terminalId,
            'status'          => 'closed',
            'opening_cash'    => 5000.00,
            'closing_cash'    => 7342.50,
            'total_sales'     => 2342.50,
            'total_cash'      => 1800.00,
            'total_gcash'     => 342.50,
            'total_card'      => 200.00,
            'start_time'      => $shiftStart,
            'end_time'        => $shiftEnd,
            'created_at'      => $shiftStart,
            'updated_at'      => $shiftEnd,
        ]);

        // Create 5 sample sales
        $sampleSales = [
            [
                'items'       => [['Coca-Cola (1.5L)', 2], ['Lays Chips (40g)', 3]],
                'payment'     => 'cash',
                'total'       => 285.00,
                'paid'        => 300.00,
                'change'      => 15.00,
                'offset_mins' => 300,
            ],
            [
                'items'       => [['Chicken Breast (kg)', 1], ['Fresh Milk (1L)', 2]],
                'payment'     => 'gcash',
                'total'       => 1090.00,
                'paid'        => 1090.00,
                'change'      => 0.00,
                'offset_mins' => 240,
            ],
            [
                'items'       => [['Dozen Eggs', 2], ['Butter (Salted)', 1]],
                'payment'     => 'cash',
                'total'       => 520.00,
                'paid'        => 600.00,
                'change'      => 80.00,
                'offset_mins' => 180,
            ],
            [
                'items'       => [['Toblerone (200g)', 1], ['Oreo (137g)', 2]],
                'payment'     => 'card',
                'total'       => 480.00,
                'paid'        => 480.00,
                'change'      => 0.00,
                'offset_mins' => 120,
            ],
            [
                'items'       => [['Red Apple (kg)', 1], ['Banana (Bunch)', 1], ['Orange Juice (1L)', 2]],
                'payment'     => 'cash',
                'total'       => 840.00,
                'paid'        => 1000.00,
                'change'      => 160.00,
                'offset_mins' => 60,
            ],
        ];

        $productPrices = DB::table('products')
            ->where('store_id', $storeId)
            ->pluck('price', 'name');
        $productIds = DB::table('products')
            ->where('store_id', $storeId)
            ->pluck('id', 'name');

        foreach ($sampleSales as $i => $sale) {
            $saleTime = Carbon::now()->subMinutes($sale['offset_mins']);

            $saleId = DB::table('sales')->insertGetId([
                'store_id'       => $storeId,
                'cashier_id'     => $cashierId,
                'shift_id'       => $shiftId,
                'terminal_id'    => $terminalId,
                'total_amount'   => $sale['total'],
                'amount_paid'    => $sale['paid'],
                'change_amount'  => $sale['change'],
                'payment_method' => $sale['payment'],
                'status'         => 'completed',
                'created_at'     => $saleTime,
                'updated_at'     => $saleTime,
            ]);

            foreach ($sale['items'] as [$productName, $qty]) {
                $pid   = $productIds[$productName] ?? null;
                $price = $productPrices[$productName] ?? 0;
                if (!$pid) continue;

                DB::table('sale_items')->insert([
                    'sale_id'    => $saleId,
                    'product_id' => $pid,
                    'quantity'   => $qty,
                    'price'      => $price,
                    'subtotal'   => $price * $qty,
                    'created_at' => $saleTime,
                    'updated_at' => $saleTime,
                ]);
            }
        }

        $this->command?->info("  ✓ Shift + 5 sample sales created");

        $this->command?->info('');
        $this->command?->info('🎉 Demo seeding complete!');
        $this->command?->info('');
        $this->command?->info('🔑 Login credentials:');
        $this->command?->info('   Admin   → admin@demo.com   / demo1234');
        $this->command?->info('   Cashier → cashier@demo.com / demo1234');
    }
}

