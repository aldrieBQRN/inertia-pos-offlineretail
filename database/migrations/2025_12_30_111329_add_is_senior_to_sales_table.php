<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration to add Senior/PWD discount eligibility tracking to the sales table.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     * * * Includes a check to prevent errors if the column was manually
     * added or already exists from a partial migration.
     */
    public function up()
    {
        Schema::table('sales', function (Blueprint $table) {
            // Check for column existence before modification for database safety
            if (!Schema::hasColumn('sales', 'is_senior')) {
                $table->boolean('is_senior')->default(false);
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down()
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn('is_senior');
        });
    }
};
