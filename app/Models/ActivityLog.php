<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ActivityLog extends Model
{
    protected $appends = [
        'category',
    ];

    protected $fillable = [
        'user_id',
        'store_id',
        'action',
        'model_type',
        'model_id',
        'old_values',
        'new_values',
        'description',
        'ip_address',
        'user_agent',
    ];

    protected $casts = [
        'old_values' => 'array',
        'new_values' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    /**
     * Get the user who performed the action.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the store associated with this activity.
     */
    public function store()
    {
        return $this->belongsTo(Store::class);
    }

    /**
     * Resolve the log category from action/model type.
     */
    public static function resolveCategory(?string $action, ?string $modelType): string
    {
        $action = strtolower((string) $action);
        $modelType = strtolower((string) $modelType);

        if ($modelType === 'security' || str_starts_with($action, 'security.')) {
            return 'Security';
        }

        if ($modelType === 'user') {
            return 'User Management';
        }

        if ($modelType === 'store' || $action === 'store.settings.update' || $action === 'store.suspend') {
            return 'Store Settings';
        }

        if ($modelType === 'product') {
            return 'Product Management';
        }

        if ($modelType === 'category') {
            return 'Category Management';
        }

        if ($modelType === 'sale') {
            return 'Sales';
        }

        if ($modelType === 'shift' || $modelType === 'cashmovement' || str_starts_with($action, 'shift.') || str_starts_with($action, 'cash_movement.')) {
            return 'Cash & Shifts';
        }

        if ($modelType === 'payment' || in_array($action, ['approve', 'reject', 'refund'], true)) {
            return 'Payments';
        }

        return 'System';
    }

    /**
     * Expose category as a computed attribute.
     */
    public function getCategoryAttribute(): string
    {
        return self::resolveCategory($this->action, $this->model_type);
    }

    /**
     * Available categories for filtering.
     */
    public static function availableCategories(): array
    {
        return config('audit.categories', [
            'Security',
            'User Management',
            'Store Settings',
            'Product Management',
            'Category Management',
            'Sales',
            'Payments',
            'System',
        ]);
    }

    /**
     * Scope to get activities for a specific store.
     */
    public function scopeForStore($query, $storeId)
    {
        return $query->where('store_id', $storeId);
    }

    /**
     * Scope to get activities for a specific user.
     */
    public function scopeByUser($query, $userId)
    {
        return $query->where('user_id', $userId);
    }

    /**
     * Scope to get specific action types.
     */
    public function scopeByAction($query, $action)
    {
        return $query->where('action', $action);
    }

    /**
     * Scope to get activities for a category.
     */
    public function scopeByCategory($query, string $category)
    {
        $category = trim($category);

        return $query->where(function ($builder) use ($category) {
            switch ($category) {
                case 'Security':
                    $builder->where('model_type', 'security')
                        ->orWhere('action', 'like', 'security.%');
                    break;

                case 'User Management':
                    $builder->where('model_type', 'User');
                    break;

                case 'Store Settings':
                    $builder->where('model_type', 'Store')
                        ->orWhereIn('action', ['store.settings.update', 'store.suspend']);
                    break;

                case 'Product Management':
                    $builder->where('model_type', 'Product');
                    break;

                case 'Category Management':
                    $builder->where('model_type', 'Category');
                    break;

                case 'Sales':
                    $builder->where('model_type', 'Sale');
                    break;

                case 'Cash & Shifts':
                case 'Shifts':
                    $builder->whereIn('model_type', ['Shift', 'CashMovement', 'shift', 'cashmovement'])
                        ->orWhere('action', 'like', 'shift.%')
                        ->orWhere('action', 'like', 'cash_movement.%');
                    break;

                case 'Payments':
                    $builder->where('model_type', 'payment')
                        ->orWhereIn('action', ['approve', 'reject', 'refund']);
                    break;

                default:
                    $builder->whereRaw('1 = 0');
                    break;
            }
        });
    }

    /**
     * Scope to get activities for a specific model.
     */
    public function scopeForModel($query, $modelType, $modelId)
    {
        return $query->where('model_type', $modelType)->where('model_id', $modelId);
    }
}
