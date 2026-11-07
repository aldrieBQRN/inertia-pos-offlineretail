<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Migration to create the held_orders table.
 * Supports the "Park Sale" or "Hold Order" feature by storing serialized cart data
 * for later retrieval and completion.
 */
return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up()
    {
        Schema::create('held_orders', function (Blueprint $table) {
            $table->id();

            // Identifiable note for the cashier to recognize the parked order
            $table->string('reference_note')->nullable();

            // Stores the serialized JSON representation of the shopping cart
            $table->longText('cart_data');

            // Total value stored as an integer for consistent UI display
            $table->integer('total_amount');

            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down()
    {
        Schema::dropIfExists('held_orders');
    }
};
