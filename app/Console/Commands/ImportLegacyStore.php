<?php

namespace App\Console\Commands;

use App\Models\Store;
use App\Models\Terminal;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One-time migration of a single store's data from the previous online (MySQL,
 * multi-branch) installation into this standalone SQLite POS.
 *
 * - Copies categories, products, sales, sale items, shifts, cash movements,
 *   held orders and activity logs of ONE legacy store, keeping record ids so
 *   every relationship stays intact.
 * - Every staff member's records are attributed to the local Admin account and
 *   every legacy register is mapped to this device's register.
 *
 * Run it after First-Time Setup, before recording new sales.
 */
class ImportLegacyStore extends Command
{
    protected $signature = 'pos:import-legacy
                            {--store= : Legacy store id to import}
                            {--host=127.0.0.1 : Legacy MySQL host}
                            {--port=3306 : Legacy MySQL port}
                            {--database= : Legacy MySQL database name}
                            {--username=root : Legacy MySQL user}
                            {--password= : Legacy MySQL password}
                            {--force : Import even if the local POS already has products or sales}';

    protected $description = 'Import one store from the previous MySQL installation into this standalone POS';

    /** Tables copied with their original ids, in dependency order. */
    private const TABLES = ['categories', 'products', 'shifts', 'sales', 'sale_items', 'cash_movements', 'held_orders'];

    public function handle(): int
    {
        $admin = User::admin();
        $store = Store::current();

        if (!$admin || !$store) {
            $this->error('Complete First-Time Setup in the POS first, then run this import.');
            return self::FAILURE;
        }

        if (!$this->option('force') && (DB::table('products')->exists() || DB::table('sales')->exists())) {
            $this->error('This POS already has products or sales. Re-run with --force to import anyway (ids must not overlap).');
            return self::FAILURE;
        }

        $database = $this->option('database') ?: $this->ask('Legacy MySQL database name', 'inertiapos_retail');

        config(['database.connections.legacy' => [
            'driver' => 'mysql',
            'host' => $this->option('host'),
            'port' => $this->option('port'),
            'database' => $database,
            'username' => $this->option('username'),
            'password' => $this->option('password') ?? '',
            'charset' => 'utf8mb4',
            'collation' => 'utf8mb4_unicode_ci',
            'prefix' => '',
        ]]);

        try {
            $legacy = DB::connection('legacy');
            $legacy->getPdo();
        } catch (\Throwable $e) {
            $this->error('Could not connect to the legacy MySQL database: ' . $e->getMessage());
            return self::FAILURE;
        }

        $legacyStores = $legacy->table('stores')->orderBy('id')->get(['id', 'name', 'address', 'phone', 'logo_path']);
        if ($legacyStores->isEmpty()) {
            $this->error('The legacy database has no stores.');
            return self::FAILURE;
        }

        $storeId = $this->option('store') ?: $this->choice(
            'Which store should this device run?',
            $legacyStores->mapWithKeys(fn ($s) => [(string) $s->id => "#{$s->id} {$s->name}"])->all()
        );
        $legacyStore = $legacyStores->firstWhere('id', (int) $storeId);
        if (!$legacyStore) {
            $this->error("Legacy store #{$storeId} was not found.");
            return self::FAILURE;
        }

        $terminal = Terminal::query()->orderBy('id')->first()
            ?? Terminal::create(['store_id' => $store->id, 'name' => 'Main Register', 'code' => 'REG-01', 'is_active' => true]);

        $this->info("Importing \"{$legacyStore->name}\" into \"{$store->name}\"...");

        DB::statement('PRAGMA foreign_keys = OFF');

        try {
            DB::transaction(function () use ($legacy, $legacyStore, $store, $admin, $terminal) {
                $counts = [];

                foreach (self::TABLES as $table) {
                    $counts[$table] = $this->copyTable($legacy, $table, (int) $legacyStore->id, $store->id, $admin->id, $terminal->id);
                }

                // Activity log ids are not referenced elsewhere; let SQLite assign new ones
                $counts['activity_logs'] = $this->copyTable($legacy, 'activity_logs', (int) $legacyStore->id, $store->id, $admin->id, $terminal->id, keepIds: false);

                // Keep the store's receipt details
                $store->fill(array_filter([
                    'address' => $store->address ?: $legacyStore->address,
                    'phone' => $store->phone ?: $legacyStore->phone,
                    'logo_path' => $store->logo_path ?: $legacyStore->logo_path,
                ]))->save();

                $this->table(['Table', 'Rows imported'], collect($counts)->map(fn ($n, $t) => [$t, $n])->values()->all());
            });
        } finally {
            DB::statement('PRAGMA foreign_keys = ON');
        }

        $violations = DB::select('PRAGMA foreign_key_check');
        if (!empty($violations)) {
            $this->warn(count($violations) . ' row(s) reference records that were not part of this store (left as-is).');
        }

        $this->info('Import complete. All historical staff activity is now attributed to ' . $admin->name . '.');

        return self::SUCCESS;
    }

    private function copyTable($legacy, string $table, int $legacyStoreId, int $storeId, int $adminId, int $terminalId, bool $keepIds = true): int
    {
        if (!$legacy->getSchemaBuilder()->hasTable($table) || !Schema::hasTable($table)) {
            return 0;
        }

        $localColumns = Schema::getColumnListing($table);
        $legacyColumns = $legacy->getSchemaBuilder()->getColumnListing($table);
        $columns = array_values(array_intersect($legacyColumns, $localColumns));
        if (!$keepIds) {
            $columns = array_values(array_diff($columns, ['id']));
        }

        $imported = 0;

        $legacy->table($table)
            ->where('store_id', $legacyStoreId)
            ->orderBy('id')
            ->select($columns)
            ->chunk(500, function ($rows) use ($table, $storeId, $adminId, $terminalId, &$imported) {
                $batch = $rows->map(function ($row) use ($storeId, $adminId, $terminalId) {
                    $row = (array) $row;
                    $row['store_id'] = $storeId;

                    foreach (['user_id', 'cashier_id'] as $userColumn) {
                        if (array_key_exists($userColumn, $row) && $row[$userColumn] !== null) {
                            $row[$userColumn] = $adminId;
                        }
                    }
                    if (array_key_exists('terminal_id', $row) && $row['terminal_id'] !== null) {
                        $row['terminal_id'] = $terminalId;
                    }

                    return $row;
                })->all();

                DB::table($table)->insert($batch);
                $imported += count($batch);
            });

        return $imported;
    }
}
