<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One of the Admin's three offline account-recovery questions.
 * The answer is only ever stored as a hash and is never serialized.
 */
class RecoveryQuestion extends Model
{
    protected $table = 'admin_recovery_questions';

    protected $fillable = [
        'user_id',
        'position',
        'question',
        'answer_hash',
    ];

    protected $hidden = [
        'answer_hash',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
