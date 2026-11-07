<?php

namespace App\Traits;

use App\Support\CurrentStore;
use Illuminate\Database\Eloquent\Builder;

/**
 * Standalone single-store scoping.
 *
 * The POS runs one store per installation, so every store-owned record is
 * attached to that store automatically. The store_id columns are kept so the
 * existing data model and relationships stay intact.
 */
trait BelongsToStore
{
    protected static function bootBelongsToStore()
    {
        static::addGlobalScope('store', function (Builder $builder) {
            $storeId = CurrentStore::id();

            if ($storeId) {
                // Qualify with the table name to prevent "ambiguous column" errors in joins
                $builder->where($builder->getModel()->getTable() . '.store_id', $storeId);
            }
        });

        static::creating(function ($model) {
            $storeId = CurrentStore::id();

            if ($storeId && empty($model->store_id)) {
                $model->store_id = $storeId;
            }
        });
    }

    public function store()
    {
        return $this->belongsTo(\App\Models\Store::class);
    }
}
