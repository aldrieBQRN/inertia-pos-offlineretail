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
        Schema::table('subscription_payments', function (Blueprint $blueprint) {
            // 1. Add the plan_id column
            // We use 'constrained' to ensure it only accepts valid IDs from the plans table.
            // We make it nullable just in case you have old records without plans.
            $blueprint->foreignId('plan_id')
                ->nullable()
                ->after('store_id')
                ->constrained('plans')
                ->onDelete('set null');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('subscription_payments', function (Blueprint $blueprint) {
            // Drop the foreign key and the column
            $blueprint->dropForeign(['plan_id']);
            $blueprint->dropColumn('plan_id');
        });
    }
};
