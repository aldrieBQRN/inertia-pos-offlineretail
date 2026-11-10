<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('selling_method', 20)->default('standard')->after('sku');
            $table->string('base_unit', 50)->nullable()->after('selling_method');
        });

        Schema::table('products', function (Blueprint $table) {
            // Quantities become decimal so base-unit stock can hold fractional values.
            $table->decimal('stock_quantity', 20, 8)->default(0)->change();

            // Multiple-UOM products keep their selling prices on product_units only.
            $table->integer('price')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Reverting can truncate fractional stock values.
            $table->integer('stock_quantity')->default(0)->change();
            $table->integer('price')->nullable(false)->change();
            $table->dropColumn(['selling_method', 'base_unit']);
        });
    }
};
