<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * User Model
 *
 * The standalone POS has exactly one account: the Admin created during
 * First-Time Setup. The Admin signs in with a 4-digit PIN, a 6-digit PIN or a
 * password (stored hashed in `password`; the kind is kept in `auth_type`).
 */
class User extends Authenticatable
{
    use HasFactory, Notifiable;

    /**
     * The attributes that are mass assignable.
     * * * Includes 'is_admin' to allow for role-based access control
     * during user creation or updates.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'auth_type',
        'role',
        'is_admin',
        'store_id',
        'account_number',
        'phone_number',
        'address',
        'city',
        'province',
        'country',
        'avatar_path',
        'terms_accepted_at',
        'is_active',
    ];

    /**
     * The attributes that should be hidden for serialization.
     * * * Prevents sensitive authentication data from being
     * included in JSON API responses.
     *
     * @var array<int, string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     * * * Handles automatic hashing for passwords and converts the
     * 'is_admin' database flag into a boolean.
     *
     * @return array<string, string>
     */
    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'is_admin' => 'boolean',
            'terms_accepted_at' => 'datetime', // <--- Add this exact line
            'is_active' => 'boolean',
        ];
    }

    /**
     * The "booted" method of the model.
     * This automatically runs whenever a User model is manipulated.
     */
    protected static function boot()
    {
        parent::boot();

        // Automatically assign a purely numeric, sequential account number right before saving a NEW user
        static::creating(function ($user) {
            if (empty($user->account_number)) {
                $latestNumeric = self::whereNotNull('account_number')
                    ->pluck('account_number')
                    ->map(fn($acc) => (int) preg_replace('/[^0-9]/', '', $acc))
                    ->filter(fn($n) => $n >= 10000000)
                    ->max();

                $nextCandidate = $latestNumeric ? ($latestNumeric + 1) : 10000001;
                while (self::where('account_number', (string) $nextCandidate)->exists()) {
                    $nextCandidate++;
                }

                $user->account_number = (string) $nextCandidate;
            }
        });
    }

    /**
     * Supported sign-in credential types.
     */
    public const AUTH_TYPES = ['pin4', 'pin6', 'password'];

    /**
     * The single Admin account (null until First-Time Setup has been completed).
     */
    public static function admin(): ?self
    {
        return static::query()->orderBy('id')->first();
    }

    /**
     * Get the store that the user belongs to.
     */
    public function store(): BelongsTo
    {
        return $this->belongsTo(Store::class);
    }

    /**
     * Shifts worked by this user.
     */
    public function shifts(): HasMany
    {
        return $this->hasMany(Shift::class, 'user_id');
    }

    /**
     * Current open shift (if any).
     */
    public function activeShift()
    {
        return $this->hasOne(Shift::class, 'user_id')->where('status', 'open')->latest('start_time');
    }

    /**
     * Sales transactions processed by this cashier.
     */
    public function sales(): HasMany
    {
        return $this->hasMany(Sale::class, 'cashier_id');
    }

    /**
     * Offline account-recovery questions (answers are stored hashed).
     */
    public function recoveryQuestions(): HasMany
    {
        return $this->hasMany(RecoveryQuestion::class)->orderBy('position');
    }
}
