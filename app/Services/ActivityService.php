<?php

namespace App\Services;

use App\Models\ActivityLog;
use App\Models\Store;
use App\Models\User;
use App\Support\Quantity;
use App\Jobs\LogActivityJob;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Request;
use Illuminate\Support\Facades\Config;

class ActivityService
{
    /**
     * Resolve a fallback store id when actor has no direct store context
     * (e.g., super admin global actions).
     */
    /**
     * Resolve store_id from the affected target model.
     */
    public static function resolveModelStoreId(?string $modelType, ?int $modelId): ?int
    {
        if (!$modelType || !$modelId) {
            return null;
        }

        $type = strtolower($modelType);

        try {
            if ($type === 'store') {
                return (int) $modelId;
            }

            if ($type === 'product' || $type === 'inventory') {
                $storeId = \App\Models\Product::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'category') {
                $storeId = \App\Models\Category::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'sale') {
                $storeId = \App\Models\Sale::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'shift') {
                $storeId = \App\Models\Shift::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'terminal') {
                $storeId = \App\Models\Terminal::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'heldorder') {
                $storeId = \App\Models\HeldOrder::withoutGlobalScopes()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }

            if ($type === 'user') {
                $storeId = \App\Models\User::query()->whereKey($modelId)->value('store_id');
                if ($storeId) return (int) $storeId;
            }
        } catch (\Throwable $e) {
            // Ignore if model/table does not exist
        }

        return null;
    }

    /**
     * Resolve a fallback store id when actor has no direct store context
     * (e.g., super admin global actions).
     */
    private static function resolveFallbackStoreId(
        ?string $modelType,
        ?int $modelId,
        ?array $oldValues,
        ?array $newValues
    ): ?int {
        // Preferred explicit value from payload.
        $explicitStoreId = $newValues['store_id'] ?? $oldValues['store_id'] ?? null;
        if ($explicitStoreId) {
            return (int) $explicitStoreId;
        }

        $fromModel = self::resolveModelStoreId($modelType, $modelId);
        if ($fromModel) {
            return $fromModel;
        }

        // Active session store context
        $activeStoreId = \App\Support\CurrentStore::id();
        if ($activeStoreId) {
            return $activeStoreId;
        }

        // System actions have no target model.
        // Fallback to first store so logs are not dropped by non-null constraint.
        $firstStoreId = Store::query()->orderBy('id')->value('id');

        return $firstStoreId ? (int) $firstStoreId : null;
    }

    /**
     * Check if an operation should be logged.
     */
    private static function shouldLog(string $operationKey): bool
    {
        // Critical operations always logged
        if (in_array($operationKey, Config::get('audit.critical_operations', []))) {
            return true;
        }

        // Check if optional operation is enabled
        $optionalOps = Config::get('audit.optional_operations', []);
        return $optionalOps[$operationKey] ?? false;
    }

    /**
     * Check if operation is critical (should be logged synchronously).
     */
    private static function isCritical(string $operationKey): bool
    {
        return in_array($operationKey, Config::get('audit.critical_operations', []));
    }

    /**
     * Filter sensitive data from values.
     */
    private static function filterSensitiveData(array $data): array
    {
        $excludeFields = Config::get('audit.exclude_fields', []);

        return array_filter($data, function ($value, $key) use ($excludeFields) {
            return !in_array(strtolower($key), array_map('strtolower', $excludeFields));
        }, ARRAY_FILTER_USE_BOTH);
    }

    /**
     * Create activity log data structure.
     */
    private static function createLogData(
        string $action,
        string $modelType,
        ?int $modelId = null,
        ?string $description = null,
        ?array $oldValues = null,
        ?array $newValues = null
    ): array {
        // Allow explicit actor context for unauthenticated security events
        $actorUserId = null;
        $targetStoreId = null;

        if (is_array($newValues)) {
            if (isset($newValues['_actor_user_id'])) {
                $actorUserId = (int) $newValues['_actor_user_id'];
                unset($newValues['_actor_user_id']);
            }

            if (isset($newValues['_actor_store_id'])) {
                $targetStoreId = (int) $newValues['_actor_store_id'];
                unset($newValues['_actor_store_id']);
            }

            if (!$targetStoreId && isset($newValues['store_id'])) {
                $targetStoreId = (int) $newValues['store_id'];
            }
        }

        if (!$targetStoreId && is_array($oldValues) && isset($oldValues['store_id'])) {
            $targetStoreId = (int) $oldValues['store_id'];
        }

        if (Auth::check()) {
            $user = Auth::user();
            $actorUserId = $user->id;
        }

        // 1. Resolve store from the target model being acted upon
        if (!$targetStoreId && $modelType && $modelId) {
            $targetStoreId = self::resolveModelStoreId($modelType, $modelId);
        }

        // 2. Resolve the local store
        if (!$targetStoreId) {
            $activeStoreId = \App\Support\CurrentStore::id();
            if ($activeStoreId) {
                $targetStoreId = (int) $activeStoreId;
            }
        }

        // 3. Resolve from actor user's assigned store_id
        if (!$targetStoreId && Auth::check() && Auth::user()->store_id) {
            $targetStoreId = (int) Auth::user()->store_id;
        }

        // 4. Fallback resolution (system/global actions)
        if (!$targetStoreId) {
            $targetStoreId = self::resolveFallbackStoreId($modelType, $modelId, $oldValues, $newValues);
        }

        // Activity log schema requires both user_id and store_id
        if (!$actorUserId || !$targetStoreId) {
            return [];
        }

        return [
            'user_id' => $actorUserId,
            'store_id' => $targetStoreId,
            'action' => $action,
            'model_type' => $modelType,
            'model_id' => $modelId,
            'description' => $description,
            'old_values' => $oldValues ? self::filterSensitiveData($oldValues) : null,
            'new_values' => $newValues ? self::filterSensitiveData($newValues) : null,
            'ip_address' => Config::get('audit.log_request_details', true) ? Request::ip() : null,
            'user_agent' => Config::get('audit.log_request_details', true) ? Request::userAgent() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ];
    }

