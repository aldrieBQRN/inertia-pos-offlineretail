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
        Schema::table('sales', function (Blueprint $table) {
            $table->string('discount_type')->nullable()->after('discount_amount'); // 'senior', 'pwd', 'loyalty', 'damaged', 'custom_percentage', 'custom_fixed'
            $table->decimal('discount_rate', 5, 2)->nullable()->after('discount_type'); // e.g. 20.00, 10.00, 5.00
            $table->string('customer_name')->nullable()->after('discount_rate');
            $table->string('customer_id_number')->nullable()->after('customer_name');
            $table->string('discount_reason')->nullable()->after('customer_id_number');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('sales', function (Blueprint $table) {
            $table->dropColumn([
                'discount_type',
                'discount_rate',
                'customer_name',
                'customer_id_number',
                'discount_reason',
            ]);
        });
    }
};
