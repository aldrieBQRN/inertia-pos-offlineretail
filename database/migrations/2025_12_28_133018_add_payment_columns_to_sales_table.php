<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration to add detailed cash transaction fields to the sales table.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->string('payment_method')->default('cash')->after('total_amount');
            $table->string('payment_reference')->nullable()->after('payment_method');
            $table->integer('cash_given')->nullable()->after('payment_reference');
            $table->integer('change')->nullable()->after('cash_given');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn(['cash_given', 'change']);
        });
    }
};
