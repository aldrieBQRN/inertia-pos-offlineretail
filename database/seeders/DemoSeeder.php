<?php

namespace Database\Seeders;

use App\Support\Quantity;
use Carbon\Carbon;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

/**
 * DemoSeeder — a complete, realistic demo store.
 *
 *  - Store, Admin + Cashier (PIN 1234), terminal
 *  - Standard products and Multiple UOM products (selling units, quantity decimals)
 *  - 14 days of closed shifts (starting cash, cash in, expenses, safe drops, over/short)
 *    plus an open shift today, each with POS sales in different selling units
 *  - Two voided sales (stock returned and logged)
 *  - Product creation / restock / void-return stock logs so every product's
 *    stock movement ledger adds up to its current stock
 *
 * WARNING: wipes stores, users, products, sales, shifts and activity logs first.
 * The license activation is kept.
 *
 * Usage: php artisan db:seed --class=DemoSeeder
 */
class DemoSeeder extends Seeder
{
    private const DAYS = 14;
    private const OPENING_CASH = 2000.00; // pesos

    private int $storeId;
    private int $terminalId;
    private array $users = [];          // ['admin' => id, 'cashier' => id]
    private array $products = [];       // id => spec (incl. units with ids)
    private array $stock = [];          // id => running base stock (string, exact)
    private array $invoiceSeq = [];     // Ymd => last sequence

    public function run(): void
    {
        // Ask only in an interactive console; --force (CLI or the web migration runner) is the confirmation
        if (app()->environment('production')
            && ! $this->command?->option('force')
            && ! $this->command?->confirm('This wipes ALL store data (products, sales, shifts, users). Continue?', false)) {
            $this->command?->warn('Aborted. Nothing was changed.');
            return;
        }

        mt_srand(20261110); // same demo on every run
        $this->command?->info('🌱 Seeding demo store...');

        $this->wipe();
        $now = Carbon::now();
        $start = $now->copy()->startOfDay()->subDays(self::DAYS);

        $this->seedStoreUsersTerminal($start);
        $catIds = $this->seedCategories($start);
        $this->seedProducts($catIds, $start);

        // Build every event first, then derive starting stock so the history reconciles
        [$shifts, $restocks] = $this->planHistory($start, $now);
        $this->applyStartingStock($shifts, $restocks);
        $this->writeProductCreationLogs($start->copy()->subHour());
        $this->writeHistory($shifts, $restocks);
        $this->writeFinalStock();

        $this->summary($shifts);
    }

    // ------------------------------------------------------------------
    // Base data
    // ------------------------------------------------------------------

    private function wipe(): void
    {
        Schema::disableForeignKeyConstraints();
        try {
            foreach ([
                'sale_items', 'sales', 'held_orders', 'cash_movements', 'shifts',
                'product_units', 'products', 'categories', 'users', 'stores', 'activity_logs', 'terminals',
            ] as $table) {
                if (Schema::hasTable($table)) {
                    DB::table($table)->truncate();
                }
            }
        } finally {
            Schema::enableForeignKeyConstraints();
        }
    }