    /**
     * Write activity log (queued or synchronous based on config).
     */
    private static function writeLog(string $operationKey, array $logData): ?ActivityLog
    {
        if (!self::shouldLog($operationKey)) {
            return null;
        }

        // Critical operations: write synchronously (guaranteed)
        if (self::isCritical($operationKey)) {
            return ActivityLog::create($logData);
        }

        // Optional operations: queue if enabled, otherwise skip
        if (Config::get('audit.queue_enabled', true)) {
            LogActivityJob::dispatch($logData);
            return null; // Job will handle DB write asynchronously
        }

        // Queue disabled: write synchronously
        return ActivityLog::create($logData);
    }

    /**
     * Log an activity with operation key.
     */
    public static function log(
        string $operationKey,
        string $action,
        string $modelType,
        ?int $modelId = null,
        ?string $description = null,
        ?array $oldValues = null,
        ?array $newValues = null
    ): ?ActivityLog {
        $logData = self::createLogData($action, $modelType, $modelId, $description, $oldValues, $newValues);

        if (empty($logData)) {
            return null;
        }

        return self::writeLog($operationKey, $logData);
    }

    /**
     * Log a create action (optional by default).
     */
    public static function logCreate(string $modelType, int $modelId, ?string $description = null, ?array $values = null)
    {
        $operationKey = strtolower($modelType) . '.create';
        return self::log($operationKey, 'create', $modelType, $modelId, $description, null, $values);
    }

    /**
     * Log an update action (optional by default).
     */
    public static function logUpdate(string $modelType, int $modelId, ?string $description = null, ?array $oldValues = null, ?array $newValues = null)
    {
        $operationKey = strtolower($modelType) . '.update';
        return self::log($operationKey, 'update', $modelType, $modelId, $description, $oldValues, $newValues);
    }

    /**
     * Log a delete action (critical).
     */
    public static function logDelete(string $modelType, int $modelId, ?string $description = null, ?array $values = null)
    {
        $operationKey = strtolower($modelType) . '.delete';
        return self::log($operationKey, 'delete', $modelType, $modelId, $description, null, $values);
    }

    /**
     * Log a view/access action (optional).
     */
    public static function logView(string $modelType, int $modelId, ?string $description = null)
    {
        $operationKey = 'view.' . strtolower($modelType);
        return self::log($operationKey, 'view', $modelType, $modelId, $description);
    }

    /**
     * Log a stock adjustment (critical audit trail).
     */
    public static function logStockAdjust(
        int $productId,
        $quantityChanged,
        ?string $description = null,
        ?int $storeId = null,
        $oldStock = null,
        $newStock = null,
        ?string $unit = null
    ) {
        $operationKey = 'product.stock_adjust';
        $quantityChanged = Quantity::toNumber($quantityChanged);

        // Auto-resolve stock levels from database if not explicitly provided
        if ($oldStock === null || $newStock === null) {
            $currentStock = \App\Models\Product::withoutGlobalScopes()->whereKey($productId)->value('stock_quantity');
            if ($currentStock !== null) {
                $newStock = $newStock ?? Quantity::toNumber($currentStock);
                $oldStock = $oldStock ?? Quantity::toNumber(Quantity::subtract($newStock, $quantityChanged));
            }
        }

        $oldValues = [
            'stock_quantity' => $oldStock ?? 0,
            'quantity_added' => 0,
        ];

        $newValues = [
            'stock_quantity' => $newStock ?? $quantityChanged,
            'quantity_added' => $quantityChanged,
            'quantity_change' => $quantityChanged,
        ];

        if ($unit) {
            $newValues['unit'] = $unit;
        }

        if ($storeId) {
            $newValues['store_id'] = $storeId;
        }

        return self::log(
            $operationKey,
            'stock_adjust',
            'Product',
            $productId,
            $description ?? "Restocked {$quantityChanged} unit(s) (Stock: {$oldValues['stock_quantity']} → {$newValues['stock_quantity']})",
            $oldValues,
            $newValues
        );
    }

    /**
     * Log a custom action (use operation key from config).
     */
    public static function logAction(string $operationKey, string $modelType, ?int $modelId = null, ?string $description = null)
    {
        return self::log($operationKey, 'action', $modelType, $modelId, $description);
    }

    /**
     * Log a security action (always critical).
     */
    public static function logSecurityAction(string $action, ?string $description = null, ?array $details = null)
    {
        $operationKey = 'security.' . $action;
        return self::log($operationKey, $action, 'security', null, $description, null, $details);
    }

    /**
     * Log an Admin credential (PIN/password) change (critical).
     */
    public static function logPasswordChange(int $userId, ?string $description = null)
    {
        return self::logSecurityAction('password_change', $description ?? 'Admin sign-in credential changed');
    }
}
