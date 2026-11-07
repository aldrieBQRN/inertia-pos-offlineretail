<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Persist receipt customization on the local store so receipt settings can be
 * audited (previous value -> new value) in System Activity Logs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            if (!Schema::hasColumn('stores', 'receipt_tagline')) {
                $table->string('receipt_tagline')->nullable()->after('logo_path');
            }
            if (!Schema::hasColumn('stores', 'receipt_footer')) {
                $table->text('receipt_footer')->nullable()->after('receipt_tagline');
            }
            if (!Schema::hasColumn('stores', 'receipt_paper_width')) {
                $table->string('receipt_paper_width', 10)->nullable()->after('receipt_footer');
            }
        });
    }

    public function down(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            foreach (['receipt_paper_width', 'receipt_footer', 'receipt_tagline'] as $column) {
                if (Schema::hasColumn('stores', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
