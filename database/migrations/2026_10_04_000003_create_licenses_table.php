<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('licenses', function (Blueprint $table) {
            $table->id();
            $table->string('license_id')->unique();
            $table->string('product');
            $table->string('machine_id');
            $table->string('license_type')->default('perpetual');
            $table->text('token');
            $table->text('signature');
            $table->json('payload');
            $table->timestamp('issued_at');
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('activated_at');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['machine_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('licenses');
    }
};
