<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            // Add the column
            $table->string('account_number')->unique()->after('id')->nullable();
        });

        // Auto-assign sequential account numbers to any existing users so the system doesn't break
        $users = DB::table('users')->orderBy('id', 'asc')->get();
        $startNumber = 10000; // Starting account number

        foreach ($users as $user) {
            $startNumber++;
            DB::table('users')->where('id', $user->id)->update([
                'account_number' => 'ACC-' . str_pad($startNumber, 5, '0', STR_PAD_LEFT)
            ]);
        }

        // Now make it strictly required (not nullable) after populating existing data
        Schema::table('users', function (Blueprint $table) {
            $table->string('account_number')->nullable(false)->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('account_number');
        });
    }
};
