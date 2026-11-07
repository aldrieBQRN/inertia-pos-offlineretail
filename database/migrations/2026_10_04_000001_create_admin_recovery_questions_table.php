<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Offline account recovery: three security questions for the single Admin.
 * Only a hash of each (normalized) answer is stored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('admin_recovery_questions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('position');
            $table->string('question', 200);
            $table->string('answer_hash');
            $table->timestamps();

            $table->unique(['user_id', 'position']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('admin_recovery_questions');
    }
};
