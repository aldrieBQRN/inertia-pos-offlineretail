<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class License extends Model
{
    protected $fillable = [
        'license_id',
        'product',
        'machine_id',
        'license_type',
        'token',
        'signature',
        'payload',
        'issued_at',
        'expires_at',
        'activated_at',
        'is_active',
    ];

    protected $casts = [
        'payload' => 'array',
        'issued_at' => 'datetime',
        'expires_at' => 'datetime',
        'activated_at' => 'datetime',
        'is_active' => 'boolean',
    ];

    /**
     * Check if the license is currently active and not expired.
     */
    public function isValidNow(): bool
    {
        if (!$this->is_active) {
            return false;
        }

        if ($this->expires_at !== null && $this->expires_at->isPast()) {
            return false;
        }

        return true;
    }
}
