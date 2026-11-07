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
        Schema::table('stores', function (Blueprint $table) {
            $table->foreignId('owner_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
        });

        Schema::create('store_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('store_id')->constrained()->cascadeOnDelete();
            $table->string('role')->default('cashier'); // 'admin', 'manager', 'cashier'
            $table->boolean('is_primary')->default(false);
            $table->timestamps();

            $table->unique(['user_id', 'store_id']);
        });

        // Backfill existing stores and user assignments
        try {
            $adminUsers = \Illuminate\Support\Facades\DB::table('users')
                ->where('role', 'admin')
                ->whereNotNull('store_id')
                ->get();

            foreach ($adminUsers as $admin) {
                \Illuminate\Support\Facades\DB::table('stores')
                    ->where('id', $admin->store_id)
                    ->whereNull('owner_id')
                    ->update(['owner_id' => $admin->id]);
            }

            $allUsers = \Illuminate\Support\Facades\DB::table('users')
                ->whereNotNull('store_id')
                ->get();

            foreach ($allUsers as $u) {
                \Illuminate\Support\Facades\DB::table('store_user')->updateOrInsert(
                    ['user_id' => $u->id, 'store_id' => $u->store_id],
                    [
                        'role' => $u->role ?? 'cashier',
                        'is_primary' => true,
                        'created_at' => now(),
                        'updated_at' => now(),
                    ]
                );
            }
        } catch (\Throwable $e) {
            // Log or ignore if table is empty in testing
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('store_user');

        Schema::table('stores', function (Blueprint $table) {
            $table->dropForeign(['owner_id']);
            $table->dropColumn('owner_id');
        });
    }
};
