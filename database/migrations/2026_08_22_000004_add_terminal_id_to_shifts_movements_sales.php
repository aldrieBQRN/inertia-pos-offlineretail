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
        if (Schema::hasTable('shifts') && !Schema::hasColumn('shifts', 'terminal_id')) {
            Schema::table('shifts', function (Blueprint $table) {
                $table->foreignId('terminal_id')->nullable()->after('user_id')->constrained('terminals')->nullOnDelete();
            });
        }

        if (Schema::hasTable('cash_movements') && !Schema::hasColumn('cash_movements', 'terminal_id')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                $table->foreignId('terminal_id')->nullable()->after('shift_id')->constrained('terminals')->nullOnDelete();
            });
        }

        if (Schema::hasTable('sales') && !Schema::hasColumn('sales', 'terminal_id')) {
            Schema::table('sales', function (Blueprint $table) {
                $table->foreignId('terminal_id')->nullable()->after('cashier_id')->constrained('terminals')->nullOnDelete();
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('shifts') && Schema::hasColumn('shifts', 'terminal_id')) {
            Schema::table('shifts', function (Blueprint $table) {
                $table->dropForeign(['terminal_id']);
                $table->dropColumn('terminal_id');
            });
        }

        if (Schema::hasTable('cash_movements') && Schema::hasColumn('cash_movements', 'terminal_id')) {
            Schema::table('cash_movements', function (Blueprint $table) {
                $table->dropForeign(['terminal_id']);
                $table->dropColumn('terminal_id');
            });
        }

        if (Schema::hasTable('sales') && Schema::hasColumn('sales', 'terminal_id')) {
            Schema::table('sales', function (Blueprint $table) {
                $table->dropForeign(['terminal_id']);
                $table->dropColumn('terminal_id');
            });
        }
    }
};
