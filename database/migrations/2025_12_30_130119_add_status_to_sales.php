<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration to add transaction status tracking to the sales table.
 * Supports distinguishing between completed, voided, or pending transactions.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     * * * Appends a 'status' column to the sales table, defaulting to 'completed'
     * to ensure compatibility with existing transaction records.
     */
    public function up()
    {
        Schema::table('sales', function (Blueprint $table) {
            // Tracks the current state of the sale (e.g., 'completed', 'void')
            $table->string('status')->default('completed')->after('change');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down()
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('status');
        });
    }
};
