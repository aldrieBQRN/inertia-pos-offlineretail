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
        Schema::create('activity_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('store_id')->constrained('stores')->onDelete('cascade');
            $table->string('action'); // create, update, delete, view, etc.
            $table->string('model_type'); // Product, User, Sale, etc.
            $table->unsignedBigInteger('model_id')->nullable(); // ID of the affected model
            $table->json('old_values')->nullable(); // Previous values for updates
            $table->json('new_values')->nullable(); // New values for creates/updates
            $table->text('description')->nullable(); // Human-readable description
            $table->ipAddress('ip_address')->nullable(); // IP address of the requester
            $table->text('user_agent')->nullable(); // Browser user agent
            $table->timestamps();

            // Add indices for common queries
            $table->index('user_id');
            $table->index('store_id');
            $table->index('action');
            $table->index('model_type');
            $table->index('created_at');
            $table->index(['store_id', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('activity_logs');
    }
};
