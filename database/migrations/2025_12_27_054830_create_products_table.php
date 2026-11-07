<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration to establish the inventory products table.
 * Includes fields for financial tracking, stock levels, and categorization.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->text('description')->nullable();

            // Unique identification for fast lookups/scanning
            $table->string('sku')->unique();

            // Financial values stored in cents for precision
            $table->integer('price');
            $table->integer('cost_price')->nullable();

            // Inventory tracking and threshold alerts
            $table->integer('stock_quantity')->default(0);
            $table->integer('low_stock_threshold')->default(10);

            // Link to parent category
            $table->foreignId('category_id')->constrained()->onDelete('cascade');

            $table->string('image_path')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('products');
    }
};
