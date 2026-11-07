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
        Schema::table('categories', function (Blueprint $table) {
            // 1. Drop the old global unique constraint (using the exact name from your error)
            $table->dropUnique('categories_name_unique');

            // 2. Add the new composite unique constraint (Name is unique PER Store)
            $table->unique(['store_id', 'name']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('categories', function (Blueprint $table) {
            // 1. Drop the composite constraint if we ever need to roll back
            $table->dropUnique(['store_id', 'name']);

            // 2. Restore the original global unique constraint
            $table->unique('name', 'categories_name_unique');
        });
    }
};
