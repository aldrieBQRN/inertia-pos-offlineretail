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
        Schema::create('plans', function (Blueprint $table) {
            $table->id();
            $table->string('name'); // e.g., "Standard Monthly", "Business Yearly"
            $table->integer('duration_months'); // 1, 12, 24, 36
            $table->decimal('price', 10, 2); // e.g., 999.00
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        // Also, let's update the stores table to link to a Plan ID
        Schema::table('stores', function (Blueprint $table) {
            $table->foreignId('plan_id')->nullable()->constrained('plans');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('plans');
    }
};
