<?php

namespace App\Support;

use App\Models\Store;

/**
 * Resolves the single local store of this standalone POS installation.
 */
class CurrentStore
{
    private static ?int $id = null;

    /**
     * The id of the local store, or null before First-Time Setup has run.
     */
    public static function id(): ?int
    {
        if (static::$id !== null) {
            return static::$id;
        }

        try {
            $id = Store::query()->orderBy('id')->value('id');
        } catch (\Throwable $e) {
            // Database not migrated yet
            return null;
        }

        // Only remember a real id so the store created by First-Time Setup is picked up immediately
        return static::$id = $id ? (int) $id : null;
    }

    /**
     * Forget the remembered id (used by tests that rebuild the database).
     */
    public static function forget(): void
    {
        static::$id = null;
    }
}
