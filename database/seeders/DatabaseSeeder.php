<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Standalone install: the store and the Admin account are created by the
     * First-Time Setup screen, so the default seeder intentionally creates nothing.
     *
     * Full demo store (replaces ALL store data: users, products, sales, shifts, logs;
     * the license is kept). Includes Multiple UOM products, 14 days of shifts and sales:
     *   php artisan db:seed --class=DemoSeeder        (login PIN 1234)
     *
     * Remove only sales and shifts (keeps products, stock and users):
     *   php artisan db:seed --class=ClearTransactionsAndShiftsSeeder
     */
    public function run(): void
    {
        $this->command->info('Nothing to seed. Open the POS to run First-Time Setup.');
    }
}
