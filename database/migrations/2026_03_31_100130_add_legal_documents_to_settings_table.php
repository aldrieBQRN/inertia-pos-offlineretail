<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('settings', function (Blueprint $table) {
            // Using longText because legal documents are huge and will contain HTML formatting
            $table->longText('terms_of_service')->nullable();
            $table->longText('privacy_policy')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('settings', function (Blueprint $table) {
            $table->dropColumn(['terms_of_service', 'privacy_policy']);
        });
    }
};
