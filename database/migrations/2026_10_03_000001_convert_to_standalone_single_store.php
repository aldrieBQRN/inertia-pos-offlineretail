<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
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
        if (Schema::hasColumn('stores', 'owner_id')) {
            try {
                Schema::table('stores', function (Blueprint $table) {
                    $table->dropForeign(['owner_id']);
                });
            } catch (\Throwable $e) {}

            try {
                Schema::table('stores', function (Blueprint $table) {
                    $table->dropColumn('owner_id');
                });
            } catch (\Throwable $e) {}
        }

        if (Schema::hasColumn('stores', 'plan_id')) {
            try {
                Schema::table('stores', function (Blueprint $table) {
                    $table->dropForeign(['plan_id']);
                });
            } catch (\Throwable $e) {}

            try {
                Schema::table('stores', function (Blueprint $table) {
                    $table->dropColumn('plan_id');
                });
            } catch (\Throwable $e) {}
        }

        foreach (['subscription_plan', 'subscription_ends_at', 'last_reminder_sent_at'] as $column) {
            if (Schema::hasColumn('stores', $column)) {
                try {
                    Schema::table('stores', fn (Blueprint $table) => $table->dropColumn($column));
                } catch (\Throwable $e) {}
            }
        }

        Schema::disableForeignKeyConstraints();
        Schema::dropIfExists('store_user');
        Schema::dropIfExists('subscription_payments');
        Schema::dropIfExists('plans');
        Schema::dropIfExists('announcements');
        Schema::dropIfExists('system_settings');
        Schema::dropIfExists('blocked_ips');
        Schema::dropIfExists('settings');
        Schema::dropIfExists('password_reset_tokens');
        Schema::enableForeignKeyConstraints();

        if (!Schema::hasColumn('users', 'auth_type')) {
            Schema::table('users', function (Blueprint $table) {
                $table->string('email')->nullable()->change();
                $table->string('auth_type', 20)->default('password')->after('password');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('users', 'auth_type')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('auth_type');
            });
        }
    }
};
