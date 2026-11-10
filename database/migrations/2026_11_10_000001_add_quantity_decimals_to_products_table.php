<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Max decimal places for quantities of a Multiple UOM product (cashier input + display).
            // NULL = derived from the base unit (piece -> 0, meter -> 2, kg -> 3). Stored stock stays exact.
            $table->unsignedTinyInteger('quantity_decimals')->nullable()->after('base_unit');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn('quantity_decimals');
        });
    }
};
