<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->foreignId('product_unit_id')->nullable()->after('product_id')
                ->constrained('product_units')->nullOnDelete();
            $table->string('unit_name')->nullable()->after('product_unit_id');
            $table->decimal('conversion_factor', 20, 8)->nullable()->after('unit_name');
            $table->decimal('base_quantity', 20, 8)->nullable()->after('quantity');
            // Cost per base unit in cents at the time of sale.
            $table->integer('cost_price_snapshot')->nullable()->after('unit_price');
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('quantity', 20, 8)->change();
        });

        // Existing line items represent standard products sold one-for-one with base stock.
        DB::table('sale_items')->update([
            'base_quantity' => DB::raw('quantity'),
            'conversion_factor' => 1,
        ]);

        // Freeze the best available historical cost for existing rows.
        DB::table('sale_items')
            ->whereNotNull('product_id')
            ->update([
                'cost_price_snapshot' => DB::raw(
                    '(SELECT cost_price FROM products WHERE products.id = sale_items.product_id)'
                ),
            ]);
    }

    public function down(): void
    {
        Schema::table('sale_items', function (Blueprint $table) {
            $table->dropForeign(['product_unit_id']);
            $table->dropColumn([
                'product_unit_id',
                'unit_name',
                'conversion_factor',
                'base_quantity',
                'cost_price_snapshot',
            ]);
        });

        Schema::table('sale_items', function (Blueprint $table) {
            $table->decimal('quantity', 10, 2)->change();
        });
    }
};
