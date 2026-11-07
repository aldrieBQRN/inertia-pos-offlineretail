<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    /**
     * Standalone install: the store and the Admin account are created by the
     * First-Time Setup screen, so the default seeder intentionally creates nothing.
     *
     * Optional sample catalog (run after setup):
     *   php artisan db:seed --class=ProductSeeder
     *   php artisan db:seed --class=GrocerySeeder   (replaces the catalog and deletes all sales)
     */
    public function run(): void
    {
        $this->command->info('Nothing to seed. Open the POS to run First-Time Setup.');
    }
}
