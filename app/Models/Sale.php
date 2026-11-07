<?php

namespace App\Models;

use App\Traits\BelongsToStore;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Sale Model
 * * Represents a completed or voided transaction in the POS system,
 * storing financial totals, payment details, and cashier information.
 */
class Sale extends Model
{
    use HasFactory, BelongsToStore;

    /**
     * The attributes that are mass assignable.
     * * * Tracks identification, financial data, payment status,
     * and the specific date of the transaction.
     *
     * @var array<int, string>
     */
    protected $fillable = [
        'invoice_number',
        'cashier_id',
        'terminal_id',
        'total_amount',
        'discount_amount',
        'discount_type',
        'discount_rate',
        'customer_name',
        'customer_id_number',
        'discount_reason',
        'payment_method',
        'payment_reference',
        'is_senior',
        'cash_given',
        'change',
        'status',
        'transaction_date',
    ];

    /**
     * The attributes that should be cast to native types.
     * * * Ensures proper data types for senior discounts and
     * consistent date-time objects for transaction timestamps.
     *
     * @var array<string, string>
     */
    protected $casts = [
        'is_senior' => 'boolean',
        'discount_rate' => 'float',
        'transaction_date' => 'datetime',
    ];

    /**
     * Relationship: A sale consists of multiple individual line items.
     *
     * @return \Illuminate\Database\Eloquent\Relations\HasMany
     */
    public function items()
    {
        return $this->hasMany(SaleItem::class);
    }

    /**
     * Relationship: Each sale is processed by a specific cashier (User).
     *
     * @return \Illuminate\Database\Eloquent\Relations\BelongsTo
     */
    public function cashier()
    {
        return $this->belongsTo(User::class, 'cashier_id');
    }

    public function terminal()
    {
        return $this->belongsTo(Terminal::class);
    }
}
