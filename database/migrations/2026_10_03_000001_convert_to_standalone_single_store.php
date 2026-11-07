<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Standalone offline conversion.
 *
 * - Removes SaaS-only tables (billing, plans, broadcasts, global settings, IP blocklist, branch pivot).
 * - Removes multi-branch / subscription columns from stores.
 * - Adds the Admin credential type (4-digit PIN, 6-digit PIN or password) and makes email optional.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stores', function (Blueprint $table) {
            if (Schema::hasColumn('stores', 'owner_id')) {
                $table->dropForeign(['owner_id']);
                $table->dropColumn('owner_id');
            }
        });

        Schema::table('stores', function (Blueprint $table) {
            if (Schema::hasColumn('stores', 'plan_id')) {
                $table->dropForeign(['plan_id']);
                $table->dropColumn('plan_id');
            }
        });

        foreach (['subscription_plan', 'subscription_ends_at', 'last_reminder_sent_at'] as $column) {
            if (Schema::hasColumn('stores', $column)) {
                Schema::table('stores', fn (Blueprint $table) => $table->dropColumn($column));
            }
        }

        Schema::dropIfExists('store_user');
        Schema::dropIfExists('subscription_payments');
        Schema::dropIfExists('plans');
        Schema::dropIfExists('announcements');
        Schema::dropIfExists('system_settings');
        Schema::dropIfExists('blocked_ips');
        Schema::dropIfExists('settings');
        Schema::dropIfExists('password_reset_tokens');

        Schema::table('users', function (Blueprint $table) {
            $table->string('email')->nullable()->change();
            $table->string('auth_type', 20)->default('password')->after('password');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('auth_type');
        });
    }
};
