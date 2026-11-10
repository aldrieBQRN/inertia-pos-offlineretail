<?php

/**
 * Audit & Activity Logging Configuration
 *
 * Define which operations are logged for security and compliance purposes.
 * CRITICAL operations are always logged synchronously.
 * OPTIONAL operations are queued or skipped based on settings.
 */

return [
    /*
    |--------------------------------------------------------------------------
    | Enable Queued Logging
    |--------------------------------------------------------------------------
    |
    | When true, activity logs are processed in background jobs (non-blocking).
    | When false, logs are written synchronously (slightly slower but guaranteed).
    |
    | Queue driver must be configured in config/queue.php
    | Recommended: 'database' or 'redis' queue driver
    |
    */
    'queue_enabled' => env('AUDIT_QUEUE_ENABLED', false),

    /*
    |--------------------------------------------------------------------------
    | Queue Name for Activity Logs
    |--------------------------------------------------------------------------
    |
    | Background job queue for activity logging.
    | Use a separate queue to avoid blocking main application jobs.
    |
    */
    'queue_name' => env('AUDIT_QUEUE_NAME', 'logs'),

    /*
    |--------------------------------------------------------------------------
    | Critical Operations (Always Logged - Synchronously)
    |--------------------------------------------------------------------------
    |
    | These operations are always logged immediately, even if queue is down.
    | Used for security-sensitive actions that must have guaranteed audit trail.
    |
    */
    'critical_operations' => [
        // User Management
        'user.update',
        'user.password_change',

        // Product & Stock Management (Immediate Guaranteed Audit Trail)
        'product.create',
        'product.update',
        'product.delete',
        'product.stock_adjust',

        // Inventory file import / export (Excel, CSV, PDF)
        'inventory.import',
        'inventory.export',

        // Store Management
        'store.settings.update',
        'store.receipt_settings.update',

        // Category Management
        'category.create',
        'category.update',
        'category.delete',

        // Sales & POS Checkout
        'sale.create',
        'sale.void',

        // Cash & Shift Management
        'shift.open',
        'shift.close',
        'cash_movement.create',

        // Security Events
        'security.login_failed',
        'security.login_success',
        'security.logout',
        'security.password_change',
        'security.setup_completed',
        'security.recovery_failed',
        'security.credential_recovered',
    ],

    /*
    |--------------------------------------------------------------------------
    | Optional Operations (Can Be Queued or Disabled)
    |--------------------------------------------------------------------------
    |
    | These operations are logged asynchronously when queue_enabled is true.
    | You can disable specific operations here to reduce log noise.
    |
    */
    'optional_operations' => [
        // Product Management
        'product.create' => true,
        'product.update' => true,
        'product.delete' => true,
        'product.stock_adjust' => true,

        // Sales (high volume - consider disabling)
        'sale.create' => true,
        'sale.update' => false,  // Too frequent, disable if needed
        'sale.void' => true,

        // Views (informational, low priority)
        'view.product' => false,  // Disabled - creates too much log volume
        'view.sale' => false,     // Disabled - creates too much log volume
    ],

    /*
    |--------------------------------------------------------------------------
    | Log Retention Days
    |--------------------------------------------------------------------------
    |
    | Activity logs older than this many days will be archived to a separate table.
    | Keeps the main activity_logs table fast for audits.
    |
    */
    'retention_days' => env('AUDIT_RETENTION_DAYS', 90),

    /*
    |--------------------------------------------------------------------------
    | Log Categories
    |--------------------------------------------------------------------------
    |
    | Categories are computed from action/model_type and used for filtering
    | and dashboard grouping in the activity log viewer.
    |
    */
    'categories' => [
        'Security',
        'User Management',
        'Store Settings',
        'Product Management',
        'Category Management',
        'Sales',
        'Payments',
        'System',
    ],

    /*
    |--------------------------------------------------------------------------
    | Sensitive Data to Exclude from Logs
    |--------------------------------------------------------------------------
    |
    | Fields containing sensitive data that should be masked in activity logs.
    | Examples: passwords, API keys, payment card numbers
    |
    */
    'exclude_fields' => [
        'password',
        'password_confirmation',
        'card_number',
        'cvv',
        'api_key',
        'secret',
        'token',
    ],

    /*
    |--------------------------------------------------------------------------
    | Include Request Details
    |--------------------------------------------------------------------------
    |
    | Log IP address and user agent for security tracking.
    | Useful for detecting unauthorized access patterns.
    |
    */
    'log_request_details' => env('AUDIT_LOG_REQUEST_DETAILS', true),
];
