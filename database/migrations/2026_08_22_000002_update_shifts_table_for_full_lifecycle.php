<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->decimal('expected_opening_cash', 10, 2)->default(0)->after('end_time');
            $table->decimal('opening_discrepancy', 10, 2)->default(0)->after('starting_cash');
            $table->decimal('cash_in', 10, 2)->default(0)->after('cash_sales');
            $table->decimal('cash_out', 10, 2)->default(0)->after('cash_in');
            $table->text('opening_notes')->nullable()->after('status');
            $table->text('closing_notes')->nullable()->after('opening_notes');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('shifts', function (Blueprint $table) {
            $table->dropColumn([
                'expected_opening_cash',
                'opening_discrepancy',
                'cash_in',
                'cash_out',
                'opening_notes',
                'closing_notes'
            ]);
        });
    }
};
