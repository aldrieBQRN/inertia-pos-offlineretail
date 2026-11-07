<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('subscription_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('store_id')->constrained()->cascadeOnDelete();
            $table->string('full_name');
            $table->decimal('amount', 10, 2);
            $table->string('reference_number');
            $table->string('receipt_path'); // Where we save the image
            $table->string('status')->default('pending'); // pending, approved, rejected
            $table->boolean('agreed_to_terms')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_payments');
    }
};
