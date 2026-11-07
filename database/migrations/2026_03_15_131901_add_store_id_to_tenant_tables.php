<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up()
    {
        // 1. Add store_id to users (Nullable because YOU, the Super Admin, won't have a store)
        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('store_id')->nullable()->constrained('stores')->cascadeOnDelete()->after('id');
        });

        // 2. Add store_id to all other tenant tables
        $tables = ['categories', 'products', 'sales', 'sale_items', 'held_orders', 'shifts'];

        foreach ($tables as $tableName) {
            Schema::table($tableName, function (Blueprint $table) {
                // Made nullable initially to prevent errors if you already have test data in your DB
                $table->foreignId('store_id')->nullable()->constrained('stores')->cascadeOnDelete();
            });
        }
    }

    public function down()
    {
        $tables = ['users', 'categories', 'products', 'sales', 'sale_items', 'held_orders', 'shifts'];

        foreach ($tables as $tableName) {
            Schema::table($tableName, function (Blueprint $table) {
                $table->dropForeign(['store_id']);
                $table->dropColumn('store_id');
            });
        }
    }
};
