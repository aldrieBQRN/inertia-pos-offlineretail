<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Removes all sales transactions and shift records (all stores), keeping everything else.
 *
 * Deletes:  sale_items, sales, cash_movements, shifts, and the matching activity log
 *           entries (Sales and Cash & Shifts categories).
 * Keeps:    users, stores, products & stock levels, categories, terminals, held orders,
 *           and all other activity logs (logins, product/user changes, etc.).
 *
 * Usage: php artisan db:seed --class=ClearTransactionsAndShiftsSeeder
 */
class ClearTransactionsAndShiftsSeeder extends Seeder
{
    public function run(): void
    {
        // Ask only in an interactive console; --force is the confirmation
        if (app()->environment('production')
            && ! $this->command->option('force')
            && ! $this->command->confirm('This permanently deletes ALL sales and shift records. Continue?', false)) {
            $this->command->warn('Aborted. Nothing was deleted.');
            return;
        }

        $this->command->info('🧹 Clearing transactions and shifts...');

        $counts = [];
        foreach (['sale_items', 'sales', 'cash_movements', 'shifts'] as $table) {
            $counts[$table] = Schema::hasTable($table) ? DB::table($table)->count() : 0;
        }

        $logs = DB::table('activity_logs')
            ->where(function ($q) {
                $q->whereIn('model_type', ['Sale', 'Shift', 'CashMovement'])
                    ->orWhere('action', 'like', 'shift.%')
                    ->orWhere('action', 'like', 'cash_movement.%');
            });
        $counts['activity_logs (sales, shifts, cash movements)'] = (clone $logs)->count();

        // TRUNCATE is DDL in MySQL (auto-commits), so it is not wrapped in a transaction.
        Schema::disableForeignKeyConstraints();
        try {
            foreach (['sale_items', 'sales', 'cash_movements', 'shifts'] as $table) {
                if (Schema::hasTable($table)) {
                    DB::table($table)->truncate();
                }
            }
        } finally {
            Schema::enableForeignKeyConstraints();
        }
        $logs->delete();

        foreach ($counts as $table => $count) {
            $this->command->line("   🗑️  {$table}: {$count} removed");
        }
        $this->command->info('✅ Transactions and shifts cleared. Products, stock, users and stores were not changed.');
    }
}
