<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The single local store of this standalone POS installation.
 */
class Store extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'address',
        'phone',
        'status',
        'logo_path',
        'receipt_tagline',
        'receipt_footer',
        'receipt_paper_width',
    ];

    protected $casts = [
        'status' => 'boolean',
    ];

    /**
     * The local store (null until First-Time Setup has been completed).
     */
    public static function current(): ?self
    {
        return static::query()->orderBy('id')->first();
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}