    private function seedStoreUsersTerminal(Carbon $at): void
    {
        $this->storeId = DB::table('stores')->insertGetId([
            'name' => 'Demo Retail Store',
            'address' => '123 Sample Street, Demo City',
            'phone' => '+63 912 345 6789',
            'status' => true,
            'created_at' => $at,
            'updated_at' => $at,
        ]);

        foreach ([
            'admin' => ['Admin User', 'admin@demo.com', 'admin', true, '10000001'],
            'cashier' => ['Jane Cashier', 'cashier@demo.com', 'cashier', false, '10000002'],
        ] as $key => [$name, $email, $role, $isAdmin, $account]) {
            $this->users[$key] = DB::table('users')->insertGetId([
                'name' => $name,
                'email' => $email,
                'password' => Hash::make('1234'),
                'auth_type' => 'pin4',
                'role' => $role,
                'is_admin' => $isAdmin,
                'store_id' => $this->storeId,
                'account_number' => $account,
                'is_active' => true,
                'terms_accepted_at' => $at,
                'created_at' => $at,
                'updated_at' => $at,
            ]);
        }

        $this->terminalId = DB::table('terminals')->insertGetId([
            'store_id' => $this->storeId,
            'name' => 'Main Terminal',
            'code' => 'T1',
            'is_active' => true,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function seedCategories(Carbon $at): array
    {
        $categories = [
            'Fresh Produce' => '#22c55e', 'Meat & Seafood' => '#ef4444', 'Dairy & Eggs' => '#f59e0b',
            'Beverages' => '#3b82f6', 'Snacks & Sweets' => '#a855f7', 'Household' => '#6b7280',
            'Rice & Grains' => '#d97706', 'Hardware' => '#475569', 'Electrical' => '#0ea5e9',
        ];
        $ids = [];
        foreach ($categories as $name => $color) {
            $ids[$name] = DB::table('categories')->insertGetId([
                'store_id' => $this->storeId, 'name' => $name, 'color' => $color,
                'created_at' => $at, 'updated_at' => $at,
            ]);
        }

        return $ids;
    }

    /**
     * Prices in pesos here; stored in centavos. `target` = stock left after the demo history.
     * Multiple UOM: cost is per base unit; each unit lists typical quantities a cashier rings up.
     */
    private function catalog(): array
    {
        $std = fn ($sku, $name, $cat, $price, $wholesale, $cost, $target) => compact('sku', 'name', 'cat', 'price', 'wholesale', 'cost', 'target') + ['multi' => false];
        $multi = fn ($sku, $name, $cat, $base, $cost, $target, $units, $decimals = null) => compact('sku', 'name', 'cat', 'base', 'cost', 'target', 'units', 'decimals') + ['multi' => true];
        // unit: [name, factor, retail, wholesale, default?, typical quantities]
        return [
            $std('PROD-001', 'Red Apple', 'Fresh Produce', 35, 32, 20, 60),
            $std('PROD-002', 'Banana (Bunch)', 'Fresh Produce', 65, 60, 45, 40),
            $std('PROD-003', 'Carrots (500g)', 'Fresh Produce', 45, 42, 30, 8),           // low stock
            $std('MEAT-001', 'Chicken Breast (1kg pack)', 'Meat & Seafood', 285, 270, 210, 25),
            $std('MEAT-002', 'Pork Liempo (1kg pack)', 'Meat & Seafood', 380, 360, 300, 0), // out of stock
            $std('DAIR-001', 'Fresh Milk (1L)', 'Dairy & Eggs', 120, 112, 85, 36),
            $std('DAIR-002', 'Cheese Slice (10s)', 'Dairy & Eggs', 98, 92, 70, 30),
            $std('BEV-001', 'Coca-Cola (1.5L)', 'Beverages', 75, 70, 55, 96),
            $std('BEV-002', 'Mineral Water (500ml)', 'Beverages', 20, 18, 11, 150),
            $std('BEV-003', 'Iced Coffee Can', 'Beverages', 45, 42, 30, 6),                 // low stock
            $std('SNAK-001', 'Potato Chips (Large)', 'Snacks & Sweets', 65, 60, 42, 55),
            $std('SNAK-002', 'Chocolate Bar', 'Snacks & Sweets', 45, 42, 30, 80),
            $std('HOUS-001', 'Dishwashing Liquid', 'Household', 95, 88, 62, 40),
            $std('HOUS-002', 'Bath Soap', 'Household', 48, 45, 32, 70),

            $multi('UOM-WIRE-14', 'Electrical Wire #14', 'Electrical', 'Meter', 9, 412.5, [
                ['Meter', 1, 15, 13, true, [1, 2, 2.5, 3, 5, 10]],
                ['Feet', 0.3048, 5, 4.5, false, [5, 10, 15, 20, 25]],
                ['Roll (75m)', 75, 1050, 980, false, [1]],
            ]),
            $multi('UOM-ROPE-10', 'Nylon Rope 10mm', 'Hardware', 'Meter', 6, 287, [
                ['Meter', 1, 12, 10, true, [1, 2, 3, 5, 7.5]],
                ['Roll (100m)', 100, 1100, 1000, false, [1]],
            ]),
            $multi('UOM-NAIL-2', 'Common Nails 2"', 'Hardware', 'Piece', 0.8, 4650, [
                ['Piece', 1, 2, 1.5, false, [10, 20, 50, 100]],
                ['Kilo', 150, 180, 165, true, [0.5, 1, 1.5, 2]],
                ['Box (25kg)', 3750, 4300, 4000, false, [1]],
            ], 1), // sold in half-kilos -> 1 decimal (base unit Piece would default to 0)
            $multi('UOM-RICE-DIN', 'Dinorado Rice', 'Rice & Grains', 'Kilo', 48, 186.5, [
                ['Kilo', 1, 58, 55, true, [1, 1.5, 2, 3, 5]],
                ['Half Kilo', 0.5, 30, 28, false, [1, 2]],
                ['Sack (25kg)', 25, 1400, 1350, false, [1]],
            ]),
            $multi('UOM-EGG-L', 'Eggs (Large)', 'Dairy & Eggs', 'Piece', 7.5, 18, [
                ['Piece', 1, 9, 8.5, true, [1, 2, 6, 10]],
                ['Dozen', 12, 105, 100, false, [1, 2]],
                ['Tray (30)', 30, 255, 245, false, [1]],
            ]), // low stock
            $multi('UOM-THIN', 'Paint Thinner', 'Hardware', 'Liter', 70, 22.43, [
                ['Liter', 1, 95, 88, true, [0.5, 1, 2]],
                ['Gallon', 3.785, 340, 320, false, [1]],
            ]),
            $multi('UOM-SUGAR', 'Refined Sugar', 'Rice & Grains', 'Kilo', 70, 63.75, [
                ['Kilo', 1, 85, 80, true, [0.5, 1, 2]],
                ['Quarter Kilo', 0.25, 22, 21, false, [1, 2]],
            ]),
        ];
    }

    private function seedProducts(array $catIds, Carbon $at): void
    {
        foreach ($this->catalog() as $spec) {
            $id = DB::table('products')->insertGetId([
                'store_id' => $this->storeId,
                'category_id' => $catIds[$spec['cat']],
                'name' => $spec['name'],
                'sku' => $spec['sku'],
                'selling_method' => $spec['multi'] ? 'multiple' : 'standard',
                'base_unit' => $spec['multi'] ? $spec['base'] : null,
                'quantity_decimals' => $spec['multi'] ? $spec['decimals'] : null,
                'price' => $spec['multi'] ? null : $this->cents($spec['price']),
                'wholesale_price' => $spec['multi'] ? null : $this->cents($spec['wholesale']),
                'cost_price' => $this->cents($spec['cost']),
                'stock_quantity' => 0, // set after the history is planned
                'low_stock_threshold' => 10,
                'is_active' => true,
                'created_at' => $at,
                'updated_at' => $at,
            ]);

            $spec['id'] = $id;
            $spec['category'] = $spec['cat'];
            if ($spec['multi']) {
                $sort = 1;
                foreach ($spec['units'] as $i => [$name, $factor, $retail, $wholesale, $isDefault, $qtys]) {
                    $unitId = DB::table('product_units')->insertGetId([
                        'product_id' => $id,
                        'store_id' => $this->storeId,
                        'name' => $name,
                        'conversion_factor' => Quantity::normalize($factor),
                        'price' => $this->cents($retail),
                        'wholesale_price' => $this->cents($wholesale),
                        'is_default' => $isDefault,
                        'sort_order' => $sort++,
                        'created_at' => $at,
                        'updated_at' => $at,
                    ]);
                    $spec['units'][$i] = compact('unitId', 'name', 'factor', 'retail', 'wholesale', 'isDefault', 'qtys');
                }
            }
            $this->products[$id] = $spec;
        }
    }

    // ------------------------------------------------------------------
    // History planning (shifts, sales, voids, restocks)
    // ------------------------------------------------------------------

    private function planHistory(Carbon $start, Carbon $now): array
    {
        $shifts = [];
        $productIds = array_keys($this->products);
        $multiIds = array_values(array_filter($productIds, fn ($id) => $this->products[$id]['multi']));

        for ($d = 0; $d <= self::DAYS; $d++) {
            $isToday = $d === self::DAYS;
            $day = $start->copy()->addDays($d);
            $cashierKey = $isToday ? 'admin' : ($d % 2 === 0 ? 'cashier' : 'admin');

            $open = $isToday ? $now->copy()->subHours(2)->max($day->copy()) : $day->copy()->setTime(8, 0);
            $close = $isToday ? null : $day->copy()->setTime(20, 0);
            $salesUntil = $isToday ? $now->copy()->subMinutes(5) : $day->copy()->setTime(19, 30);

            $saleCount = $isToday ? 3 : mt_rand(8, $day->isWeekend() ? 16 : 12);
            $times = [];
            $firstSale = $open->copy()->addMinutes(20);
            $span = max(60, (int) abs($firstSale->diffInSeconds($salesUntil)));
            for ($i = 0; $i < $saleCount; $i++) {
                $times[] = $firstSale->copy()->addSeconds(mt_rand(0, $span));
            }
            sort($times);

            $sales = [];
            foreach ($times as $at) {
                $lines = [];
                $lineCount = mt_rand(1, 4);
                for ($l = 0; $l < $lineCount; $l++) {
                    // Multiple UOM products appear in ~40% of lines
                    $pid = (mt_rand(1, 10) <= 4) ? $multiIds[array_rand($multiIds)] : $productIds[array_rand($productIds)];
                    $lines[] = $this->planLine($pid);
                }
                $roll = mt_rand(1, 100);
                $sales[] = [
                    'at' => $at,
                    'method' => $roll <= 60 ? 'cash' : ($roll <= 85 ? 'gcash' : 'maya'),
                    'lines' => $this->mergeLines($lines),
                    'void_at' => null,
                ];
            }

            $shifts[] = [
                'day' => $day, 'user' => $this->users[$cashierKey], 'open' => $open, 'close' => $close,
                'sales' => $sales,
                'cash_in' => (!$isToday && $d % 3 === 0) ? [$day->copy()->setTime(9, 15), 500.00, 'Added 20, 50, 100 Small Bills'] : null,
                'expense' => (!$isToday && $d % 4 === 1) ? [$day->copy()->setTime(13, 40), (float) (mt_rand(15, 35) * 10), 'Bought cleaning supplies'] : null,
                'variance' => $isToday ? 0.0 : [0, 0, 0, -20, 10, -5, 0, 0, 5][mt_rand(0, 8)],
            ];
        }

        // Two voided sales on past days (voided 10 minutes later)
        foreach ([3, 9] as $d) {
            if (!empty($shifts[$d]['sales'])) {
                $i = intdiv(count($shifts[$d]['sales']), 2);
                $shifts[$d]['sales'][$i]['void_at'] = $shifts[$d]['sales'][$i]['at']->copy()->addMinutes(10);
            }
        }

        // Restocks (admin receives deliveries in a selling unit)
        $restocks = [];
        foreach ([[5, 'UOM-WIRE-14', 'Roll (75m)', 2], [6, 'BEV-001', null, 48], [9, 'UOM-RICE-DIN', 'Sack (25kg)', 4], [10, 'DAIR-001', null, 24]] as [$d, $sku, $unitName, $qty]) {
            $pid = $this->idBySku($sku);
            $factor = $unitName ? $this->unitByName($pid, $unitName)['factor'] : 1;
            $restocks[] = [
                'at' => $start->copy()->addDays($d)->setTime(7, 30),
                'product_id' => $pid,
                'unit_name' => $unitName,
                'qty' => $qty,
                'base' => Quantity::multiply($qty, $factor),
            ];
        }

        return [$shifts, $restocks];
    }

    private function planLine(int $pid): array
    {
        $p = $this->products[$pid];
        if (!$p['multi']) {
            return ['product_id' => $pid, 'unit' => null, 'qty' => mt_rand(1, 3)];
        }
        // Default unit most of the time, otherwise another unit
        $units = $p['units'];
        $default = collect($units)->firstWhere('isDefault', true);
        $unit = mt_rand(1, 10) <= 6 ? $default : $units[array_rand($units)];

        return ['product_id' => $pid, 'unit' => $unit, 'qty' => $unit['qtys'][array_rand($unit['qtys'])]];
    }

    /** Same product + unit twice in one sale becomes one line. */
    private function mergeLines(array $lines): array
    {
        $merged = [];
        foreach ($lines as $line) {
            $key = $line['product_id'] . ':' . ($line['unit']['unitId'] ?? 'base');
            if (isset($merged[$key])) {
                $merged[$key]['qty'] = Quantity::toNumber(Quantity::add($merged[$key]['qty'], $line['qty']));
            } else {
                $merged[$key] = $line;
            }
        }

        return array_values($merged);
    }

    /** Starting stock = target + net consumption, raised if the running stock would dip below zero. */
    private function applyStartingStock(array $shifts, array $restocks): void
    {
        $events = $this->chronologicalEvents($shifts, $restocks);
        foreach ($this->products as $id => $p) {
            $running = '0';
            $lowest = '0';
            foreach ($events as $e) {
                foreach ($e['deltas'] as [$pid, $delta]) {
                    if ($pid !== $id) continue;
                    $running = Quantity::add($running, $delta);
                    if (Quantity::compare($running, $lowest) < 0) $lowest = $running;
                }
            }
            // initial + running = target, and initial + lowest >= 0
            $initial = Quantity::subtract($p['target'], $running);
            if (Quantity::compare(Quantity::add($initial, $lowest), '0') < 0) {
                $initial = Quantity::subtract('0', $lowest);
            }
            $this->stock[$id] = Quantity::normalize($initial);
            $this->products[$id]['initial'] = $this->stock[$id];
        }
    }

    /** Flat, time-ordered list of stock deltas (sales -, voids +, restocks +). */
    private function chronologicalEvents(array $shifts, array $restocks): array
    {
        $events = [];
        foreach ($shifts as $shift) {
            foreach ($shift['sales'] as $sale) {
                $deltas = array_map(fn ($l) => [$l['product_id'], Quantity::subtract('0', $this->baseQty($l))], $sale['lines']);
                $events[] = ['at' => $sale['at'], 'deltas' => $deltas];
                if ($sale['void_at']) {
                    $events[] = ['at' => $sale['void_at'], 'deltas' => array_map(fn ($l) => [$l['product_id'], $this->baseQty($l)], $sale['lines'])];
                }
            }
        }
        foreach ($restocks as $r) {
            $events[] = ['at' => $r['at'], 'deltas' => [[$r['product_id'], $r['base']]]];
        }
        usort($events, fn ($a, $b) => $a['at'] <=> $b['at']);

        return $events;
    }

    // ------------------------------------------------------------------
    // Writing history
    // ------------------------------------------------------------------

    private function writeProductCreationLogs(Carbon $at): void
    {
        foreach ($this->products as $id => $p) {
            $this->log('create', 'Product', $id, "Created product: {$p['name']} (SKU: {$p['sku']})", null, [
                'name' => $p['name'],
                'sku' => $p['sku'],
                'category' => $p['category'],
                'selling_method' => $p['multi'] ? 'Multiple UOM' : 'Standard',
                'base_unit' => $p['multi'] ? $p['base'] : null,
                'price' => $p['multi'] ? null : $p['price'],
                'wholesale_price' => $p['multi'] ? null : $p['wholesale'],
                'cost_price' => $p['cost'],
                'stock_quantity' => Quantity::toNumber($p['initial']),
                'units' => $p['multi'] ? array_map(fn ($u) => sprintf(
                    '%s = %s %s @ ₱%s (WS ₱%s)%s',
                    $u['name'], Quantity::format($u['factor']), $p['base'],
                    number_format($u['retail'], 2), number_format($u['wholesale'], 2),
                    $u['isDefault'] ? ' [default]' : ''
                ), $p['units']) : null,
                'is_active' => true,
                'store_id' => $this->storeId,
            ], $this->users['admin'], $at);
        }
    }

    private function writeHistory(array $shifts, array $restocks): void
    {
        $restockQueue = collect($restocks)->sortBy('at')->values()->all();
        $drawer = self::OPENING_CASH;

        foreach ($shifts as $shift) {
            // Deliveries received before this shift opens
            while (!empty($restockQueue) && $restockQueue[0]['at'] <= $shift['open']) {
                $this->writeRestock(array_shift($restockQueue));
            }

            $startingCash = $drawer;
            $shiftId = DB::table('shifts')->insertGetId([
                'store_id' => $this->storeId,
                'user_id' => $shift['user'],
                'terminal_id' => $this->terminalId,
                'start_time' => $shift['open'],
                'end_time' => null,
                'expected_opening_cash' => $startingCash,
                'starting_cash' => $startingCash,
                'opening_discrepancy' => 0,
                'status' => 'open',
                'created_at' => $shift['open'],
                'updated_at' => $shift['open'],
            ]);
            $this->log('shift_open', 'Shift', $shiftId, "Opened shift #{$shiftId} with starting cash ₱" . number_format($startingCash, 2),
                null, ['starting_cash' => $startingCash, 'store_id' => $this->storeId], $shift['user'], $shift['open']);

            $cashSales = 0; // centavos
            foreach ($shift['sales'] as $sale) {
                $cashSales += $this->writeSale($sale, $shift['user']);
            }

            $cashIn = 0.0;
            $cashOut = 0.0;
            if ($shift['cash_in']) {
                [$at, $amount, $reason] = $shift['cash_in'];
                $this->writeMovement($shiftId, $shift['user'], 'cash_in', $amount, $reason, $at);
                $cashIn += $amount;
            }
            if ($shift['expense']) {
                [$at, $amount, $reason] = $shift['expense'];
                $this->writeMovement($shiftId, $shift['user'], 'expense', $amount, $reason, $at);
                $cashOut += $amount;
            }

            if ($shift['close'] === null) {
                continue; // today's shift stays open
            }

            // Safe drop before closing: leave about the usual starting cash in the drawer
            $beforeDrop = $startingCash + $cashSales / 100 + $cashIn - $cashOut;
            $drop = floor(max(0, $beforeDrop - self::OPENING_CASH) / 100) * 100;
            if ($drop > 0) {
                $this->writeMovement($shiftId, $shift['user'], 'safe_drop', $drop, 'End-of-Day Register Sweep to Safe', $shift['close']->copy()->subMinutes(10));
                $cashOut += $drop;
            }

            $expected = round($startingCash + $cashSales / 100 + $cashIn - $cashOut, 2);
            $actual = round($expected + $shift['variance'], 2);

            DB::table('shifts')->where('id', $shiftId)->update([
                'end_time' => $shift['close'],
                'cash_sales' => $cashSales / 100,
                'cash_in' => $cashIn,
                'cash_out' => $cashOut,
                'expenses' => 0,
                'expected_cash' => $expected,
                'actual_cash' => $actual,
                'difference' => round($actual - $expected, 2),
                'closing_notes' => $shift['variance'] < 0 ? 'Short, recounted twice' : null,
                'status' => 'closed',
                'updated_at' => $shift['close'],
            ]);
            $this->log('shift_close', 'Shift', $shiftId, "Closed shift #{$shiftId}: expected ₱" . number_format($expected, 2) . ', counted ₱' . number_format($actual, 2),
                null, ['expected_cash' => $expected, 'actual_cash' => $actual, 'difference' => round($actual - $expected, 2), 'store_id' => $this->storeId], $shift['user'], $shift['close']);

            $drawer = $actual; // next shift starts with what was counted
        }

        foreach ($restockQueue as $r) {
            $this->writeRestock($r);
        }
    }

    /** Inserts one sale (and its void, if any). Returns the cash collected in centavos. */
    private function writeSale(array $sale, int $userId): int
    {
        $at = $sale['at'];
        $ymd = $at->format('Ymd');
        $this->invoiceSeq[$ymd] = ($this->invoiceSeq[$ymd] ?? 0) + 1;
        $invoice = 'INV-' . str_pad($this->storeId, 3, '0', STR_PAD_LEFT) . "-{$ymd}-" . str_pad($this->invoiceSeq[$ymd], 4, '0', STR_PAD_LEFT);

        $items = [];
        $total = 0;
        foreach ($sale['lines'] as $line) {
            $p = $this->products[$line['product_id']];
            $unit = $line['unit'];
            $unitPrice = $unit ? $this->cents($unit['retail']) : $this->cents($p['price']);
            $subtotal = Quantity::toInt(Quantity::multiply($unitPrice, $line['qty']));
            $base = $this->baseQty($line);
            $total += $subtotal;

            $items[] = [
                'store_id' => $this->storeId,
                'product_id' => $line['product_id'],
                'product_unit_id' => $unit['unitId'] ?? null,
                'custom_name' => $p['name'],
                'unit_name' => $unit['name'] ?? null,
                'conversion_factor' => Quantity::normalize($unit['factor'] ?? 1),
                'base_quantity' => $base,
                'quantity' => Quantity::normalize($line['qty']),
                'unit_price' => $unitPrice,
                'cost_price_snapshot' => $this->cents($p['cost']),
                'subtotal' => $subtotal,
                'created_at' => $at,
                'updated_at' => $at,
            ];
            $this->stock[$line['product_id']] = Quantity::subtract($this->stock[$line['product_id']], $base);
        }

        $isCash = $sale['method'] === 'cash';
        $cashGiven = $isCash ? (int) (ceil($total / 10000) * 10000) : null; // next ₱100
        $saleId = DB::table('sales')->insertGetId([
            'store_id' => $this->storeId,
            'terminal_id' => $this->terminalId,
            'invoice_number' => $invoice,
            'cashier_id' => $userId,
            'total_amount' => $total,
            'discount_amount' => 0,
            'payment_method' => $sale['method'],
            'payment_reference' => $isCash ? null : strtoupper(substr($sale['method'], 0, 2)) . '-' . mt_rand(10000000, 99999999),
            'cash_given' => $cashGiven,
            'change' => $isCash ? $cashGiven - $total : 0,
            'is_senior' => false,
            'status' => 'completed',
            'transaction_date' => $at,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
        foreach ($items as &$item) {
            $item['sale_id'] = $saleId;
        }
        unset($item);
        DB::table('sale_items')->insert($items);

        $this->log('create', 'Sale', $saleId, "Completed checkout sale {$invoice} for ₱" . number_format($total / 100, 2), null, [
            'invoice_number' => $invoice, 'total_amount' => $total / 100, 'payment_method' => $sale['method'],
            'items_count' => count($items), 'store_id' => $this->storeId,
        ], $userId, $at);

        if (!$sale['void_at']) {
            return $isCash ? $total : 0;
        }

        // Void: stock goes back (logged per item) and the sale no longer counts
        DB::table('sales')->where('id', $saleId)->update(['status' => 'void', 'updated_at' => $sale['void_at']]);
        foreach ($sale['lines'] as $line) {
            $p = $this->products[$line['product_id']];
            $base = $this->baseQty($line);
            $old = $this->stock[$line['product_id']];
            $new = Quantity::add($old, $base);
            $this->stock[$line['product_id']] = $new;
            $unitLabel = $p['multi'] ? " {$p['base']}" : '';
            $qtyText = $line['unit']
                ? Quantity::format($line['qty']) . " {$line['unit']['name']}" . (Quantity::compare($base, $line['qty']) !== 0 || $line['unit']['name'] !== $p['base'] ? ' (' . Quantity::format($base) . " {$p['base']})" : '')
                : Quantity::format($line['qty']) . ' unit(s)';
            $this->log('stock_void_return', 'Product', $line['product_id'],
                "Sale voided ({$invoice}): returned {$qtyText} of {$p['name']} (Stock: " . Quantity::format($old) . ' → ' . Quantity::format($new) . "{$unitLabel})",
                ['stock_quantity' => Quantity::toNumber($old), 'quantity_added' => 0],
                array_filter([
                    'stock_quantity' => Quantity::toNumber($new), 'quantity_added' => Quantity::toNumber($base),
                    'quantity_change' => Quantity::toNumber($base), 'unit' => $p['multi'] ? $p['base'] : null,
                    'invoice_number' => $invoice, 'store_id' => $this->storeId,
                ], fn ($v) => $v !== null),
                $this->users['admin'], $sale['void_at']);
        }
        $this->log('sale_voided', 'Sale', $saleId, "Voided transaction {$invoice}", ['status' => 'completed'], [
            'status' => 'void', 'invoice_number' => $invoice, 'total_amount' => $total, 'payment_method' => $sale['method'],
            'cashier_id' => $userId, 'store_id' => $this->storeId,
        ], $this->users['admin'], $sale['void_at']);

        return 0;
    }

    private function writeRestock(array $r): void
    {
        $p = $this->products[$r['product_id']];
        $old = $this->stock[$r['product_id']];
        $new = Quantity::add($old, $r['base']);
        $this->stock[$r['product_id']] = $new;

        if ($p['multi']) {
            $description = "Received {$r['qty']} {$r['unit_name']} (+" . Quantity::format($r['base']) . " {$p['base']}) for: {$p['name']} (Stock: "
                . Quantity::format($old) . ' → ' . Quantity::format($new) . " {$p['base']})";
        } else {
            $description = "Restocked {$r['qty']} unit(s) for: {$p['name']} (Stock: " . Quantity::format($old) . ' → ' . Quantity::format($new) . ')';
        }

        $this->log('stock_adjust', 'Product', $r['product_id'], $description,
            ['stock_quantity' => Quantity::toNumber($old), 'quantity_added' => 0],
            array_filter([
                'stock_quantity' => Quantity::toNumber($new), 'quantity_added' => Quantity::toNumber($r['base']),
                'quantity_change' => Quantity::toNumber($r['base']), 'unit' => $p['multi'] ? $p['base'] : null,
                'store_id' => $this->storeId,
            ], fn ($v) => $v !== null),
            $this->users['admin'], $r['at']);
    }

    private function writeMovement(int $shiftId, int $userId, string $type, float $amount, string $reason, Carbon $at): void
    {
        $id = DB::table('cash_movements')->insertGetId([
            'store_id' => $this->storeId, 'user_id' => $userId, 'shift_id' => $shiftId, 'terminal_id' => $this->terminalId,
            'type' => $type, 'amount' => $amount, 'reason' => $reason, 'created_at' => $at, 'updated_at' => $at,
        ]);
        $label = ['cash_in' => 'Cash In', 'expense' => 'Expense', 'safe_drop' => 'Safe Drop'][$type] ?? $type;
        $this->log('cash_movement.create', 'CashMovement', $id, "{$label} of ₱" . number_format($amount, 2) . ": {$reason}", null, [
            'type' => $type, 'amount' => $amount, 'reason' => $reason, 'shift_id' => $shiftId, 'store_id' => $this->storeId,
        ], $userId, $at);
    }

    private function writeFinalStock(): void
    {
        foreach ($this->stock as $id => $qty) {
            DB::table('products')->where('id', $id)->update(['stock_quantity' => Quantity::normalize($qty)]);
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private function log(string $action, string $model, ?int $modelId, string $description, ?array $old, ?array $new, int $userId, Carbon $at): void
    {
        DB::table('activity_logs')->insert([
            'user_id' => $userId,
            'store_id' => $this->storeId,
            'action' => $action,
            'model_type' => $model,
            'model_id' => $modelId,
            'description' => $description,
            'old_values' => $old ? json_encode($old) : null,
            'new_values' => $new ? json_encode(array_filter($new, fn ($v) => $v !== null)) : null,
            'ip_address' => '127.0.0.1',
            'user_agent' => 'DemoSeeder',
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function baseQty(array $line): string
    {
        return Quantity::multiply($line['qty'], $line['unit']['factor'] ?? 1);
    }

    private function cents($pesos): int
    {
        return Quantity::toInt(Quantity::multiply($pesos, '100'));
    }

    private function idBySku(string $sku): int
    {
        foreach ($this->products as $id => $p) {
            if ($p['sku'] === $sku) return $id;
        }
        throw new \RuntimeException("Unknown demo SKU {$sku}");
    }

    private function unitByName(int $pid, string $name): array
    {
        return collect($this->products[$pid]['units'])->firstWhere('name', $name);
    }

    private function summary(array $shifts): void
    {
        $sales = DB::table('sales')->where('store_id', $this->storeId);
        $this->command?->info('  ✓ ' . count($this->products) . ' products (' . collect($this->products)->where('multi', true)->count() . ' Multiple UOM, '
            . DB::table('product_units')->count() . ' selling units)');
        $this->command?->info('  ✓ ' . count($shifts) . ' shifts (' . (count($shifts) - 1) . ' closed, 1 open today), '
            . DB::table('cash_movements')->count() . ' cash movements');
        $this->command?->info('  ✓ ' . (clone $sales)->count() . ' sales (' . (clone $sales)->where('status', 'void')->count() . ' voided), '
            . DB::table('sale_items')->count() . ' items, ₱' . number_format((clone $sales)->where('status', 'completed')->sum('total_amount') / 100, 2) . ' revenue');
        $this->command?->info('');
        $this->command?->info('🎉 Demo store ready. Login PIN: 1234 (Admin User or Jane Cashier).');
    }
}
