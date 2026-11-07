<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            // Add the subscription plan and expiration date
            $table->string('subscription_plan')->default('monthly'); // monthly, 1_year, 2_years, 3_years
            $table->timestamp('subscription_ends_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            $table->dropColumn(['subscription_plan', 'subscription_ends_at']);
        });
    }
};
